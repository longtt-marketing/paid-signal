import { test } from "node:test";
import assert from "node:assert/strict";
import { packClick, unpackClick, parseAdCsv, reconcile, quotableNumbers, ungroundedNumbers, metaEvents, googleRows, possibleDuplicates } from "../src/ledger.js";

const pay = (o) => ({ capture_id: "C1", order_id: "O1", ad: "trial", source: "fb", click_id: "abc", clicked_at: 1793178000000, amount: "49.00", currency: "USD", captured_at: "2026-10-28T10:00:00Z", ...o });

test("click survives the round trip through custom_id and stays within 127 chars", () => {
  const packed = packClick({ ad: "trial;video=1", source: "fb", clickId: "x".repeat(200), clickedAt: 5 });
  assert.ok(packed.length <= 127);
  const back = unpackClick(packClick({ ad: "trial", source: "g", clickId: "Cj0K", clickedAt: 7 }));
  assert.deepEqual(back, { ad: "trial", source: "g", clickId: "Cj0K", clickedAt: 7 });
  assert.equal(unpackClick(packed).ad, "trialvideo1");
});

test("ad export: Meta-style headers, quoted names with commas, bad rows reported", () => {
  const { rows, errors } = parseAdCsv('Ad name,Amount spent (USD),Results\n"Trial, video",96.20,14\nFree guide,118.40,31\n,1,1');
  assert.deepEqual(rows.map((r) => [r.ad, r.spend_cents, r.leads]), [["Trial, video", 9620, 14], ["Free guide", 11840, 31]]);
  assert.equal(errors.length, 1);
  assert.equal(parseAdCsv("foo,bar\n1,2").rows.length, 0);
});

test("reconcile: refunds, partial refunds, unmatched captures and spend with no paid order", () => {
  const ads = [{ ad: "trial", spend_cents: 9620, leads: 14 }, { ad: "guide", spend_cents: 11840, leads: 31 }, { ad: "camp", spend_cents: 4000, leads: 6 }];
  const r = reconcile(ads, [
    pay({ capture_id: "A" }), pay({ capture_id: "B", refunded_amount: "9.00" }),
    pay({ capture_id: "C", ad: "camp", refunded_amount: "49.00" }), pay({ capture_id: "D", ad: "unknown" }),
  ]);
  const trial = r.ads.find((a) => a.ad === "trial");
  assert.equal(trial.paid, 2); assert.equal(trial.revenue_cents, 8900); assert.equal(trial.cost_per_paid_cents, 4810);
  const camp = r.ads.find((a) => a.ad === "camp");
  assert.equal(camp.paid, 0); assert.equal(camp.refunded, 1); assert.equal(camp.revenue_cents, 0);
  assert.deepEqual(r.unmatched_captures, ["D"]);
  assert.equal(r.totals.spend_without_paid_cents, 11840 + 4000);
});

test("grounding: only numbers the reconciliation produced may appear", () => {
  const r = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }], [pay({})]);
  const ok = quotableNumbers(r);
  assert.deepEqual(ungroundedNumbers("Trial spent $96.20 for 14 leads and 1 paid order at $96.20.", ok), []);
  assert.deepEqual(ungroundedNumbers("Trial will return 3x and 25% more.", ok), ["3", "25%"]);
});

test("Meta events: fbc format, deterministic event_id, refunded held back, hashed email", async () => {
  const { events, held } = await metaEvents([pay({ payer_email: " Buyer@Example.com " }), pay({ capture_id: "R", refunded_amount: "49" }), pay({ capture_id: "N", source: "other", click_id: "" })]);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, "paypal:C1");
  assert.equal(events[0].user_data.fbc, "fb.1.1793178000000.abc");
  assert.match(events[0].user_data.em[0], /^[0-9a-f]{64}$/);
  assert.deepEqual(held.map((h) => h.reason), ["fully refunded", "no ad click"]);
});

test("Google rows: retraction for a full refund, restatement for a partial one", () => {
  const { conversions, adjustments } = googleRows([pay({ source: "g", capture_id: "G1", refunded_amount: "49.00" }), pay({ source: "g", capture_id: "G2", refunded_amount: "10" }), pay({})]);
  assert.equal(conversions.length, 2);
  assert.match(conversions[0].conversion_time, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\+00:00$/);
  assert.deepEqual(adjustments.map((a) => [a.order_id, a.adjustment_type, a.adjusted_value]), [["G1", "RETRACTION", undefined], ["G2", "RESTATEMENT", "39.00"]]);
});

test("a real Meta export maps to ad name, amount spent and results", () => {
  const { rows } = parseAdCsv("Campaign name,Ad set name,Ad name,Results,Cost per results,Amount spent (USD)\nSpring,Set A,Trial video,14,6.87,96.20");
  assert.deepEqual(rows.map((r) => [r.ad, r.spend_cents, r.leads]), [["Trial video", 9620, 14]]);
});

test("capture ids quoted as evidence are not mistaken for numbers", () => {
  const r = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }], [pay({})]);
  assert.deepEqual(ungroundedNumbers("Capture 59A98014DG653005N is the only payer for trial.", quotableNumbers(r)), []);
});

test("a second payment by the same payer for the same ad within minutes is flagged; refunded or later ones are not", () => {
  const h = { payer_email_sha256: "abc" };
  const d = possibleDuplicates([pay({ ...h, capture_id: "A", captured_at: "2026-10-29T04:29:46Z" }), pay({ ...h, capture_id: "B", captured_at: "2026-10-29T04:30:03Z" }),
    pay({ ...h, capture_id: "C", captured_at: "2026-10-29T09:00:00Z" }), pay({ ...h, capture_id: "D", ad: "other", captured_at: "2026-10-29T09:00:05Z" })]);
  assert.deepEqual(d, [{ capture_id: "B", first: "A", seconds: 17 }]);
  assert.deepEqual(possibleDuplicates([pay({ ...h, capture_id: "A" }), pay({ ...h, capture_id: "B", refunded_amount: "49.00" })]), []);
});

test("attribution windows: no Meta event 28+ days after the click, no Google row 90+ days after", async () => {
  const late = (days, o) => pay({ clicked_at: Date.parse("2026-10-28T10:00:00Z") - days * 86400000, ...o });
  assert.deepEqual((await metaEvents([late(30, {})])).held.map((h) => h.reason), ["paid more than 28 days after the click"]);
  assert.equal((await metaEvents([late(20, {})])).events.length, 1);
  assert.equal(googleRows([late(91, { source: "g" })]).conversions.length, 0);
  assert.equal(googleRows([late(60, { source: "g" })]).conversions.length, 1);
});

test("all-digit capture ids are evidence, not numbers", () => {
  const r = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }], [pay({})]);
  assert.deepEqual(ungroundedNumbers("Capture 71264306943252202 was refunded.", quotableNumbers(r)), []);
});

test("a possible duplicate is held back from Meta and Google while flagged", async () => {
  const hold = new Set(["D2"]);
  const meta = await metaEvents([pay({ capture_id: "D1" }), pay({ capture_id: "D2" })], { hold });
  assert.deepEqual(meta.events.map((e) => e.event_id), ["paypal:D1"]);
  assert.deepEqual(meta.held, [{ capture_id: "D2", reason: "possible duplicate" }]);
  assert.equal(googleRows([pay({ source: "g", capture_id: "D1" }), pay({ source: "g", capture_id: "D2" })], undefined, { hold }).conversions.length, 1);
});
