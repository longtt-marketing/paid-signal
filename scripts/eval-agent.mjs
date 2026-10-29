// Runs the real budget agent (same code, same model, same gate as /api/agent) N times against the live ledger and
// records how often its first submission passes the evidence gate, what the gate rejected, and the final outcome.
// Reads ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID) from .dev.vars. Usage: node scripts/eval-agent.mjs 10 > docs/proof/agent-runs.json
import { readFileSync } from "node:fs";
import { parseAdCsv, reconcile } from "../src/ledger.js";
import { runAgent, anthropicLLM } from "../src/agent.js";

const vars = Object.fromEntries(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const { payments } = await (await fetch("https://paid-signal.thelongmarketing.workers.dev/api/ledger")).json();
const rec = reconcile(parseAdCsv(readFileSync(new URL("../public/data/demo-ads.csv", import.meta.url), "utf8")).rows, payments);
const llm = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: vars.ANTHROPIC_WORKSPACE_ID });
const runs = [];
for (let i = 0; i < Number(process.argv[2] || 10); i++) {
  const t = Date.now();
  try {
    const out = await runAgent({ llm, rec, payments });
    const subs = out.trace.filter((x) => x.tool === "submit_recommendation");
    runs.push({ run: i + 1, grounded: out.grounded, first_pass: subs[0]?.problems === 0, submissions: subs.map((x) => x.problems), rejected_for: subs.flatMap((x) => x.why || []), seconds: (Date.now() - t) / 1000 });
  } catch (e) { runs.push({ run: i + 1, error: String(e.message).slice(0, 200) }); }
}
const ok = runs.filter((r) => !r.error);
console.log(JSON.stringify({ date: new Date().toISOString().slice(0, 10), model: "claude-sonnet-5-5", payments: payments.length,
  summary: { runs: ok.length, first_pass: ok.filter((r) => r.first_pass).length, grounded_after_one_repair: ok.filter((r) => r.grounded).length, flagged: ok.filter((r) => !r.grounded).length }, runs }, null, 1));
