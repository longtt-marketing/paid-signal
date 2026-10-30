// Measures the evidence gate on the live ledger: plant one invented number, one fake evidence id or one raw field
// name into otherwise grounded recommendations and count how many the gate catches; also feed it grounded
// recommendations built only from tool numbers and count false rejections. Seeded, so the result is reproducible.
// Usage: node scripts/eval-gate.mjs > docs/proof/gate.json
import { adName } from "../web/src/names.js";
import { readFileSync } from "node:fs";
import { parseAdCsv, reconcile, quotableNumbers } from "../src/ledger.js";
import { checkRecommendation } from "../src/agent.js";

const BASE = "https://paid-signal.thelongmarketing.workers.dev";
const payments = (await (await fetch(`${BASE}/api/ledger`)).json()).payments.map((p) => ({ ...p, payer_email_sha256: p.payer_key })); // the public ledger carries a salted payer key, not the email hash
const rec = reconcile(parseAdCsv(readFileSync(new URL("../public/data/demo-ads.csv", import.meta.url), "utf8")).rows, payments);
const allowed = [...quotableNumbers(rec)];
const ads = rec.ads.map((a) => a.ad);

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const grounded = () => {
  const ad = pick(ads); const a = rec.ads.find((r) => r.ad === ad);
  const n = pick(allowed), money = /\.\d{2}$/.test(n) ? `$${n}` : n;
  // a third of good recommendations also state, truthfully, which capture was refunded
  const back = payments.filter((p) => Number(p.refunded_amount || 0) > 0);
  return { headline: `${adName(ad)} brought ${a.leads} leads and ${a.paid} paid orders on $${(a.spend_cents / 100).toFixed(2)} spend.`,
    actions: [{ ad, change: a.paid >= 3 ? pick(["reduce", "keep", "increase"]) : pick(["keep", "fix_tracking"]), reason: `It has ${money} on record; the sample is small.`, evidence: [`row:${ad}`] }],
    caveats: rnd() < 1 / 3 && back.length ? `Capture ${pick(back).capture_id} was refunded, so it does not count.` : "" };
};
const stamp = [...new Set(payments.flatMap((p) => String(p.captured_at).match(/\d+/g) || []).map((d) => String(Number(d))))].filter((d) => !allowed.includes(d) && !payments.some((p) => [p.amount, p.refunded_amount].includes(d)));
const invented = () => { let v; do v = (rnd() * 500).toFixed(pick([0, 2])); while (allowed.includes(v) || allowed.includes(v.replace(/\.00$/, ""))); return v; };
const plants = {
  invented_number: (r) => ({ ...r, actions: [{ ...r.actions[0], reason: `${r.actions[0].reason} Expect ${invented()} more next month.` }] }),
  invented_number_from_a_timestamp: (r) => ({ ...r, actions: [{ ...r.actions[0], reason: `${r.actions[0].reason} Expect ${pick(stamp)} more paid orders next month.` }] }),
  invented_percent: (r) => ({ ...r, headline: `${r.headline} That is a ${Math.round(rnd() * 90 + 101)}% return.` }),
  fake_evidence_id: (r) => ({ ...r, actions: [{ ...r.actions[0], evidence: [`${Math.floor(rnd() * 9e15).toString(36).toUpperCase().padStart(17, "X")}`] }] }),
  unknown_ad: (r) => ({ ...r, actions: [{ ...r.actions[0], ad: `ad_${Math.floor(rnd() * 1000)}` }] }),
  raw_field_name: (r) => ({ ...r, headline: `${r.headline} paid_revenue_per_dollar is low.` }),
  budget_move_on_thin_evidence: (r) => { const thin = rec.ads.find((x) => x.paid < 3); return { ...r, actions: [{ ...r.actions[0], ad: thin.ad, change: pick(["pause", "reduce", "increase"]), evidence: [`row:${thin.ad}`] }] }; },
  calls_it_profit: (r) => ({ ...r, caveats: "This is the only clear profit in the account." }),
  money_without_dollar_sign: (r) => { const m = allowed.filter((x) => /\.\d{2}$/.test(x)); return { ...r, caveats: `Spend so far is ${pick(m)}.` }; },
  ad_key_instead_of_name: (r) => ({ ...r, actions: [{ ...r.actions[0], reason: `${r.actions[0].reason} Watch ${r.actions[0].ad} closely.` }] }),
  wrong_refund_claim: (r) => { const kept = payments.filter((p) => !(Number(p.refunded_amount || 0) > 0));
    return { ...r, caveats: rnd() < 0.5 ? `Capture ${pick(kept).capture_id} was refunded, so it does not count.` : `In each pair the ${pick(["first", "second"])} was refunded, so the other counts.` }; },
};
const N = 100, out = { date: new Date().toISOString().slice(0, 10), payments: payments.length, planted: {}, grounded: {} };
for (const [name, plant] of Object.entries(plants)) {
  let caught = 0; for (let i = 0; i < N; i++) if (checkRecommendation(rec, payments, plant(grounded())).length) caught++;
  out.planted[name] = { tried: N, caught };
}
let rejected = 0; for (let i = 0; i < 5 * N; i++) if (checkRecommendation(rec, payments, grounded()).length) rejected++;
out.grounded = { tried: 5 * N, falsely_rejected: rejected };
console.log(JSON.stringify(out, null, 1));
