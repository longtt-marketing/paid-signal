// The ledger grid's total row: money kept leaves out held double payments and refunds, and subtracts partial refunds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { byAdChart, decisionOf, groupByAd, signalSummary, totalsOf } from "../web/src/gridTotals.js";

const rows = [
  { amount: 49, status: "Paid", held: false, meta: "Received", source: "Meta click", raw: {} },
  { amount: 49, status: "Paid, $9.00 back", held: false, meta: "Received", source: "Meta click", raw: { refunded_amount: "9.00" } },
  { amount: 49, status: "Held: double?", held: true, meta: "Not sent", raw: {} },
  { amount: 49, status: "Refunded", held: false, meta: "No purchase", raw: { refunded_amount: "49.00" } },
];

test("total row: kept after refunds, held and refunded counted apart", () => {
  const t = totalsOf(rows);
  assert.equal(t.amount, 196);
  assert.equal(t.kept, 89);
  assert.equal(t.status, "1 held · 1 refunded");
  assert.equal(t.meta, "2 Meta Purchase events · 0 Google rows");
  assert.equal(totalsOf(rows, true).status, "1 held · 1 back");
});

test("Meta totals count Meta receipts and current Google rows, not a legacy Google Meta backfill", () => {
  assert.equal(signalSummary([
    { source: "Meta click", meta: "Received", kept: 49 },
    { source: "Google click", meta: "Received", kept: 49 }, // old Meta backfill, still a Google conversion
    { source: "Google click", meta: "Not sent", kept: 0 }, // fully refunded Google payment
  ]), "1 Meta Purchase events · 1 Google row");
});

test("grouped by ad: a subtotal row per ad, most money kept first, then its payments", () => {
  const list = [
    { ad: "Free guide", amount: 49, kept: 49, held: false, status: "Paid", meta: "Received" },
    { ad: "Testimonial", amount: 49, kept: 49, held: false, status: "Paid", meta: "Received" },
    { ad: "Testimonial", amount: 49, kept: 0, held: false, status: "Refunded", meta: "No purchase" },
    { ad: "Testimonial", amount: 49, kept: 49, held: false, status: "Paid", meta: "Not sent" },
  ];
  const g = groupByAd(list);
  assert.equal(g.length, 6);
  assert.deepEqual([g[0].isGroup, g[0].ad, g[0].kept, g[0].amount, g[0].status], [true, "Testimonial (3)", 98, 147, "0 held · 1 refunded"]);
  assert.equal(g[4].ad, "Free guide (1)");
});

test("chart above the grid: kept, held and refunded per ad add up to what came in", () => {
  const list = [
    { ad: "Testimonial", amount: 49, kept: 49, held: false },
    { ad: "Testimonial", amount: 49, kept: 40, held: false },
    { ad: "Trial class", amount: 49, kept: 0, held: true },
    { ad: "Trial class", amount: 49, kept: 49, held: false },
    { ad: "Free guide", amount: 49, kept: 0, held: false },
  ];
  const c = byAdChart(list);
  assert.deepEqual(c.map((b) => b.ad), ["Testimonial", "Trial class", "Free guide"]);
  assert.deepEqual([c[0].kept, c[0].refunded, c[0].held], [89, 9, 0]);
  assert.deepEqual([c[1].kept, c[1].held], [49, 49]);
  assert.equal(c[2].refunded, 49);
  for (const b of c) assert.equal(b.kept + b.held + b.refunded, 49 * b.payments);
  // a held payment partly refunded: the rest is held, the refund counts as refunded
  const h = byAdChart([{ ad: "X", amount: 100, kept: 0, held: true, back: 25 }, { ad: "Y", amount: 49, kept: 0, held: false, disputed: true }]);
  assert.deepEqual([h.find((b) => b.ad === "X").held, h.find((b) => b.ad === "X").refunded], [75, 25]);
  assert.deepEqual([h.find((b) => b.ad === "Y").held, h.find((b) => b.ad === "Y").refunded], [49, 0]);
});

test("decision cell: held rows can be counted, paid rows refunded, refunded rows are done", () => {
  assert.deepEqual(decisionOf({ held: true }).options, ["Hold", "Separate order…"]);
  assert.equal(decisionOf({ held: false, refundable: true }).value, "Keep");
  assert.deepEqual(decisionOf({ held: false, refundable: false, status: "Refunded" }), { value: "Refunded", options: [] });
});

test("trail row: four steps from the ad click to Meta, and it opens under its own payment only", async () => {
  const { trailSteps, withTrail } = await import("../web/src/gridTotals.js");
  const r = { capture_id: "9NM26871ABC", ad: "Testimonial · carousel", source: "Meta click", via: "invoice", amount: 49, kept: 49, held: false, status: "Paid", meta: "Received by Meta", date: "2026-11-05" };
  const s = trailSteps(r);
  assert.deepEqual(s.map((x) => x.k), ["Ad click", "PayPal", "Ledger", "Meta"]);
  assert.equal(s[0].v, "Meta click on Testimonial · carousel");
  assert.equal(s[1].v, "invoice, capture 9NM26871…, $49.00, 2026-11-05");
  assert.equal(s[2].v, "a paid order, $49.00 kept");
  assert.equal(trailSteps({ ...r, held: true, kept: 0 })[2].v, "held as a possible double payment, $0.00 kept");
  const rows = withTrail([{ isGroup: true, ad: "T (2)" }, r, { ...r, capture_id: "OTHER" }], new Set(["9NM26871ABC"]));
  assert.equal(rows.length, 4);
  assert.equal(rows[2].isDetail, true);
  assert.equal(rows[2].of.capture_id, "9NM26871ABC");
});

test("trail row height follows the grid width", async () => {
  const { trailHeight } = await import("../web/src/gridTotals.js");
  assert.deepEqual([trailHeight(375), trailHeight(700), trailHeight(1300)], [196, 110, 74]);
});

test("picked ad: a click picks that ad alone, a second click on it clears the pick", async () => {
  const { nextPick } = await import("../web/src/adPick.js");
  assert.deepEqual(nextPick([], "Testimonial"), ["Testimonial"]);
  assert.deepEqual(nextPick(["Testimonial"], "Testimonial"), []);
  assert.deepEqual(nextPick(["Testimonial"], "Free guide"), ["Free guide"]);
});

test("claim cell and search: leads against paid orders on a subtotal row; search over ad, capture, status, Meta", async () => {
  const { claimCell, searchRows } = await import("../web/src/adClaims.js");
  assert.deepEqual(claimCell({ leads: 31, paid: 1 }), { text: "31 leads → 1 paid", share: 1 / 31 });
  assert.equal(claimCell({ leads: 0, paid: 0 }).share, 0);
  assert.equal(claimCell(undefined), null);
  const rows = [{ ad: "Testimonial", capture_id: "7G58", status: "Paid", meta: "Received" }, { ad: "Free guide", capture_id: "19L7", status: "Refunded", meta: "Not sent: refunded" }];
  assert.deepEqual(searchRows(rows, "refund").map((r) => r.ad), ["Free guide"]);
  assert.equal(searchRows(rows, "7g5").length, 1);
  assert.equal(searchRows(rows, " ").length, 2);
});

test("shop weeks: an October date gets its October week, a late November payment a November week", async () => {
  const { weekOf } = await import("../web/src/shopWeek.js");
  assert.equal(weekOf("2026-10-03"), "W1 · 1-7 Oct");
  assert.equal(weekOf("2026-10-30"), "W5 · 29-31 Oct");
  assert.equal(weekOf("2026-11-02"), "W6 · 1-7 Nov");
});
