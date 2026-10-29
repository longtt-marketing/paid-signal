import test from "node:test";
import assert from "node:assert/strict";
import { handleMcp, MCP_TOOLS } from "../src/mcp.js";

const call = async (name, args) => ({ name, args });

test("MCP: initialize, tools/list and notifications", async () => {
  const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, call);
  assert.equal(init.result.serverInfo.name, "paid-signal");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, call), null);
  const list = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, call);
  assert.deepEqual(list.result.tools.map((t) => t.name), MCP_TOOLS.map((t) => t.name));
});

test("MCP: tools/call runs only listed tools and reports tool errors in-band", async () => {
  const ok = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_paid_signal", arguments: { csv: "x" } } }, call);
  assert.deepEqual(JSON.parse(ok.result.content[0].text), { name: "read_paid_signal", args: { csv: "x" } });
  const unknown = await handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "send_money" } }, call);
  assert.equal(unknown.error.code, -32602);
  const failing = await handleMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_payments" } }, async () => { throw new Error("KV down"); });
  assert.equal(failing.result.isError, true);
  assert.equal((await handleMcp({ jsonrpc: "2.0", id: 6, method: "nope" }, call)).error.code, -32601);
});
