import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, grade, leadsRule } from "../src/scenarios.js";
import { reconcile, proposeSplit } from "../src/ledger.js";

test("synthetic weeks: every payment is marked synthetic and none looks like a PayPal capture id", () => {
  for (const s of SCENARIOS) for (const p of s.payments) { assert.equal(p.synthetic, true); assert.match(p.capture_id, /^SYN/); }
});

test("synthetic weeks: the paid-orders split finds every right answer; the leads-per-dollar rule finds none", () => {
  for (const s of SCENARIOS) {
    const rec = reconcile(s.ads, s.payments);
    const rows = rec.ads.map((a) => ({ ad: a.ad, spend: a.spend_cents / 100, paid: a.paid }));
    const split = proposeSplit(rows, rows.reduce((n, x) => n + x.spend, 0));
    const acts = split.map((x, i) => ({ ad: x.ad, change: x.budget > rows[i].spend + 0.5 ? "increase" : x.budget < rows[i].spend - 0.5 ? "reduce" : "keep" }));
    assert.equal(grade(s, acts).ok, true, s.id);
    assert.equal(grade(s, leadsRule(s)).ok, false, s.id);
  }
});

test("grading: a budget move on an ad without the evidence is wrong; keeping everything misses a warranted move", () => {
  const s = SCENARIOS.find((x) => x.id === "week4");
  assert.deepEqual(grade(s, [{ ad: "holiday_static", change: "pause" }]).wrong, ["holiday_static: pause"]);
  assert.equal(grade(s, [{ ad: "trial_video", change: "keep" }]).ok, false);
  assert.equal(grade(s, [{ ad: "trial_video", change: "increase" }, { ad: "free_guide", change: "keep" }]).ok, true);
});
