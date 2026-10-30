// The budget agent on synthetic weeks with known right answers (src/scenarios.js), next to two rules on the same weeks:
// the ad platform's view (move budget toward the most leads per dollar) and Paid Signal's own split by paid orders.
// Real Claude, same gate as /api/agent. Reads ANTHROPIC_API_KEY from .dev.vars.
// Usage: node scripts/eval-budget-scenarios.mjs 2 > docs/proof/budget-scenarios.json   (runs per scenario)
import { readFileSync } from "node:fs";
import { reconcile, proposeSplit } from "../src/ledger.js";
import { runAgent, anthropicLLM } from "../src/agent.js";
import { SCENARIOS, grade, leadsRule } from "../src/scenarios.js";

const vars = Object.fromEntries(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const llm = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: vars.ANTHROPIC_WORKSPACE_ID });
const RUNS = Number(process.argv[2] || 2);
const out = [];
for (const s of SCENARIOS) {
  const rec = reconcile(s.ads, s.payments);
  const rows = rec.ads.map((a) => ({ ad: a.ad, spend: a.spend_cents / 100, paid: a.paid }));
  const split = proposeSplit(rows, rows.reduce((n, x) => n + x.spend, 0));
  const paidRule = split.map((x, i) => ({ ad: x.ad, change: x.budget > rows[i].spend + 0.5 ? "increase" : x.budget < rows[i].spend - 0.5 ? "reduce" : "keep" }));
  const agentRuns = [];
  for (let r = 0; r < RUNS; r++) {
    try {
      const res = await runAgent({ llm, rec, payments: s.payments });
      const actions = res.recommendation?.actions || [];
      agentRuns.push({ grounded: res.grounded, ...grade(s, actions), actions: actions.map((a) => `${a.ad}: ${a.change}`) });
    } catch (e) { agentRuns.push({ error: String(e.message).slice(0, 160) }); }
  }
  out.push({ scenario: s.id, name: s.name, leads_rule: grade(s, leadsRule(s)).ok, paid_orders_rule: grade(s, paidRule).ok, agent: agentRuns });
}
const agentAll = out.flatMap((o) => o.agent).filter((a) => !a.error);
console.log(JSON.stringify({
  date: new Date().toISOString().slice(0, 10), kind: "synthetic scenarios with known right answers", model: "claude-sonnet-5-5", runs_per_scenario: RUNS,
  summary: {
    scenarios: SCENARIOS.length,
    leads_per_dollar_rule_right: out.filter((o) => o.leads_rule).length,
    paid_orders_rule_right: out.filter((o) => o.paid_orders_rule).length,
    agent_runs_right: `${agentAll.filter((a) => a.ok && a.grounded).length} of ${agentAll.length}`,
    agent_runs_with_a_wrong_move: agentAll.filter((a) => a.wrong.length).length,
  },
  scenarios: out,
}, null, 1));
