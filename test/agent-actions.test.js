// Every thing an agent wrote to PayPal, from the ledger's own records, newest first; a person's own actions are left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentActions, readBackStatus } from "../src/agentActions.js";

test("agent actions: drafts, sends, reminders, refunds and payouts, newest first; nothing a person did", () => {
  const list = agentActions({
    invoices: [
      { id: "INV2-A", lead: "Lead 3", amount: "49.00", drafted_by: "revenue agent (Claude) via PayPal Agent Toolkit", created_at: "2026-11-01T10:00:00Z",
        sent_by: "send agent (Claude + PayPal Agent Toolkit)", sent_at: "2026-11-01T11:00:00Z", reminded_at: "2026-11-03T09:00:00Z", reminder: { by: "chase agent (Claude + PayPal Agent Toolkit)" } },
      { id: "INV2-B", lead: "Lead 4", amount: "49.00", created_at: "2026-11-02T10:00:00Z" },
    ],
    payments: [
      { capture_id: "CAP1", refund_id: "RF1", refunded_by: "refund agent (Claude + PayPal Agent Toolkit)", refunded_amount: "49.00", refunded_at: "2026-11-02T12:00:00Z" },
      { capture_id: "CAP2", refund_id: "RF2", refunded_by: "the judge's Undo", refunded_amount: "49.00" },
    ],
    payouts: [{ batch_id: "B1", total: "15.00", capture_ids: ["a", "b", "c"], at: "2026-10-31T08:00:00Z" }, { batch_id: "B2", invoice_id: "T1", total: "5.00" }, { batch_id: "B2", state: "paid" }],
  });
  assert.deepEqual(list.map((a) => a.key), ["nudge:INV2-A", "refund:RF1", "send:INV2-A", "draft:INV2-A", "payout:B1"]);
  assert.equal(list.find((a) => a.kind === "payout").did, "paid the ad's creator for 3 paid orders");
  assert.equal(list.find((a) => a.kind === "payout").amount, 15);
});

test("read back: the status word PayPal returns for each kind", () => {
  assert.deepEqual(readBackStatus("invoice", { status: "PAID" }), { status: "PAID", through: "Invoicing v2" });
  assert.deepEqual(readBackStatus("refund", { status: "COMPLETED" }), { status: "COMPLETED", through: "Payments v2" });
  assert.equal(readBackStatus("payout", { batch_header: { batch_status: "SUCCESS" }, items: [{ transaction_status: "SUCCESS" }] }).status, "SUCCESS");
});
