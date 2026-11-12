// Claude as an outside selling agent, end to end, through Anthropic's MCP connector pointed at Paid Signal's public /mcp.
// Phase 1:  node scripts/mcp-claude-sale.mjs start          Claude reads the offer and starts a PayPal sandbox checkout.
// (a person approves the order on PayPal's sandbox page as the buyer)
// Phase 2:  node scripts/mcp-claude-sale.mjs finish <order>  Claude checks the order (the server captures it once approved)
//           and asks for its commission, which then waits for the owner on /judge.
// Each phase appends what Claude called, what the server returned and Claude's words to docs/proof/mcp-claude-sale-<date>.md.
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const MCP = "https://paid-signal.thelongmarketing.workers.dev/mcp";
const MODEL = "claude-sonnet-5-5";
const AGENT = "claude-sales-agent";
const [phase, orderId] = process.argv.slice(2);
const PROMPTS = {
  start: `You are a shopping agent selling for this shop through the paid-signal tools. Your agent_name is "${AGENT}". A buyer asked you for one trial class. Read the offer, start a PayPal checkout for the buyer, and give the approve link. Report exactly what each tool returned.`,
  finish: `You are the shopping agent "${AGENT}" for this shop, using the paid-signal tools. Earlier you started PayPal order ${orderId} for a buyer, and the buyer says they have approved it on PayPal. Check the order's status. If PayPal confirms the payment, ask the shop for your commission on it. Report exactly what each tool returned.`,
};
if (!PROMPTS[phase] || (phase === "finish" && !orderId)) { console.error("usage: start | finish <order_id>"); process.exit(2); }

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "mcp-client-2025-11-20",
    ...(env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : {}) },
  body: JSON.stringify({
    model: MODEL, max_tokens: 2000,
    mcp_servers: [{ type: "url", url: MCP, name: "paid-signal" }],
    tools: [{ type: "mcp_toolset", mcp_server_name: "paid-signal" }],
    messages: [{ role: "user", content: PROMPTS[phase] }],
  }),
});
const body = await res.json();
if (!res.ok) { console.error(res.status, body.error?.message); process.exit(1); }
const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 700 ? s.slice(0, 700) + " …" : s; };
const steps = [];
for (const b of body.content) {
  if (b.type === "mcp_tool_use") steps.push(`- call \`${b.name}\` ${short(b.input)}`);
  if (b.type === "mcp_tool_result") steps.push(`  - result: ${short((b.content || []).map((c) => c.text || "").join(" "))}`);
}
const answer = body.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
const day = new Date().toISOString().slice(0, 10);
const out = new URL(`../docs/proof/mcp-claude-sale-${day}.md`, import.meta.url);
const head = fs.existsSync(out) ? "" : `# Claude as an outside selling agent, end to end (${day})

Anthropic Messages API with the MCP connector pointed at the public endpoint \`${MCP}\`, model \`${MODEL}\`, no other tools (\`scripts/mcp-claude-sale.mjs\`). Between the two phases a person approved the order on PayPal's sandbox page as the sandbox buyer. After phase 2 the owner approves the commission on /judge, and PayPal Payouts pays it to the program's sandbox account.
`;
fs.appendFileSync(out, `${head}
## Phase: ${phase} (${new Date().toISOString().slice(11, 19)} UTC)

Prompt: "${PROMPTS[phase]}"

${steps.join("\n")}

Claude's answer (verbatim):

${answer.split("\n").map((l) => "> " + l).join("\n")}
`);
console.log(steps.join("\n"), "\n---\n", answer);
