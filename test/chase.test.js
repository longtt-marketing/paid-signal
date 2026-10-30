import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleForReminder, reminderProblem, runChaseAgent } from "../src/chaseAgent.js";

const now = Date.parse("2026-10-30T12:00:00Z");
const inv = (o) => ({ id: "INV2-A", lead: "Lead 13 (fictional)", amount: "88.20", status: "SENT", sent_at: "2026-10-30T05:00:00Z", ...o });

test("chase: only sent, unpaid invoices an hour old and not reminded today are eligible", () => {
  const list = [inv({}), inv({ id: "INV2-B", status: "PAID" }), inv({ id: "INV2-C", sent_at: "2026-10-30T11:30:00Z" }), inv({ id: "INV2-D", reminded_at: "2026-10-30T02:00:00Z" }), inv({ id: "INV2-E", status: "DRAFT", sent_at: null })];
  assert.deepEqual(eligibleForReminder(list, now).map((i) => i.id), ["INV2-A"]);
});

test("chase: a reminder needs a fresh read showing PayPal still waiting, and quotes no other amount", () => {
  const eligible = [inv({})];
  const ok = { invoice_id: "INV2-A", subject: "Your trial class booking", note: "Just a reminder about your booking for two, $88.20." };
  assert.match(reminderProblem(ok, { eligible, read: {}, sent: [] }), /get_invoice/);
  assert.equal(reminderProblem(ok, { eligible, read: { "INV2-A": '{"status":"SENT"}' }, sent: [] }), null);
  assert.match(reminderProblem(ok, { eligible, read: { "INV2-A": '{"status":"PAID"}' }, sent: [] }), /PAID/);
  assert.match(reminderProblem({ ...ok, note: "Pay today and get 20% off $70." }, { eligible, read: { "INV2-A": '{"status":"SENT"}' }, sent: [] }), /only the invoice total/);
  assert.match(reminderProblem({ ...ok, invoice_id: "INV2-Z" }, { eligible, read: {}, sent: [] }), /eligible/);
  assert.match(reminderProblem(ok, { eligible, read: { "INV2-A": '{"status":"SENT"}' }, sent: ["X", "Y", "Z"] }), /At most 3/);
});

test("chase: the model's choice and words reach the toolkit; off-list and unread invoices are refused", async () => {
  const calls = [];
  const tools = { get_invoice: { execute: async () => '{"status":"SENT"}' }, send_invoice_reminder: { execute: async (a) => { calls.push(a); return '""'; } } };
  const turns = [
    { raw: [], calls: [{ id: "1", name: "send_invoice_reminder", input: { invoice_id: "INV2-A", subject: "s", note: "n" } }, { id: "2", name: "send_invoice", input: { invoice_id: "INV2-A" } }] },
    { raw: [], calls: [{ id: "3", name: "get_invoice", input: { invoice_id: "INV2-A" } }, { id: "4", name: "get_invoice", input: { invoice_id: "INV2-Q" } }] },
    { raw: [], calls: [{ id: "5", name: "send_invoice_reminder", input: { invoice_id: "INV2-A", subject: "Your booking", note: "Your trial class is held for you." } }] },
    { raw: [{ type: "text", text: "Reminded Lead 13." }], calls: [] },
  ];
  let i = 0;
  const out = await runChaseAgent({ llm: async () => turns[i++], tools, eligible: [inv({})], leads: [] });
  assert.deepEqual(calls, [{ invoice_id: "INV2-A", subject: "Your booking", note: "Your trial class is held for you." }]);
  assert.equal(out.reminded.length, 1);
  assert.deepEqual(out.trace.filter((t) => t.refused).map((t) => t.refused), ["Call get_invoice for it first.", "not allowlisted", "not eligible"]);
});
