// Claude as an MCP client of Paid Signal: one question through Anthropic's MCP connector, answer saved as proof.
// Usage: node scripts/mcp-claude-run.mjs   (reads ANTHROPIC_API_KEY from .dev.vars; writes docs/proof/mcp-claude-run.md)
import fs from "node:fs";

const env = Object.fromEntries(fs.readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const MCP = "https://paid-signal.thelongmarketing.workers.dev/mcp";
const MODEL = "claude-sonnet-5-5";
const PROMPT = "Using the paid-signal tools: which ad brings paying PayPal customers most cheaply, and is any of its paid orders a possible duplicate?";

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "mcp-client-2025-11-20",
    ...(env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : {}) },
  body: JSON.stringify({
    model: MODEL, max_tokens: 1500,
    mcp_servers: [{ type: "url", url: MCP, name: "paid-signal" }],
    tools: [{ type: "mcp_toolset", mcp_server_name: "paid-signal" }],
    messages: [{ role: "user", content: PROMPT }],
  }),
});
const body = await res.json();
if (!res.ok) { console.error(res.status, body.error?.message); process.exit(1); }
const calls = body.content.filter((b) => b.type === "mcp_tool_use").map((b) => `\`${b.name}\``);
const answer = body.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
const day = new Date().toISOString().slice(0, 10);
fs.writeFileSync(new URL("../docs/proof/mcp-claude-run.md", import.meta.url), `# Claude as an MCP client of Paid Signal (${day})

Request: Anthropic Messages API with the MCP connector (\`mcp_servers: [{ type: "url", url: "${MCP}" }]\`), model \`${MODEL}\`, no other tools (\`scripts/mcp-claude-run.mjs\`).
Prompt: "${PROMPT}"

Tool calls Claude made: ${[...new Set(calls)].join(", ") || "none"}.

Answer (verbatim):

${answer.split("\n").map((l) => "> " + l).join("\n")}

Note: answers from an outside MCP client are not passed through Paid Signal's evidence gate; the gated agents are the budget agents in the app.
`);
console.log(calls.join(" "), "\n---\n", answer);
