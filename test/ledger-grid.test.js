// The ledger grid's total row: money kept leaves out held double payments and refunds, and subtracts partial refunds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { byAdChart, decisionOf, groupByAd, totalsOf } from "../web/src/gridTotals.js";

const rows = [
  { amount: 49, status: "Paid", held: false, meta: "Received", raw: {} },
  { amount: 49, status: "Paid, $9.00 back", held: false, meta: "Received", raw: { refunded_amount: "9.00" } },
  { amount: 49, status: "Held: double?", held: true, meta: "Not sent", raw: {} },
  { amount: 49, status: "Refunded", held: false, meta: "No purchase", raw: { refunded_amount: "49.00" } },
];

test("total row: kept after refunds, held and refunded counted apart", () => {
  const t = totalsOf(rows);
  assert.equal(t.amount, 196);
  assert.equal(t.kept, 89);
  assert.equal(t.status, "1 held · 1 refunded");
  assert.equal(t.meta, "2 received");
  assert.equal(totalsOf(rows, true).status, "1 held · 1 back");
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
});

test("decision cell: held rows can be counted, paid rows refunded, refunded rows are done", () => {
  assert.deepEqual(decisionOf({ held: true }).options, ["Hold", "Separate order…"]);
  assert.equal(decisionOf({ held: false, refundable: true }).value, "Keep");
  assert.deepEqual(decisionOf({ held: false, refundable: false, status: "Refunded" }), { value: "Refunded", options: [] });
});
