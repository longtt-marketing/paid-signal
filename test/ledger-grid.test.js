// The ledger grid's total row: money kept leaves out held double payments and refunds, and subtracts partial refunds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByAd, totalsOf } from "../web/src/gridTotals.js";

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
