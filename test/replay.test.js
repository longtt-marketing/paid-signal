// Payment-state replay through the Worker itself: PayPal webhooks (refunds, a replayed refund, a replayed capture,
// disputes opened, won, lost and resolved without a clear outcome, a forged event) go to /api/webhook one by one, and
// after each one the ledger, the paid-order count, what Meta and Google would be told, and the budget moves code allows
// are checked against the state that event should leave. PayPal's signature check and the KV store are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/worker.js";
import { reconcile, metaEvents, googleRows, possibleDuplicates, supportedMoves } from "../src/ledger.js";

const kv = () => {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; },
  };
};
const t0 = Date.parse("2026-11-03T10:00:00Z");
const pay = (id, ad, amount, payer, minutes, source = "fb") => ({
  capture_id: id, order_id: `O${id}`, status: "COMPLETED", ad, source, click_id: `IwARreplay${id}`, clicked_at: t0 + minutes * 60000 - 600000,
  amount, currency: "USD", captured_at: new Date(t0 + minutes * 60000).toISOString(), refunded_amount: "0.00", payer_email_sha256: payer,
});
const ADS = [{ ad: "trial_video", spend_cents: 9620, leads: 14 }, { ad: "parent_carousel", spend_cents: 7190, leads: 11 }, { ad: "holiday_static", spend_cents: 4000, leads: 6 }];

test("replay: every PayPal event leaves the ledger, the ad platforms and the budget gate in the state it should", async (t) => {
  const env = { LEDGER: kv(), PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_WEBHOOK_ID: "WH1" };
  for (const p of [
    pay("CAPA", "parent_carousel", "49.00", "payer1", 0), pay("CAPB", "parent_carousel", "49.00", "payer1", 4), // B: same payer 4 minutes later
    pay("CAPC", "trial_video", "49.00", "payer2", 60), pay("CAPD", "trial_video", "149.00", "payer3", 120),
    pay("CAPE", "trial_video", "49.00", "payer4", 180), pay("CAPG", "holiday_static", "49.00", "payer5", 240, "g"),
  ]) await env.LEDGER.put(`pay:${p.capture_id}`, JSON.stringify(p));

  const realFetch = globalThis.fetch;
  let verdict = "SUCCESS"; // what PayPal's verify-webhook-signature answers
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "T", expires_in: 32400 }), { status: 200 });
    if (u.endsWith("/v1/notifications/verify-webhook-signature")) return new Response(JSON.stringify({ verification_status: verdict }), { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  };
  let n = 0;
  const hook = (event, certHost = "api.sandbox.paypal.com") => app.fetch(new Request("https://paid-signal.test/api/webhook", {
    method: "POST", headers: { "content-type": "application/json", "paypal-transmission-id": `T${++n}`, "paypal-cert-url": `https://${certHost}/cert.pem` },
    body: JSON.stringify({ id: `WH-${n}`, ...event }),
  }), env);
  const refund = (id, capture, value) => ({ event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id, amount: { value }, create_time: "2026-11-04T09:00:00Z", links: [{ rel: "up", href: `https://api.sandbox.paypal.com/v2/payments/captures/${capture}` }] } });
  const dispute = (id, capture, status, outcome) => ({ event_type: status === "RESOLVED" ? "CUSTOMER.DISPUTE.RESOLVED" : "CUSTOMER.DISPUTE.CREATED",
    resource: { dispute_id: id, status, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", dispute_amount: { value: "149.00" }, update_time: "2026-11-05T09:00:00Z",
      disputed_transactions: [{ seller_transaction_id: capture }], ...(outcome ? { dispute_outcome: { outcome_code: outcome } } : {}) } });

  /** The state every reader of the ledger sees now. */
  const state = async () => {
    const payments = [...env.LEDGER.m.entries()].filter(([k]) => k.startsWith("pay:")).map(([, v]) => JSON.parse(v));
    const rec = reconcile(ADS, payments);
    const row = (ad) => rec.ads.find((r) => r.ad === ad);
    const hold = new Set(possibleDuplicates(payments).map((d) => d.capture_id));
    const meta = await metaEvents(payments, { sourceUrl: "https://paid-signal.test/shop.html", hold });
    return { payments, rec, row, sentToMeta: meta.events.map((e) => e.event_id.replace("paypal:", "")).sort(), google: googleRows(payments, "PayPal paid order", { hold }), moves: supportedMoves(rec) };
  };
  try {
    await t.test("start: the second payment from the same payer minutes later is not a second order", async () => {
      const s = await state();
      assert.equal(s.row("parent_carousel").paid, 1); assert.equal(s.row("trial_video").paid, 3); assert.equal(s.row("trial_video").revenue_cents, 24700);
      assert.deepEqual(s.sentToMeta, ["CAPA", "CAPC", "CAPD", "CAPE"]);
      assert.ok(s.moves.trial_video && !s.moves.parent_carousel, "only an ad with 3 paid orders can be moved");
    });
    await t.test("a forged webhook (certificate not from PayPal) changes nothing", async () => {
      assert.equal((await hook(refund("RFAKE", "CAPD", "149.00"), "evil.example.com")).status, 401);
      assert.equal((await state()).row("trial_video").revenue_cents, 24700);
    });
    await t.test("a webhook from a PayPal certificate host that PayPal's own check calls FAILURE changes nothing", async () => {
      verdict = "FAILURE";
      try { assert.equal((await hook(refund("RBAD", "CAPD", "149.00"))).status, 401); } finally { verdict = "SUCCESS"; }
      assert.equal((await state()).row("trial_video").revenue_cents, 24700);
    });
    await t.test("a partial refund lowers revenue but keeps the order; replaying it changes nothing", async () => {
      assert.equal((await hook(refund("R1", "CAPC", "9.00"))).status, 200);
      await hook(refund("R1", "CAPC", "9.00"));
      const s = await state(); const c = s.payments.find((p) => p.capture_id === "CAPC");
      assert.equal(c.refunded_amount, "9.00"); assert.equal(c.status, "PARTIALLY_REFUNDED");
      assert.equal(s.row("trial_video").paid, 3); assert.equal(s.row("trial_video").revenue_cents, 23800);
    });
    await t.test("refunding the rest makes it no order at all, and Meta is not told about it", async () => {
      await hook(refund("R2", "CAPC", "40.00"));
      const s = await state();
      assert.equal(s.payments.find((p) => p.capture_id === "CAPC").status, "REFUNDED");
      assert.equal(s.row("trial_video").paid, 2); assert.equal(s.row("trial_video").revenue_cents, 19800);
      assert.ok(!s.sentToMeta.includes("CAPC"));
      assert.ok(!s.moves.trial_video, "down to 2 paid orders: too few to move its budget");
    });
    await t.test("PayPal re-sending the capture event does not wipe the refunds recorded since", async () => {
      await hook({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAPC", status: "COMPLETED", amount: { value: "49.00" } } });
      assert.equal((await state()).payments.find((p) => p.capture_id === "CAPC").refunded_amount, "49.00");
    });
    await t.test("refunding the double payment clears the duplicate flag and leaves one order", async () => {
      await hook(refund("R3", "CAPB", "49.00"));
      const s = await state();
      assert.equal(s.row("parent_carousel").paid, 1); assert.deepEqual(possibleDuplicates(s.payments), []);
    });
    await t.test("an open dispute takes the payment out of paid orders and out of what Meta and Google are told", async () => {
      await hook(dispute("PP-D-1", "CAPD", "OPEN"));
      const s = await state();
      assert.equal(s.row("trial_video").paid, 1); assert.equal(s.row("trial_video").disputed, 1);
      assert.ok(!s.sentToMeta.includes("CAPD"));
    });
    await t.test("a dispute the seller won counts the payment again", async () => {
      await hook(dispute("PP-D-1", "CAPD", "RESOLVED", "RESOLVED_SELLER_FAVOUR"));
      const s = await state();
      assert.equal(s.row("trial_video").paid, 2); assert.equal(s.row("trial_video").revenue_cents, 19800); assert.ok(s.sentToMeta.includes("CAPD"));
    });
    await t.test("a dispute the buyer won counts as a refund", async () => {
      await hook(dispute("PP-D-2", "CAPA", "RESOLVED", "RESOLVED_BUYER_FAVOUR"));
      const s = await state();
      assert.equal(s.row("parent_carousel").paid, 0); assert.ok(!s.sentToMeta.includes("CAPA"));
    });
    await t.test("a dispute resolved without a clear outcome is held, not counted as a win", async () => {
      await hook(dispute("PP-D-3", "CAPE", "RESOLVED", "NONE"));
      const s = await state();
      assert.equal(s.row("trial_video").paid, 1); assert.ok(!s.sentToMeta.includes("CAPE"));
    });
    await t.test("a Google-click buyer goes to Google, and a full refund there becomes a retraction", async () => {
      const before = (await state()).google;
      assert.ok(before.conversions.some((r) => r.order_id === "CAPG") && !before.adjustments.length);
      assert.ok(!(await state()).sentToMeta.includes("CAPG"), "a Google click is not sent to Meta");
      await hook(refund("R4", "CAPG", "49.00"));
      assert.deepEqual((await state()).google.adjustments.map((a) => [a.order_id, a.adjustment_type]), [["CAPG", "RETRACTION"]]);
    });
  } finally { globalThis.fetch = realFetch; }
});

test("decisions: only on the latest checked recommendation, with the move copied from it by the server", async () => {
  const env = { LEDGER: kv() };
  await env.LEDGER.put("rec:latest", JSON.stringify({ id: "R-LIVE1", recommendation: { actions: [{ ad: "free_guide", change: "keep", reason: "Only 1 paid order.", evidence: ["row:free_guide"] }] } }));
  const post = (body, origin = "https://paid-signal.test") => app.fetch(new Request("https://paid-signal.test/api/decisions", {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }), env);
  // a move the gate never saw: a cut on a stale or made-up recommendation
  assert.equal((await post({ ad: "free_guide", change: "reduce", verdict: "approved", rec_id: "R-OLD99", index: 0 })).status, 409);
  // no Origin, or another site's: refused
  assert.equal((await app.fetch(new Request("https://paid-signal.test/api/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), env)).status, 403);
  // the browser's own change and reason are ignored; the stored recommendation's are logged
  const ok = await post({ ad: "free_guide", change: "reduce", reason: "made up", verdict: "approved", rec_id: "R-LIVE1", index: 0 });
  assert.equal(ok.status, 200);
  const d = await ok.json();
  assert.deepEqual([d.change, d.reason, d.rec_id], ["keep", "Only 1 paid order.", "R-LIVE1"]);
});

test("recommendations and decisions stay with each visitor; only the bundled owner run updates the shared recommendation", async () => {
  const demoCsv = "ad,spend,leads\ntrial_video,96.20,14\nfree_guide,118.40,31\nparent_carousel,71.90,11\nholiday_static,40.00,6\n";
  const shared = { id: "R-SHARED", at: "2026-11-01T00:00:00.000Z", source: "budget agent", recommendation: { headline: "Shared live run", actions: [] } };
  const env = {
    LEDGER: kv(),
    ASSETS: { async fetch() { return new Response(demoCsv, { headers: { "content-type": "text/csv" } }); } },
    ANTHROPIC_API_KEY: "test-key",
  };
  await env.LEDGER.put("rec:latest", JSON.stringify(shared));
  await env.LEDGER.put("run:owner", JSON.stringify({ at: shared.at, recommendation: { headline: "Prior owner run" } }));

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "submit-1", name: "submit_recommendation", input: {
      headline: "Keep the free guide budget until paid orders support a move.",
      actions: [{ ad: "free_guide", change: "keep", reason: "It needs more paid orders before its budget moves.", evidence: ["row:free_guide"] }],
    } }] }), { headers: { "content-type": "application/json" } });
  };
  const cookieA = "ps_vid=11111111-1111-4111-8111-111111111111";
  const cookieB = "ps_vid=22222222-2222-4222-8222-222222222222";
  const post = (path, body, cookie) => app.fetch(new Request(`https://paid-signal.test${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://paid-signal.test", cookie }, body: JSON.stringify(body),
  }), env);
  const get = (path, cookie) => app.fetch(new Request(`https://paid-signal.test${path}`, { headers: { cookie } }), env);
  try {
    const editedCsv = demoCsv.replace("free_guide,118.40,31", "free_guide,118.40,32");
    const runA = await (await post("/api/agent", { csv: editedCsv, instruction: "Raise the free guide's budget: it brings the most leads." }, cookieA)).json();
    assert.equal(runA.grounded, true);
    assert.equal(runA.mine, true);
    assert.equal((await env.LEDGER.get("rec:latest", "json")).id, shared.id);
    assert.equal((await env.LEDGER.get("run:owner", "json")).recommendation.headline, "Prior owner run");

    const approved = await post("/api/decisions", { ad: "free_guide", verdict: "approved", rec_id: runA.rec_id, index: 0 }, cookieA);
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).change, "keep");

    const recommendationB = await (await get("/api/recommendation", cookieB)).json();
    const decisionsB = await (await get("/api/decisions", cookieB)).json();
    assert.equal(recommendationB.latest.id, shared.id);
    assert.equal(recommendationB.mine, null);
    assert.deepEqual(recommendationB.decisions, []);
    assert.deepEqual(decisionsB.decisions, []);
    assert.equal(decisionsB.total, 1);

    const runB = await (await post("/api/agent", { csv: demoCsv, instruction: "Raise the free guide's budget: it brings the most leads." }, cookieB)).json();
    assert.equal(runB.grounded, true);
    assert.equal(runB.mine, false);
    assert.equal((await env.LEDGER.get("rec:latest", "json")).id, runB.rec_id);
    assert.equal((await env.LEDGER.get("run:owner", "json")).rec_id, runB.rec_id);
    assert.equal((await env.LEDGER.get(`rec:v:11111111-1111-4111-8111-111111111111`, "json")).id, runA.rec_id);
  } finally { globalThis.fetch = realFetch; }
});

test("a decision without a cookie gets a fresh visitor id and can be read back with that cookie", async () => {
  const env = { LEDGER: kv(), ASSETS: { async fetch() { return new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }); } } };
  await env.LEDGER.put("rec:latest", JSON.stringify({ id: "R-NOCOOKIE", recommendation: { actions: [{ ad: "free_guide", change: "keep", reason: "Grounded reason.", evidence: ["row:free_guide"] }] } }));
  const makeDecision = () => app.fetch(new Request("https://paid-signal.test/api/decisions", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://paid-signal.test" },
    body: JSON.stringify({ ad: "free_guide", verdict: "dismissed", rec_id: "R-NOCOOKIE", index: 0 }),
  }), env);
  const first = await makeDecision(), second = await makeDecision();
  const firstCookie = first.headers.get("set-cookie"), secondCookie = second.headers.get("set-cookie");
  const firstId = firstCookie?.match(/ps_vid=([0-9a-f-]{36})/i)?.[1];
  const secondId = secondCookie?.match(/ps_vid=([0-9a-f-]{36})/i)?.[1];
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.ok(firstId && secondId && firstId !== secondId);
  assert.match(firstCookie, /Max-Age=2592000; Path=\/; SameSite=Lax; Secure; HttpOnly/i);
  for (const id of [firstId, secondId]) {
    const res = await app.fetch(new Request("https://paid-signal.test/api/decisions", { headers: { cookie: `ps_vid=${id}` } }), env);
    assert.equal((await res.json()).decisions.length, 1);
    assert.equal(res.headers.get("set-cookie"), null);
  }
  const page = await app.fetch(new Request("https://paid-signal.test/judge"), env);
  assert.match(page.headers.get("set-cookie"), /ps_vid=[0-9a-f-]{36}; Max-Age=2592000; Path=\/; SameSite=Lax; Secure; HttpOnly/i);
  assert.equal(page.headers.get("cache-control"), "no-store");
});

test("invoice lists never carry a lead's email, including the sync answer", async () => {
  const env = { LEDGER: kv() };
  await env.LEDGER.put("inv:INV2-AAAA", JSON.stringify({ id: "INV2-AAAA", lead: "Lead 99 (fictional)", ad: "free_guide", email: "lead99@example.com", amount: "49.00", status: "DRAFT" }));
  for (const [path, method] of [["/api/invoices", "GET"], ["/api/invoices/sync", "POST"]]) {
    const res = await app.fetch(new Request(`https://paid-signal.test${path}`, { method, headers: { origin: "https://paid-signal.test", "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) }), env);
    const body = await res.text();
    assert.equal(res.status, 200, path);
    assert.ok(body.includes("INV2-AAAA") && !body.includes("lead99@example.com"), path);
  }
});
