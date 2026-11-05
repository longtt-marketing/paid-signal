import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/revenue.js";
import { replayShop, shopPayments, validateShopHeaders } from "../src/shopReplay.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const orders = parseCsv(read("../docs/proof/merchant-case-orders-2026-10.csv"));
const payments = parseCsv(read("../docs/proof/merchant-case-payments-2026-10.csv"));
const refunds = parseCsv(read("../docs/proof/merchant-case-refunds-2026-10.csv"));
const proof = JSON.parse(read("../docs/proof/merchant-case-2026-10.json"));

test("shop book headers accept the Vietnamese example columns", () => {
  assert.deepEqual(validateShopHeaders(orders, payments, refunds), []);
  assert.deepEqual(shopPayments(orders, payments.slice(0, 1), refunds.slice(0, 1))[0], {
    capture_id: payments[0]["Mã giao dịch nội bộ"], order_id: payments[0]["Số đối chiếu"], ad: payments[0]["Nhóm Ads"],
    amount: payments[0]["Số tiền thu"], currency: "VND", captured_at: "2026-10-01T14:38:00+07:00", refunded_amount: "0",
    payer_email_sha256: orders.find((o) => o["Mã đơn nội bộ"] === payments[0]["Số đối chiếu"])["Mã khách ẩn danh"],
    method: "bank_transfer", duplicate_in_book: false, refund_count: 0, refund_total: 0,
  });
});

test("shop book headers accept English equivalents", () => {
  const o = [{ order_id: "O1", customer_id: "C1", ad_group: "A", amount: "1200", status: "paid" }];
  const p = [{ payment_id: "P1", order_id: "O1", ad_group: "A", type: "first payment", paid_at: "2026-10-01 14:38", amount: "1200" }];
  const r = [{ refunded_payment_id: "P1", refund_amount: "100" }];
  assert.deepEqual(validateShopHeaders(o, p, r), []);
  assert.equal(shopPayments(o, p, r)[0].refunded_amount, "100");
  assert.equal(shopPayments(o, p, r)[0].payer_email_sha256, "C1");
});

test("shop book reports the specific missing required columns", () => {
  assert.deepEqual(validateShopHeaders([{ order_id: "O1" }], [{ payment_id: "P1" }], [{}]), [
    "order book: customer_id", "order book: ad_group", "order book: invoice value", "order book: status",
    "payments: order_id", "payments: ad_group", "payments: type", "payments: paid_at", "payments: amount",
    "refunds: refunded_payment_id", "refunds: refund_amount",
  ]);
});

test("published gift shop book replays to the shared ledger totals and group counts", () => {
  const groups = proof.groups.map((g) => ({ id: g.id, spend: g.spend, conversations: g.conversations, first_paid: g.first_paid, full_refunds: g.full_refunds, gross: g.gross, refunded: g.refunded }));
  const result = replayShop({ orders, payments, refunds, groups, includeDetails: true });
  assert.equal(result.totals.paid, 705);
  assert.equal(result.totals.revenue, 1_317_000_000);
  assert.deepEqual(result.groups.map((g) => [g.id, g.paid]), [["A", 145], ["B", 390], ["C", 170]]);
  assert.equal(result.groups.reduce((n, g) => n + g.held, 0), 7);
  assert.deepEqual(result.rankings, { cost_per_chat: ["A", "B", "C"], kept_per_ad_dollar: ["B", "C", "A"] });
});

test("browser shop replay is an exact copy of the Worker module", () => {
  assert.equal(readFileSync(new URL("../public/lib/shopReplay.js", import.meta.url), "utf8"), readFileSync(new URL("../src/shopReplay.js", import.meta.url), "utf8"));
});

test("audit book: a payment for an order the book lacks, and a refund for a payment it lacks, are shown and not counted", async () => {
  const { replayShop } = await import("../src/shopReplay.js");
  const orders = [{ order_id: "O1", customer_id: "C1", ad_group: "A", amount: "100", status: "paid" }];
  const payments = [
    { payment_id: "P1", order_id: "O1", ad_group: "A", type: "first", paid_at: "2026-10-01 10:00", amount: "100" },
    { payment_id: "P9", order_id: "O9", ad_group: "A", type: "first", paid_at: "2026-10-01 11:00", amount: "500" },
  ];
  const refunds = [{ refunded_payment_id: "PX", refund_amount: "50" }];
  const r = replayShop({ orders, payments, refunds, includeDetails: true });
  assert.equal(r.totals.paid, 1);
  assert.equal(r.totals.revenue, 100);
  assert.deepEqual([r.totals.unmatched_payments, r.totals.unmatched_payment_amount, r.totals.unmatched_refunds], [1, 500, 1]);
  assert.equal(r.groups.find((g) => g.id === "A").unmatched_orders, 1);
});
