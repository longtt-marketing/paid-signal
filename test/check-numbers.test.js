import { test } from "node:test";
import assert from "node:assert/strict";
import { findNumberContradictions, normalizeLedgerPayments } from "../scripts/check-numbers.mjs";
import { reconcile } from "../src/ledger.js";

const stats = {
  totals: { leads: 62, paid: 7, revenue_cents: 33400, spend_cents: 32650, net_cents: 750 },
  ads: [
    { ad: "trial_video", leads: 14, paid: 1, revenue_cents: 4900, spend_cents: 9620, net_cents: -4720 },
    { ad: "free_guide", leads: 31, paid: 1, revenue_cents: 4900, spend_cents: 11840, net_cents: -6940 },
    { ad: "parent_carousel", leads: 11, paid: 3, revenue_cents: 14700, spend_cents: 7190, net_cents: 7510 },
    { ad: "holiday_static", leads: 6, paid: 2, revenue_cents: 9800, spend_cents: 4000, net_cents: 5800 },
  ],
  odds: { free_guide: { chance: 0.14, more_spend_to_decide_cents: 2100 } },
};

test("number checker finds current ledger, revenue, ad count, ratio, and odds contradictions", () => {
  const issues = findNumberContradictions([
    "The live dashboard shows 6 paid orders and $41.50 paid revenue.",
    "The free guide has 2 paid orders and a 12% chance of covering its spend.",
    "The parent carousel brought 11 leads, 3 paid orders, and $2.05 back per $1 of ads.",
  ].join("\n"), stats, "sample.md");
  assert.equal(issues.length, 5);
  assert.deepEqual(issues.map((issue) => issue.line), [1, 1, 2, 2, 3]);
});

test("dated ledger statements stay historical", () => {
  const issues = findNumberContradictions("On the 31 Oct ledger, 6 paid orders, $285.00 paid revenue, and <b>12%</b> chance of covering spend were recorded.", stats, "proof.html");
  assert.deepEqual(issues, []);
});

test("HTML text numbers are checked after tags are removed", () => {
  const issues = findNumberContradictions("<p>Live dashboard has <b>6 paid orders</b> and <b>$41.50</b> paid revenue.</p>", stats, "dashboard.html");
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((issue) => issue.line), [1, 1]);
});

test("decision thresholds and cut points are not mistaken for current totals or spend", () => {
  const issues = findNumberContradictions("Below 3 paid orders an ad's budget does not move, and the free guide has a 14% chance of covering its spend, so if the next $21 brings no paid order, cut it. On the live ledger only one ad has 3 paid orders.", stats, "submission.md");
  assert.deepEqual(issues, []);
});

test("public salted payer keys preserve duplicate handling in reconciliation", () => {
  const payments = normalizeLedgerPayments([
    { capture_id: "first", ad: "free_guide", amount: "49.00", refunded_amount: "0.00", captured_at: "2026-11-01T10:00:00Z", payer_key: "same-salted-key" },
    { capture_id: "second", ad: "free_guide", amount: "49.00", refunded_amount: "0.00", captured_at: "2026-11-01T10:02:00Z", payer_key: "same-salted-key" },
  ]);
  const out = reconcile([{ ad: "free_guide", leads: 2, spend_cents: 5000 }], payments);
  assert.equal(out.totals.paid, 1);
  assert.equal(out.totals.held, 1);
});
