// The ledger grid's total row: money kept leaves out held double payments and refunds, and subtracts partial refunds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { totalsOf } from "../web/src/gridTotals.js";

const rows = [
  { amount: 49, status: "Paid", held: false, meta: "Received", raw: {} },
  { amount: 49, status: "Paid, $9.00 back", held: false, meta: "Received", raw: { refunded_amount: "9.00" } },
  { amount: 49, status: "Held: double?", held: true, meta: "Not sent", raw: {} },
  { amount: 49, status: "Refunded", held: false, meta: "No purchase", raw: { refunded_amount: "49.00" } },
];

test("total row: kept after refunds, held and refunded counted apart", () => {
  const t = totalsOf(rows);
  assert.equal(t.amount, 196);
  assert.equal(t.status, "$89.00 kept · 1 held · 1 refunded");
  assert.equal(t.meta, "2 received");
  assert.equal(totalsOf(rows, true).status, "$89.00 kept");
});
