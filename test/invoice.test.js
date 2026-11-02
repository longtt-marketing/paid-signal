import { test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/worker.js";
import { packClick } from "../src/ledger.js";
import { correctedInvoiceRecord } from "../scripts/fix-invoice-time.mjs";

const kv = () => {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
};

test("five-minute schedule records a paid invoice despite the refresh throttle and keeps its PST-style raw time", async () => {
  const env = { LEDGER: kv(), PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const raw = "2026-11-01T18:35:27Z", utc = "2026-11-02T02:35:27Z";
  const ref = packClick({ ad: "trial_video", source: "fb", clickId: "fb_test_1", clickedAt: Date.parse("2026-11-01T02:00:00Z") });
  await env.LEDGER.put("inv:INV2-PAID", JSON.stringify({ id: "INV2-PAID", status: "SENT", reference: ref }));
  await env.LEDGER.put("sync:last", String(Date.now()));
  const realFetch = globalThis.fetch;
  let invoiceReads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token", expires_in: 3600 });
    if (url.endsWith("/v2/invoicing/invoices/INV2-PAID")) {
      invoiceReads++;
      return Response.json({ id: "INV2-PAID", status: "PAID", detail: { memo: ref, metadata: { last_update_time: utc } },
        payments: { transactions: [{ payment_id: "CAP-TIME", payment_date_time: raw, payment_date: "2026-11-01", amount: { value: "49.00", currency_code: "USD" } }] } });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await app.scheduled({ cron: "*/5 * * * *" }, env);
    const payment = await env.LEDGER.get("pay:CAP-TIME", "json");
    assert.equal(invoiceReads, 1);
    assert.equal(payment.captured_at, "2026-11-02T02:35:27.000Z");
    assert.equal(payment.paypal_payment_date, raw);
    assert.equal(payment.via, "invoice");
  } finally { globalThis.fetch = realFetch; }
});

test("invoice time repair uses the recorded UTC source and preserves PayPal's raw date", () => {
  const row = { capture_id: "CAP-TIME", order_id: "INV2-PAID", via: "invoice", captured_at: "2026-11-01T18:35:27Z", payer_key: "private" };
  const fixed = correctedInvoiceRecord(row, [{ id: "INV2-PAID", paid_at: "2026-11-02T02:36:00Z" }]);
  assert.equal(fixed.captured_at, "2026-11-02T02:36:00.000Z");
  assert.equal(fixed.paypal_payment_date, row.captured_at);
  assert.ok(!("payer_key" in fixed));
});

test("Claude failures and the shared daily cap return saved runs without exposing the provider error", async () => {
  const env = { LEDGER: kv(), ANTHROPIC_API_KEY: "test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret",
    ASSETS: { async fetch() { return new Response("lead,ad,source,click_id,asked_for,email,message\nLead 01 (fictional),free_guide,fb,IwARlead01,trial class price,lead01@example.com,How much is the trial class?"); } } };
  const day = new Date().toISOString().slice(0, 10);
  await env.LEDGER.put(`quota:Claude runs:${day}`, "118"); // two runs left under the shared cap of 120
  await env.LEDGER.put("run:owner", JSON.stringify({ at: "2026-11-02T00:00:00Z", instruction: "Old ask", recommendation: { headline: "Saved budget note", actions: [] }, ads: [] }));
  await env.LEDGER.put("rec:latest", JSON.stringify({ at: "2026-11-02T00:00:00Z", recommendation: { headline: "Saved recommendation", actions: [] } }));
  await env.LEDGER.put("run:revenue", JSON.stringify({ at: "2026-11-02T00:00:00Z", summary: "Saved invoice result", drafts: [], skips: [], refusals: [], trace: [], ms: 12 }));
  const realFetch = globalThis.fetch;
  let llmCalls = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://api.anthropic.com/v1/messages");
    llmCalls++;
    return Response.json({ error: { message: "private provider detail" } }, { status: 500 });
  };
  try {
    const budget = await app.fetch(new Request("https://paid-signal.test/api/agent", { method: "POST", headers: { origin: "https://paid-signal.test", "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" }, body: JSON.stringify({ csv: "ad,spend,leads\ntrial_video,10,1", instruction: "Another ask" }) }), env);
    const budgetBody = await budget.json();
    assert.equal(budget.status, 502);
    assert.match(budgetBody.error, /Latest saved run from/);
    assert.equal(budgetBody.fallback.run.instruction, "Old ask");
    assert.ok(!JSON.stringify(budgetBody).includes("private provider detail"));

    const revenue = await app.fetch(new Request("https://paid-signal.test/api/agent/revenue", { method: "POST", headers: { origin: "https://paid-signal.test", "content-type": "application/json", "cf-connecting-ip": "192.0.2.2" }, body: "{}" }), env);
    const revenueBody = await revenue.json();
    assert.equal(revenue.status, 502);
    assert.match(revenueBody.error, /Latest saved invoice run/);
    assert.equal(revenueBody.fallback.run.summary, "Saved invoice result");
    assert.ok(!JSON.stringify(revenueBody).includes("private provider detail"));

    const capped = await app.fetch(new Request("https://paid-signal.test/api/agent/revenue", { method: "POST", headers: { origin: "https://paid-signal.test", "content-type": "application/json", "cf-connecting-ip": "192.0.2.3" }, body: "{}" }), env);
    assert.equal(capped.status, 429);
    assert.match((await capped.json()).error, /Latest saved invoice run/);
    assert.equal(llmCalls, 2);
  } finally { globalThis.fetch = realFetch; }
});
