// Claude as an outside buying agent: Anthropic's MCP connector pointed at Paid Signal's public /mcp, one shopping task.
// Usage: node scripts/mcp-claude-buy.mjs   (reads ANTHROPIC_API_KEY from .dev.vars; writes docs/proof/mcp-claude-buy-<date>.md)
// The checkout it starts is a real PayPal sandbox order that nobody approves, so no money moves; the commission it asks for
// is refused in code because PayPal has confirmed no sale for this agent.
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const MCP = "https://paid-signal.thelongmarketing.workers.dev/mcp";
const MODEL = "claude-sonnet-5-5";
const PROMPT = "You are a shopping agent using the paid-signal tools, and your agent_name is \"claude-shopping-agent\". "
  + "Find what this shop sells, start a PayPal checkout for one item for a buyer, and check the order's PayPal status. "
  + "Then ask the shop for your commission on that order. Report exactly what each tool returned.";

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "mcp-client-2025-11-20",
    ...(env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : {}) },
  body: JSON.stringify({
    model: MODEL, max_tokens: 2000,
    mcp_servers: [{ type: "url", url: MCP, name: "paid-signal" }],
    tools: [{ type: "mcp_toolset", mcp_server_name: "paid-signal" }],
    messages: [{ role: "user", content: PROMPT }],
  }),
});
const body = await res.json();
if (!res.ok) { console.error(res.status, body.error?.message); process.exit(1); }
const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 600 ? s.slice(0, 600) + " …" : s; };
const steps = [];
for (const b of body.content) {
  if (b.type === "mcp_tool_use") steps.push(`- call \`${b.name}\` ${short(b.input)}`);
  if (b.type === "mcp_tool_result") steps.push(`  - result: ${short((b.content || []).map((c) => c.text || "").join(" "))}`);
}
const answer = body.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
const day = new Date().toISOString().slice(0, 10);
const out = `docs/proof/mcp-claude-buy-${day}.md`;
fs.writeFileSync(new URL("../" + out, import.meta.url), `# Claude as an outside buying agent (${day})

Request: Anthropic Messages API with the MCP connector pointed at the public endpoint \`${MCP}\`, model \`${MODEL}\`, no other tools (\`scripts/mcp-claude-buy.mjs\`). Nobody approved the PayPal order, so no money moved.
Prompt: "${PROMPT}"

Tool calls and what the server returned, in order:

${steps.join("\n")}

Claude's answer (verbatim):

${answer.split("\n").map((l) => "> " + l).join("\n")}
`);
console.log(out, "\n", steps.join("\n"), "\n---\n", answer);
