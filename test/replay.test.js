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
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "T", expires_in: 32400 }), { status: 200 });
    if (u.endsWith("/v1/notifications/verify-webhook-signature")) return new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 });
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
