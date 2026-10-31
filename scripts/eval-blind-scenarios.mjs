// Blind holdout for the budget decision: 10 synthetic weeks written by a separate analyst agent that never read this
// repository's code (docs/proof/blind-scenarios.json, with its own right answers and reasons). Three things are scored
// apart: is every number grounded (the gate), are the moves economically right by the analyst's answers, and is the
// whole week right (no wrong move and every must-move made). The leads-per-dollar rule and the gate's own direction
// rule (supportedMoves) are scored on the same answers, so a disagreement between our rule and the analyst shows up.
// Usage: node scripts/eval-blind-scenarios.mjs 2 [docs/proof/blind-scenarios-2.json] > docs/proof/blind-scenarios-run-2.json
// Set 1 (blind-scenarios.json) was run once before the rule was changed (blind-scenarios-run-1.json); seeing it led to two
// rule changes (no cut for an ad that covers its spend after costs; no keep for one that does not), so set 2 was written
// afterwards, again without the code, to test the changed rule.
import { readFileSync } from "node:fs";
import { reconcile, supportedMoves } from "../src/ledger.js";
import { runAgent, anthropicLLM } from "../src/agent.js";
import { leadsRule } from "../src/scenarios.js";

/** As src/scenarios.js grade(), with the analyst's one convention: a pause meets a must-move "reduce" (a cut). */
function grade(s, actions) {
  const wrong = actions.filter((a) => s.right[a.ad] && !s.right[a.ad].includes(a.change)).map((a) => `${a.ad}: ${a.change}`);
  const made = s.moves.filter(([ad, change]) => actions.some((a) => a.ad === ad && (a.change === change || (change === "reduce" && a.change === "pause"))));
  return { ok: wrong.length === 0 && made.length === s.moves.length, wrong, moves_made: made.length, moves_expected: s.moves.length };
}

const vars = Object.fromEntries(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const llm = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: vars.ANTHROPIC_WORKSPACE_ID });
const RUNS = Number(process.argv[2] || 2);
const FILE = process.argv[3] || "docs/proof/blind-scenarios.json";
const blind = JSON.parse(readFileSync(new URL(`../${FILE}`, import.meta.url), "utf8"));

/** The analyst's plain description of a week, as ledger payments. */
function toWeek(b) {
  const t0 = Date.parse("2026-11-09T10:00:00Z");
  const payments = [], last = {};
  b.payments.forEach((x, i) => {
    const n = String(i + 1).padStart(3, "0");
    const same = x.same_payer_as_previous_minutes_apart != null && last[x.ad];
    const at = same ? Date.parse(last[x.ad].captured_at) + Number(x.same_payer_as_previous_minutes_apart) * 60000 : t0 + i * 3600000;
    const p = {
      capture_id: `BL${b.id.toUpperCase()}CAP${n}X`, order_id: `BL${b.id.toUpperCase()}ORD${n}X`, status: "COMPLETED", ad: x.ad, source: "fb",
      click_id: `IwARblind${b.id}${n}`, clicked_at: at - 3600000, amount: Number(x.amount).toFixed(2), currency: "USD",
      captured_at: new Date(at).toISOString(), refunded_amount: Number(x.refunded || 0).toFixed(2),
      payer_email_sha256: same ? last[x.ad].payer_email_sha256 : `blindpayer${b.id}${n}`, synthetic: true,
      ...(x.open_dispute ? { dispute: { status: "OPEN", outcome: null } } : {}),
    };
    payments.push(p); last[x.ad] = p;
  });
  return {
    id: b.id, name: b.name, payments,
    ads: b.ads.map((a) => ({ ad: a.ad, spend_cents: Math.round(a.spend_usd * 100), leads: a.leads })),
    right: b.right, moves: b.must_moves,
  };
}

const out = [];
for (const b of blind) {
  const s = toWeek(b);
  const rec = reconcile(s.ads, s.payments);
  const sup = supportedMoves(rec);
  // the gate's own rule as an advisor: raise what it would let through, cut what it would let through, keep the rest
  const gateRule = rec.ads.map((r) => ({ ad: r.ad, change: sup[r.ad]?.increase ? "increase" : sup[r.ad]?.reduce ? "reduce" : "keep" }));
  const agentRuns = [];
  for (let r = 0; r < RUNS; r++) {
    try {
      const res = await runAgent({ llm, rec, payments: s.payments });
      const actions = res.recommendation?.actions || [];
      agentRuns.push({ grounded: res.grounded, first_pass: res.trace.filter((t) => t.tool === "submit_recommendation").length === 1, ...grade(s, actions), actions: actions.map((a) => `${a.ad}: ${a.change}`), problems: res.problems?.length ? res.problems : undefined });
    } catch (e) { agentRuns.push({ error: String(e.message).slice(0, 160) }); }
  }
  out.push({ scenario: s.id, name: s.name, leads_rule: grade(s, leadsRule(s)), gate_rule: { ...grade(s, gateRule), actions: gateRule.map((a) => `${a.ad}: ${a.change}`) }, agent: agentRuns });
}
const runs = out.flatMap((o) => o.agent).filter((a) => !a.error);
console.log(JSON.stringify({
  date: new Date().toISOString().slice(0, 10), kind: "blind synthetic weeks: written by a separate analyst agent that did not read the code", file: FILE,
  model: "claude-sonnet-5-5", runs_per_scenario: RUNS,
  summary: {
    scenarios: blind.length,
    leads_per_dollar_rule_weeks_right: out.filter((o) => o.leads_rule.ok).length,
    gate_rule_weeks_right: out.filter((o) => o.gate_rule.ok).length,
    agent_grounded_first_pass: `${runs.filter((a) => a.grounded && a.first_pass).length} of ${runs.length}`,
    agent_grounded_after_one_repair: `${runs.filter((a) => a.grounded).length} of ${runs.length}`,
    agent_runs_with_a_wrong_move: runs.filter((a) => a.wrong.length).length,
    agent_must_moves_made: `${runs.reduce((n, a) => n + a.moves_made, 0)} of ${runs.reduce((n, a) => n + a.moves_expected, 0)}`,
    agent_weeks_fully_right: `${runs.filter((a) => a.ok && a.grounded).length} of ${runs.length}`,
  },
  scenarios: out,
}, null, 1));
