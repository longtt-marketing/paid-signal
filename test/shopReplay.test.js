// The gift shop's real book through Paid Signal's own ledger code: it must reproduce the accountant's result and catch
// the double transfers as the money arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/revenue.js";
import { replayShop, replayHTML, shopTime } from "../src/shopReplay.js";

const read = (f) => readFileSync(new URL(`../docs/proof/${f}`, import.meta.url), "utf8");
const c = JSON.parse(read("merchant-case-2026-10.json"));
const r = replayShop({ orders: parseCsv(read("merchant-case-orders-2026-10.csv")), payments: parseCsv(read("merchant-case-payments-2026-10.csv")), groups: c.groups });

test("shop replay: the ledger code reproduces the shop's hand-made reconciliation", () => {
  assert.equal(r.totals.payments, 735);
  assert.equal(r.totals.paid, 705);
  assert.equal(r.totals.revenue, 1317000000);
  assert.equal(r.totals.refunded_captures, 30); // 23 order refunds + 7 double transfers sent back
  assert.ok(r.matches_book);
  assert.deepEqual(r.groups.map((g) => [g.id, g.paid, g.revenue]), [["A", 145, 254000000], ["B", 390, 741000000], ["C", 170, 322000000]]);
});

test("shop replay: double transfers are held as they arrive; the checkout window misses most, the bank window none", () => {
  const d = r.duplicates;
  assert.equal(d.in_book, 7);
  assert.deepEqual([d.same_order.caught, d.same_order.false_alarms], [7, 0]);
  assert.deepEqual([d.card_window.caught, d.card_window.false_alarms], [2, 0]);
  assert.equal(r.totals.repeat_customers, 0); // one customer id per order: false alarms cannot be measured on this book
  assert.deepEqual([d.bank_window.caught, d.bank_window.false_alarms, d.bank_window.missed], [7, 0, 0]);
  assert.deepEqual(d.gap_minutes, [4, 5, 11, 15, 24, 26, 31]);
});

test("shop replay: times are read in the shop's zone, and the judge page carries the current block", () => {
  assert.equal(shopTime("2026-10-01 14:38"), "2026-10-01T14:38:00+07:00");
  const html = readFileSync(new URL("../public/judge.html", import.meta.url), "utf8");
  assert.ok(html.includes(`<!--replay:start-->${replayHTML(r)}<!--replay:end-->`));
  assert.deepEqual(JSON.parse(readFileSync(new URL("../public/data/shop-replay.json", import.meta.url), "utf8")), JSON.parse(JSON.stringify(r)));
});
