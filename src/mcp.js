// Paid Signal as an MCP server (streamable HTTP, JSON responses): any MCP client, such as Claude Desktop, can ask which
// ads bring paying PayPal customers. Read-only on purpose: the public demo exposes no write tool here. propose_budget
// only proposes; a person approves changes in the dashboard, so an outside agent can advise but never act.

export const MCP_TOOLS = [
  { name: "read_paid_signal", description: "Per ad: spend, leads the ad platform reports, PayPal paid orders, refunds, net paid revenue and cost per paid order, plus totals and possible duplicate payments (held out of paid orders until refunded). Computed in code from the ad export and PayPal captures.", inputSchema: { type: "object", properties: { csv: { type: "string", description: "Optional ad export CSV (ad, spend, leads). Defaults to the demo export." } } } },
  { name: "list_unpaid_leads", description: "Leads the ad export counted that never paid through PayPal, with their ad, what they asked about, and any invoice already drafted or sent.", inputSchema: { type: "object", properties: {} } },
  { name: "list_payments", description: "Every PayPal capture in the ledger with its ad, click source, amount, refunds and possible duplicate flag.", inputSchema: { type: "object", properties: {} } },
  { name: "get_ad_truth", description: "Per ad, the whole path: leads the ad platform reports, leads invoiced through PayPal, orders PayPal confirms paid, possible duplicates held, refunds, and Purchase events Meta received. The gap between the first and the last column is what the ad platform does not know.", inputSchema: { type: "object", properties: {} } },
  { name: "propose_budget", description: "Proposes next period's split of an ad budget by PayPal-confirmed paid orders per dollar, keeping at least 10% on every ad. Changes nothing: a person approves budget changes in the Paid Signal dashboard.", inputSchema: { type: "object", properties: { budget_usd: { type: "number", minimum: 1, maximum: 1000000, description: "Total budget for the next period. Defaults to the current spend." } } } },
  { name: "check_paypal_ledger", description: "Cross-check the ledger against PayPal Transaction Search: matched captures, ones PayPal's report has not caught up with, and any PayPal payment the ledger missed.", inputSchema: { type: "object", properties: {} } },
];

/**
 * @param {any} msg JSON-RPC request or notification
 * @param {(name: string, args: any) => Promise<any>} call runs a tool and returns JSON-able data
 */
export async function handleMcp(msg, call) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const error = (code, message) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(-32600, "Invalid request");
  if (msg.id === undefined) return null; // notifications (e.g. notifications/initialized) need no answer
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: msg.params?.protocolVersion || "2025-03-26", capabilities: { tools: {} },
        serverInfo: { name: "paid-signal", version: "1.0.0" },
        instructions: "Paid Signal matches PayPal payments to the ad clicks behind them. Start with read_paid_signal." });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: MCP_TOOLS.map((t) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: false } })) });
    case "tools/call": {
      const name = msg.params?.name;
      if (!MCP_TOOLS.some((t) => t.name === name)) return error(-32602, `Unknown tool ${name}`);
      try { return reply({ content: [{ type: "text", text: JSON.stringify(await call(name, msg.params?.arguments || {})) }] }); }
      catch (e) { return reply({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true }); }
    }
    default: return error(-32601, `Method not found: ${msg.method}`);
  }
}
