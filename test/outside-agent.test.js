import test from "node:test";
import assert from "node:assert/strict";
import { recordCapture, mcpTool, PRODUCT, listPayments } from "../src/core.js";
import { packClick, unpackClick, reconcile } from "../src/ledger.js";
import { route as agentRoute } from "../src/routes/agents.js";
import { MCP_TOOLS, handleMcp } from "../src/mcp.js";

const kv = (seed = {}) => {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { m, async get(k, type) { const v=m.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; }, async put(k,v) { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); }, async delete(k) { m.delete(k); }, async list({prefix=""}={}) { return { keys:[...m.keys()].filter((k)=>k.startsWith(prefix)).map((name)=>({name})), list_complete:true }; } };
};

test("outside MCP write schemas validate names and expose no amount or recipient inputs", () => {
  const schemas = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.inputSchema]));
  assert.match(schemas.start_checkout.properties.agent_name.pattern, /A-Za-z0-9/);
  assert.equal(schemas.start_checkout.properties.agent_name.maxLength, 40);
  assert.equal(schemas.request_refund.properties.reason.maxLength, 200);
  assert.deepEqual(Object.keys(schemas.start_checkout.properties), ["agent_name"]);
  assert.deepEqual(Object.keys(schemas.request_commission.properties), ["agent_name"]);
});

test("tools/list keeps the six existing tools read-only and marks only new write tools as non-destructive", async () => {
  const out = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, async () => null);
  for (const t of out.result.tools.slice(0, 6)) assert.equal(t.annotations.readOnlyHint, true);
  for (const name of ["start_checkout", "get_order_status", "request_refund", "request_commission"]) {
    const t = out.result.tools.find((x) => x.name === name); assert.equal(t.annotations.destructiveHint, false); assert.equal("readOnlyHint" in t.annotations, false);
  }
});

test("agent click custom_id round trips within PayPal's limit", () => {
  const value = packClick({ ad: "ai_agent", source: "agent", clickId: "abc123", clickedAt: 1790000000000 });
  assert.ok(value.length <= 127);
  assert.deepEqual(unpackClick(value), { ad: "ai_agent", source: "agent", clickId: "abc123", clickedAt: 1790000000000 });
});

test("PayPal agent capture is stored separately and never enters ad reconciliation", async () => {
  const LEDGER = kv({ "agentorder:ORDER123456": { order_id: "ORDER123456", agent_name: "sample-agent" } });
  const order = { id: "ORDER123456", purchase_units: [{ custom_id: "a=ai_agent;s=agent;c=abc;t=1790000000000", payments: { captures: [{ id: "CAPTURE123456", status: "COMPLETED", amount: { value: "49.00", currency_code: "USD" } }] } }] };
  const record = await recordCapture({ LEDGER }, order, null);
  assert.equal(record.source, "agent");
  assert.ok(await LEDGER.get("agentpay:CAPTURE123456", "json"));
  assert.equal(await LEDGER.get("pay:CAPTURE123456"), null);
  const payments = await listPayments({ LEDGER });
  const rec = reconcile([{ ad: "trial_video", spend_cents: 1000, leads: 2 }], payments);
  assert.equal(rec.totals.paid, 0);
});

test("request_refund only writes a request and refuses unknown captures", async () => {
  const LEDGER = kv({ "pay:KNOWN123456": { capture_id: "KNOWN123456", amount: "49.00", captured_at: "2026-11-12T00:00:00Z" } });
  const req = new Request("https://paid-signal.test/mcp", { headers: { "cf-connecting-ip": "192.0.2.8" } });
  let paypalCalls = 0;
  const tool = (capture_id) => mcpTool({ LEDGER }, new URL(req.url), "request_refund", { capture_id, reason: "Buyer changed plans", agent_name: "agent.one" }, async () => {}, req, () => { paypalCalls++; });
  const created = await tool("KNOWN123456");
  assert.equal(created.status, "pending");
  assert.equal(paypalCalls, 0);
  await assert.rejects(tool("MISSING123456"), /Unknown capture/);
  await assert.rejects(mcpTool({ LEDGER }, new URL(req.url), "request_refund", { capture_id: "KNOWN123456", reason: "x".repeat(201), agent_name: "agent" }, async () => {}, req), /Invalid/);
});

test("commission request writes pending only for completed orders; invalid agent names are refused", async () => {
  const LEDGER = kv({ "agentpay:CAPTURE123456": { capture_id: "CAPTURE123456", agent_name: "agent.one", amount: "49.00", refunded_amount: "0.00", status: "COMPLETED" } });
  const req = new Request("https://paid-signal.test/mcp", { headers: { "cf-connecting-ip": "192.0.2.11" } });
  const args = { agent_name: "agent.one", amount: "0.01", email: "attacker@example.com" };
  const out = await mcpTool({ LEDGER }, new URL(req.url), "request_commission", args, async () => {}, req);
  assert.equal(out.status, "pending"); assert.equal(out.amount, "5.00");
  const saved = await LEDGER.get(`agentreq:${out.id}`, "json"); assert.equal(saved.capture_ids[0], "CAPTURE123456"); assert.equal(saved.status, "pending");
  await assert.rejects(mcpTool({ LEDGER }, new URL(req.url), "request_commission", { agent_name: "bad\nname" }, async () => {}, req), /agent_name/);
});

test("start_checkout ignores supplied amount and email and uses the fixed product", async () => {
  const LEDGER = kv(), req = new Request("https://paid-signal.test/mcp", { headers: { "cf-connecting-ip": "192.0.2.9" } });
  let sent;
  const out = await mcpTool({ LEDGER, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }, new URL(req.url), "start_checkout",
    { agent_name: "sample-agent", amount: "0.01", email: "attacker@example.com", recipient: "attacker@example.com" }, async () => {}, req,
    () => ({ createOrder: async (input) => { sent = input; return { id: "ORDER123456", links: [{ rel: "approve", href: "https://sandbox.paypal.test/approve" }] }; } }));
  assert.equal(sent.amount, PRODUCT.amount); assert.equal(sent.currency, PRODUCT.currency); assert.equal(sent.description, PRODUCT.name);
  assert.equal(Object.hasOwn(sent, "email"), false); assert.equal(Object.hasOwn(sent, "recipient"), false);
  assert.equal(out.order_id, "ORDER123456"); assert.equal((await LEDGER.get("agentorder:ORDER123456", "json")).agent_name, "sample-agent");
  assert.ok(sent.requestId.length <= 38);
  let calls = 0;
  await assert.rejects(mcpTool({ LEDGER }, new URL(req.url), "start_checkout", { agent_name: "agent\n" }, async () => {}, req, () => { calls++; }), /agent_name/);
  assert.equal(calls, 0);
  await assert.rejects(mcpTool({ LEDGER }, new URL(req.url), "get_order_status", { order_id: "FOREIGN12345" }, async () => {}, req, () => { calls++; }), /Only an order created/);
  assert.equal(calls, 0);
});

test("frozen ad captures are previewed on owner approval and do not call PayPal", async () => {
  const id = "AR-12345678-1234-4234-8234-123456789def";
  const capture = { capture_id: "OLD123456789", status: "COMPLETED", amount: "49.00", captured_at: "2026-10-20T00:00:00Z", evidence: true };
  const LEDGER = kv({ [`agentreq:${id}`]: { id, kind: "refund", status: "pending", capture_id: capture.capture_id, agent_name: "agent" }, [`pay:${capture.capture_id}`]: capture });
  let calls = 0;
  const request = new Request("https://paid-signal.test/api/agent-requests/decide", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.12" }, body: JSON.stringify({ id, decision: "approve" }) });
  const response = await agentRoute({ request, env: { LEDGER }, url: new URL(request.url), pp: {}, orders: { async refundCapture() { calls++; } }, ip: "192.0.2.12" });
  const out = await response.json(); assert.equal(out.request.paypal.preview, true); assert.equal(calls, 0);
});

test("judge includes the MCP connection and live sandbox sample controls", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../public/judge.html", import.meta.url), "utf8"), js = fs.readFileSync(new URL("../public/judge.js", import.meta.url), "utf8");
  assert.match(html, /An outside AI agent buys/); assert.match(html, /Outside agents/); assert.match(html, /Run a sample agent/); assert.match(html, /Ask for an unearned commission/);
  assert.match(js, /tools\/list/); assert.match(js, /start_checkout/); assert.match(js, /api\/agent-requests\/decide/);
});

test("owner commission decision pays once; repeating approve is idempotent", async () => {
  const id = "AR-12345678-1234-4234-8234-123456789abc";
  const LEDGER = kv({ [`agentreq:${id}`]: { id, kind: "commission", status: "pending", agent_name: "sample-agent", amount: "5.00", capture_ids: ["CAPTURE123456"] },
    "agentpay:CAPTURE123456": { capture_id: "CAPTURE123456", agent_name: "sample-agent", amount: "49.00", refunded_amount: "0.00", status: "COMPLETED" } });
  let payouts = 0;
  let recipient;
  const pp = { async createPayout(args) { payouts++; recipient = args.receiver; return { batch_header: { payout_batch_id: args.batchId, batch_status: "PENDING" } }; }, async getPayout() { return { batch_header: { batch_status: "PENDING" } }; } };
  const decide = () => agentRoute({ request: new Request("https://paid-signal.test/api/agent-requests/decide", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.10" }, body: JSON.stringify({ id, decision: "approve" }) }), env: { LEDGER }, url: new URL("https://paid-signal.test/api/agent-requests/decide"), pp, orders: {}, ip: "192.0.2.10" });
  const first = await (await decide()).json(); const second = await (await decide()).json();
  assert.equal(first.request.status, "approved"); assert.equal(second.idempotent, true); assert.equal(payouts, 1); assert.equal(recipient, "TEBYBGHQP8TSW");
});
