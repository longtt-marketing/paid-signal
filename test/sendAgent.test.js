import test from "node:test";
import assert from "node:assert/strict";
import { runSendAgent } from "../src/sendAgent.js";

const approved = { id: "INV2-OK", lead: "Lead 04", ad: "parent_carousel", amount: "49.00" };
const scripted = (turns) => { let i = 0; return async () => turns[i++]; };
const use = (id, name, input) => ({ raw: [{ type: "tool_use", id, name, input }], calls: [{ id, name, input }] });
const say = (text) => ({ raw: [{ type: "text", text }], calls: [] });

function fakeTools() {
  const calls = [];
  return { calls, tools: {
    get_invoice: { execute: async (a) => { calls.push(["get", a]); return JSON.stringify({ id: a.invoice_id, status: "DRAFT", amount: { currency_code: "USD", value: "49.00" } }); } },
    send_invoice: { execute: async (a) => { calls.push(["send", a]); return JSON.stringify({ links: [] }); } },
  } };
}

test("send agent: checks, then sends only the approved invoice through the toolkit", async () => {
  const { calls, tools } = fakeTools();
  const llm = scripted([use("1", "get_invoice", { invoice_id: "INV2-OK" }), use("2", "send_invoice", { invoice_id: "INV2-OK" }), say("Sent INV2-OK to Lead 04.")]);
  const out = await runSendAgent({ llm, tools, approved });
  assert.equal(out.sent, true);
  assert.deepEqual(calls, [["get", { invoice_id: "INV2-OK" }], ["get", { invoice_id: "INV2-OK" }], ["send", { invoice_id: "INV2-OK", send_to_recipient: true }]]);
  assert.equal(out.summary, "Sent INV2-OK to Lead 04.");
});

test("send agent: a different invoice id or an unlisted tool is refused in code", async () => {
  const { calls, tools } = fakeTools();
  const llm = scripted([use("1", "send_invoice", { invoice_id: "INV2-OTHER" }), use("2", "cancel_sent_invoice", { invoice_id: "INV2-OK" }), say("Stopped.")]);
  const out = await runSendAgent({ llm, tools, approved });
  assert.equal(out.sent, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(out.trace.map((t) => t.refused), ["other invoice", "not allowlisted"]);
});

test("send agent: code re-reads the invoice and refuses a send that is not the approved draft", async () => {
  const cases = [
    [{ status: "SENT", amount: { currency_code: "USD", value: "49.00" } }, /SENT/],
    [{ status: "DRAFT", amount: { currency_code: "USD", value: "490.00" } }, /amount/],
    [{ status: "DRAFT", amount: { currency_code: "EUR", value: "49.00" } }, /currency/],
    [{ error: { message: "x" } }, /did not return/],
  ];
  for (const [inv, why] of cases) {
    const calls = [];
    const tools = { get_invoice: { execute: async () => JSON.stringify(inv) }, send_invoice: { execute: async (a) => { calls.push(a); return "{}"; } } };
    const out = await runSendAgent({ llm: scripted([use("1", "send_invoice", { invoice_id: "INV2-OK" }), say("Not sent.")]), tools, approved });
    assert.equal(out.sent, false);
    assert.deepEqual(calls, []);
    assert.match(out.trace[0].refused, why);
  }
});

test("send agent: the toolkit's HTTP error shape is not counted as sent", async () => {
  const tools = { get_invoice: { execute: async () => JSON.stringify({ status: "DRAFT", amount: { currency_code: "USD", value: "49.00" } }) },
    send_invoice: { execute: async () => JSON.stringify({ ok: false, status: 422, code: "PAYPAL_API_HTTP_ERROR", message: "Unprocessable" }) } };
  const out = await runSendAgent({ llm: scripted([use("1", "send_invoice", { invoice_id: "INV2-OK" }), say("Failed.")]), tools, approved });
  assert.equal(out.sent, false);
  assert.equal(out.trace[0].ok, false);
});

test("send agent: a toolkit error returned as JSON is not counted as sent", async () => {
  const tools = { get_invoice: { execute: async () => JSON.stringify({ status: "DRAFT", amount: { currency_code: "USD", value: "49.00" } }) },
    send_invoice: { execute: async () => JSON.stringify({ error: { message: "Request failed", type: "paypal_error" } }) } };
  const out = await runSendAgent({ llm: scripted([use("1", "send_invoice", { invoice_id: "INV2-OK" }), say("Failed.")]), tools, approved });
  assert.equal(out.sent, false);
  assert.equal(out.trace[0].ok, false);
});
