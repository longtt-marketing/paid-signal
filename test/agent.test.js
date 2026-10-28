import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../src/ledger.js";
import { runAgent, checkRecommendation } from "../src/agent.js";

const ads = [{ ad: "trial", spend_cents: 9620, leads: 14 }, { ad: "guide", spend_cents: 11840, leads: 31 }];
const payments = [{ capture_id: "CAP1", ad: "trial", amount: "49.00", status: "COMPLETED", captured_at: "2026-10-28T10:00:00Z" }];
const rec = reconcile(ads, payments);

// scripted model: reads, then submits; the first submission invents a number, the repair fixes it
function scripted(submissions) {
  let i = 0;
  return async () => {
    const step = i++;
    if (step === 0) return { raw: [], calls: [{ id: "t1", name: "read_reconciliation", input: {} }] };
    const input = submissions[Math.min(step - 1, submissions.length - 1)];
    return { raw: [], calls: [{ id: `s${step}`, name: "submit_recommendation", input }] };
  };
}

test("a grounded recommendation passes the evidence check", async () => {
  const good = { headline: "guide spent $118.40 on 31 leads and 0 paid orders.", actions: [{ ad: "guide", change: "pause", reason: "31 leads, 0 paid.", evidence: ["row:guide"] }] };
  const out = await runAgent({ llm: scripted([good]), rec, payments });
  assert.equal(out.grounded, true);
  assert.equal(out.recommendation.actions[0].change, "pause");
});

test("an invented number is rejected, repaired once, and evidence ids must exist", async () => {
  const bad = { headline: "guide will lose $500 next month.", actions: [{ ad: "guide", change: "pause", reason: "x", evidence: ["CAP9"] }] };
  const fixed = { headline: "guide has 0 paid orders.", actions: [{ ad: "guide", change: "pause", reason: "31 leads.", evidence: ["row:guide"] }] };
  const out = await runAgent({ llm: scripted([bad, fixed]), rec, payments });
  assert.equal(out.grounded, true);
  assert.deepEqual(checkRecommendation(rec, payments, bad), ['Number "500" is not in the tool results.', 'Evidence "CAP9" does not exist.']);
});

test("a second ungrounded submission is returned flagged, never silently accepted", async () => {
  const bad = { headline: "Expect 4x return.", actions: [{ ad: "trial", change: "increase", reason: "x", evidence: ["CAP1"] }] };
  const out = await runAgent({ llm: scripted([bad, bad]), rec, payments });
  assert.equal(out.grounded, false);
  assert.ok(out.problems.length > 0);
});

test("numbers read_captures returns (amount, capture time) are grounded; invented ones still are not", () => {
  const out = { headline: "trial has 1 paid order.", actions: [{ ad: "trial", change: "keep", reason: "Capture CAP1 paid $49.00 on 2026-10-28 at 10:00:00.", evidence: ["CAP1"] }] };
  assert.deepEqual(checkRecommendation(rec, payments, out), []);
  assert.equal(checkRecommendation(rec, payments, { ...out, headline: "trial will earn $49.50." }).length, 1);
});
