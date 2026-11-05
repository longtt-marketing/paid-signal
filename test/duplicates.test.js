import test from "node:test";
import assert from "node:assert/strict";
import { possibleDuplicates, reconcile } from "../src/ledger.js";

const pay = (id, t, extra = {}) => ({ capture_id: id, payer_email_sha256: "h1", ad: "trial_video", amount: "49.00", currency: "USD", captured_at: t, ...extra });

test("duplicates: a second payment a person confirmed as a separate order is no longer held", () => {
  const two = [pay("A", "2026-11-01T10:00:00Z"), pay("B", "2026-11-01T10:03:00Z")];
  assert.deepEqual(possibleDuplicates(two).map((d) => d.capture_id), ["B"]);
  const confirmed = [two[0], { ...two[1], confirmed_distinct: { at: "2026-11-05T00:00:00Z", reason: "second child" } }];
  assert.deepEqual(possibleDuplicates(confirmed), []);
  const ads = [{ ad: "trial_video", spend_cents: 5000, leads: 2 }];
  const held = reconcile(ads, two).ads.find((a) => a.ad === "trial_video");
  const counted = reconcile(ads, confirmed).ads.find((a) => a.ad === "trial_video");
  assert.equal(held.paid, 1);
  assert.equal(counted.paid, 2);
});

test("duplicates: a replayed capture keeps a person's confirmation", async () => {
  const { recordCapture } = await import("../src/core.js");
  const kv = new Map();
  const env = { LEDGER: { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } } };
  const order = { id: "O1", payer: { email_address: "a@example.com" }, purchase_units: [{ payments: { captures: [{ id: "B", status: "COMPLETED", amount: { value: "49.00", currency_code: "USD" }, custom_id: "a=trial_video;s=fb;c=x;t=0", create_time: "2026-11-01T10:03:00Z" }] } }] };
  await recordCapture(env, order);
  const p = JSON.parse(kv.get("pay:B")); p.confirmed_distinct = { at: "2026-11-05T00:00:00Z", reason: "second child" }; kv.set("pay:B", JSON.stringify(p));
  await recordCapture(env, order);
  assert.equal(JSON.parse(kv.get("pay:B")).confirmed_distinct.reason, "second child");
});

const t = (id, order, minutes, extra = {}) => ({ capture_id: id, order_id: order, payer_email_sha256: "cust-1", ad: "A", amount: "1500000", currency: "VND",
  captured_at: new Date(Date.UTC(2026, 9, 1, 10, 0) + minutes * 60000).toISOString(), method: "bank_transfer", ...extra });

test("duplicates, hard negatives: one customer's two orders by bank transfer are two orders, even minutes apart", () => {
  assert.deepEqual(possibleDuplicates([t("P1", "ORD-1", 0), t("P2", "ORD-2", 12)]), []);
  assert.deepEqual(possibleDuplicates([t("P1", "ORD-1", 0), t("P2", "ORD-2", 3, { amount: "1500000" })]), []);
});

test("duplicates, hard positives: the same order paid twice is held whatever the gap; with no order code the time rule applies", () => {
  assert.deepEqual(possibleDuplicates([t("P1", "ORD-1", 0), t("P2", "ORD-1", 180)]).map((d) => d.capture_id), ["P2"]);
  assert.deepEqual(possibleDuplicates([t("P1", "", 0), t("P2", "", 40)]).map((d) => d.capture_id), ["P2"]);
  assert.deepEqual(possibleDuplicates([t("P1", "", 0), t("P2", "", 90)]), []);
});

test("duplicates: a second, smaller transfer for the same order (a split or top-up) is not a double payment", () => {
  assert.deepEqual(possibleDuplicates([t("P1", "ORD-1", 0, { payer_email_sha256: "cust-1" }), t("P2", "ORD-1", 30, { payer_email_sha256: "cust-2", amount: "500000" })]), []);
});
