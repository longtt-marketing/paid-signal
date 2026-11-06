import test from "node:test";
import assert from "node:assert/strict";
import { listPayments, isEvidence, EVIDENCE_BEFORE, tryPaid } from "../src/core.js";
import { tryImpact } from "../src/tryImpact.js";

const VID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const invoiceId = "INV2-TRY-100";
const adRows = [
  { ad: "trial_video", spend_cents: 9620, leads: 14 },
  { ad: "free_guide", spend_cents: 11840, leads: 31 },
  { ad: "parent_carousel", spend_cents: 7190, leads: 11 },
  { ad: "holiday_static", spend_cents: 4000, leads: 6 },
];
const pay = (capture_id, extra = {}) => ({ capture_id, order_id: `ORDER-${capture_id}`, status: "COMPLETED", amount: "49.00", currency: "USD",
  ad: "parent_carousel", source: "other", captured_at: "2026-11-05T10:00:00.000Z", refunded_amount: "0.00", payer_email_sha256: `hash-${capture_id}`,
  via: "invoice", ...extra });
const fixture = ["A", "B", "C", "D"].map((id) => pay(id));
const visitorPayment = pay("TRY-PAY", { visitor: VID, try_invoice: invoiceId, captured_at: "2026-11-05T11:00:00.000Z", buyer_message: "Saturday please" });
const kvEnv = (rows = []) => {
  const kv = new Map(rows.map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const env = { LEDGER: {
    get: async (k, t) => kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null,
    put: async (k, v) => { kv.set(k, String(v)); }, delete: async (k) => { kv.delete(k); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  } };
  return { env, kv };
};

test("try impact uses the ledger rules: 4 to 5, guide unchanged and blocked, refund returns to 4", () => {
  const meta = { capture_id: "TRY-PAY", event_id: "paypal:TRY-PAY", ok: true, events_received: 1 };
  const before = tryImpact({ before: fixture, after: [...fixture, visitorPayment], adRows, payment: visitorPayment, meta, payout: null, refund: null });
  assert.equal(before.ads.parent_carousel.before.paid_orders, 4);
  assert.equal(before.ads.parent_carousel.after.paid_orders, 5);
  assert.equal(before.ads.parent_carousel.before.back_per_ad_dollar.toFixed(2), "2.73");
  assert.equal(before.ads.parent_carousel.after.back_per_ad_dollar.toFixed(2), "3.41");
  assert.deepEqual(before.ads.free_guide.before, before.ads.free_guide.after);
  assert.equal(before.budget.parent_carousel.before_raise_supported, true);
  assert.equal(before.budget.parent_carousel.after_raise_supported, true);
  assert.equal(before.budget.free_guide.before_raise_blocked, true);
  assert.equal(before.budget.free_guide.after_raise_blocked, true);

  const refunded = { ...visitorPayment, status: "REFUNDED", refunded_amount: "49.00", refunded_at: "2026-11-05T12:00:00.000Z" };
  const afterRefund = tryImpact({ before: fixture, after: [...fixture, refunded], adRows, payment: refunded, meta,
    payout: { batch_id: "B-TRY", status: "SUCCESS", read_back: { item_status: "SUCCESS" } }, refund: { id: "R-TRY" } });
  assert.equal(afterRefund.ads.parent_carousel.after.paid_orders, 4);
  assert.equal(afterRefund.meta.refund_note, "already sent; Meta has no retraction, so it is subtracted here");
  assert.equal(afterRefund.creator.owed_back, true);
  assert.equal(afterRefund.refund.refund_id, "R-TRY");
});

test("try payments are visitor scoped and never become evidence", async () => {
  const { env } = kvEnv([["pay:OLD", pay("OLD", { captured_at: "2026-11-01T00:00:00Z" })],
    ["pay:MINE", pay("MINE", { visitor: VID })], ["pay:THEIRS", pay("THEIRS", { visitor: OTHER })]]);
  assert.deepEqual((await listPayments(env, VID)).map((p) => p.capture_id), ["OLD", "MINE"]);
  assert.deepEqual((await listPayments(env, OTHER)).map((p) => p.capture_id), ["OLD", "THEIRS"]);
  assert.ok(!isEvidence(visitorPayment));
  assert.ok(visitorPayment.captured_at >= EVIDENCE_BEFORE);
});

test("PayPal PAID writes one invoice-shaped visitor payment and a retry never overwrites it", async () => {
  const record = { id: invoiceId, vid: VID, email: "judge-lead@example.com", message: "Saturday please", ad: "parent_carousel", channel: "web", amount: "49.00", status: "SENT" };
  const { env, kv } = kvEnv([[`try:${invoiceId}`, record]]);
  const invoice = { id: invoiceId, status: "PAID", payments: { transactions: [{ payment_id: "TRY-PAY", amount: { value: "49.00", currency_code: "USD" }, payment_date_time: "2026-11-05T11:00:00Z" }] } };
  await tryPaid(env, invoice);
  const saved = JSON.parse(kv.get("pay:TRY-PAY"));
  assert.equal(saved.via, "invoice");
  assert.equal(saved.ad, "parent_carousel");
  assert.equal(saved.visitor, VID);
  assert.equal(saved.try_invoice, invoiceId);
  assert.equal(saved.buyer_message, "Saturday please");
  assert.ok(saved.payer_email_sha256);
  assert.equal(isEvidence(saved), false);
  const original = kv.get("pay:TRY-PAY");
  await tryPaid(env, invoice);
  assert.equal(kv.get("pay:TRY-PAY"), original);
});

test("a judge who came through the test ad click: the paid invoice carries the click, so Meta gets a Purchase", async () => {
  const { metaEvents } = await import("../src/ledger.js");
  const clickedAt = Date.parse("2026-11-05T10:58:00Z");
  const record = { id: invoiceId, vid: VID, email: "judge-lead@example.com", ad: "parent_carousel", channel: "web", amount: "49.00", status: "SENT", click: { source: "fb", click_id: "judgeabc123", clicked_at: clickedAt } };
  const { env, kv } = kvEnv([[`try:${invoiceId}`, record]]);
  const invoice = { id: invoiceId, status: "PAID", payments: { transactions: [{ payment_id: "TRY-CLICK", amount: { value: "49.00", currency_code: "USD" }, payment_date_time: "2026-11-05T11:00:00Z" }] } };
  await tryPaid(env, invoice);
  const saved = JSON.parse(kv.get("pay:TRY-CLICK"));
  assert.equal(saved.source, "fb");
  assert.equal(saved.click_id, "judgeabc123");
  assert.equal(saved.clicked_at, clickedAt);
  const { events } = await metaEvents([{ ...saved, captured_at: "2026-11-05T11:00:00Z" }]);
  assert.equal(events.length, 1);
  assert.match(events[0].user_data.fbc, /judgeabc123$/);
});

test("the impact endpoint returns only this browser's paid invoice and payment data", async () => {
  const { route } = await import("../src/routes/invoices.js");
  const ownInvoice = { id: invoiceId, vid: VID, email: "private@example.test", status: "PAID", paid: { payment_id: "MINE" } };
  const rows = [[`try:${invoiceId}`, ownInvoice], ["pay:MINE", pay("MINE", { visitor: VID, try_invoice: invoiceId })],
    ["pay:OTHER", pay("OTHER", { visitor: OTHER })], ...fixture.map((p) => [`pay:${p.capture_id}`, { ...p, captured_at: "2026-11-03T10:00:00.000Z" }])];
  const { env } = kvEnv(rows);
  env.ASSETS = { fetch: async () => new Response("ad,spend,leads\ntrial_video,96.20,14\nfree_guide,118.40,31\nparent_carousel,71.90,11\nholiday_static,40,6") };
  const request = new Request(`https://x.test/api/judge/try/impact?id=${invoiceId}`, { headers: { cookie: `ps_vid=${VID}` } });
  const response = await route({ request, env, url: new URL(request.url), pp: {}, orders: {}, ip: "1" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ads.parent_carousel.before.paid_orders, 4);
  assert.equal(body.ads.parent_carousel.after.paid_orders, 5);
  assert.equal(body.payment_id, "MINE");
  assert.equal(JSON.stringify(body).includes("OTHER"), false);
  assert.equal(JSON.stringify(body).includes("private@example.test"), false);
});

const requestFor = (body) => new Request("https://x.test/api/judge/try/commission", { method: "POST",
  headers: { cookie: `ps_vid=${VID}`, "content-type": "application/json" }, body: JSON.stringify({ invoice_id: invoiceId, ...body }) });
const commissionEnv = (payment, extras = []) => kvEnv([
  [`try:${invoiceId}`, { id: invoiceId, vid: VID, status: "PAID", paid: { payment_id: payment.capture_id } }],
  [`pay:${payment.capture_id}`, payment], ...extras,
]);

test("judge try commission refuses refunded, held, already used, and daily-cap orders", async () => {
  const { route } = await import("../src/routes/invoices.js");
  const call = async (payment, extras = []) => {
    const { env } = commissionEnv(payment, extras);
    return route({ request: requestFor({}), env, url: new URL("https://x.test/api/judge/try/commission"), pp: {}, orders: {}, ip: "1" });
  };
  const refunded = await call({ ...visitorPayment, refunded_amount: "49.00" });
  assert.equal(refunded.status, 400);
  assert.match((await refunded.json()).error, /refunded/);

  const heldPayment = { ...visitorPayment, captured_at: "2026-11-05T11:00:00.000Z" };
  const held = await call(heldPayment, [["pay:FIRST", pay("FIRST", { visitor: VID, payer_email_sha256: heldPayment.payer_email_sha256, captured_at: "2026-11-05T10:59:00.000Z" })]]);
  assert.equal(held.status, 400);
  assert.match((await held.json()).error, /held duplicate/);

  const used = await call(visitorPayment, [[`commission:v:${VID}:once`, { batch_id: "B-ALREADY" }]]);
  assert.equal(used.status, 409);
  assert.match((await used.json()).error, /already used/);

  const cappedKey = `quota:judge try commission payouts:${new Date().toISOString().slice(0, 10)}`;
  const capped = await call(visitorPayment, [[cappedKey, "15"]]);
  assert.equal(capped.status, 429);
  assert.match((await capped.json()).error, /daily limit/);
});
