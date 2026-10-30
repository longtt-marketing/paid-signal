// Does moving budget by PayPal-confirmed paid orders make more money than moving it by leads, which is what ad platforms
// optimise for? A simulation, not a measurement: each ad's cost per lead and lead-to-paid rate come from an ad export and
// its PayPal results (the demo export by default; a real shop's when given), and 8 weeks are replayed 2,000 times.
// Both policies start from the same split, keep at least 10% of the budget on every ad, and see the same noisy weeks.
// Usage: node scripts/eval-budget-sim.mjs [ads.csv] > docs/proof/budget-sim.json
//   ads.csv columns: ad,spend,leads,paid_orders,revenue (the demo uses the live ledger instead)
import { readFileSync } from "node:fs";
import { parseAdCsv, reconcile, proposeSplit } from "../src/ledger.js";

const WEEKS = 8, RUNS = 2000, FLOOR = 0.1;
let seed = 20261030; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const poisson = (l) => { if (l <= 0) return 0; if (l > 60) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss())); let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= rnd(); } while (p > L); return k - 1; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const binom = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (rnd() < p) k++; return k; };

let ads, source;
if (process.argv[2]) {
  const [head, ...rows] = readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/);
  const keys = head.split(",");
  ads = rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v]))).map((r) => ({ ad: r.ad, spend: Number(r.spend), leads: Number(r.leads || r.leads_or_messages), paid: Number(r.paid_orders), revenue: Number(r.revenue) }));
  source = process.argv[2];
} else {
  const { payments } = await (await fetch("https://paid-signal.thelongmarketing.workers.dev/api/ledger")).json();
  const rec = reconcile(parseAdCsv(readFileSync(new URL("../public/data/demo-ads.csv", import.meta.url), "utf8")).rows, payments);
  ads = rec.ads.map((a) => ({ ad: a.ad, spend: a.spend_cents / 100, leads: a.leads, paid: a.paid, revenue: a.revenue_cents / 100 }));
  source = "demo ad export + live PayPal sandbox ledger";
}
const budget = ads.reduce((n, a) => n + a.spend, 0);
const totalPaid = ads.reduce((n, a) => n + a.paid, 0);
const orderValue = ads.reduce((n, a) => n + a.revenue, 0) / Math.max(1, totalPaid);
// truth for the simulation: each ad's cost per lead and its lead-to-paid rate (a half order of prior so a zero is not certain)
const truth = ads.map((a) => ({ ad: a.ad, cpl: a.spend / Math.max(1, a.leads), rate: (a.paid + 0.5) / (a.leads + 1) }));

function run(policy) {
  let split = ads.map((a) => a.spend / budget);
  const seen = truth.map(() => ({ spend: 0, leads: 0, paid: 0 }));
  let paid = 0, spend = 0;
  for (let w = 0; w < WEEKS; w++) {
    truth.forEach((t, i) => {
      const s = budget * split[i], leads = poisson(s / t.cpl), p = binom(leads, t.rate);
      seen[i].spend += s; seen[i].leads += leads; seen[i].paid += p; paid += p; spend += s;
    });
    // next week's split: by leads per dollar (what the ad platform sees) or by paid orders per dollar (what PayPal confirms)
    if (policy === "paid") split = proposeSplit(seen.map((x, i) => ({ ad: truth[i].ad, spend: x.spend, paid: x.paid })), 1, FLOOR).map((x) => x.share); // the dashboard's own rule
    else { const score = seen.map((x) => (x.leads + 1) / (x.spend + 10)), sum = score.reduce((a, b) => a + b, 0); split = score.map((x) => FLOOR + (1 - FLOOR * score.length) * (x / sum)); }
  }
  return { paid, revenue: paid * orderValue, profit: paid * orderValue - spend };
}

const A = [], B = [];
for (let r = 0; r < RUNS; r++) { const s0 = seed; A.push(run("leads")); seed = s0; B.push(run("paid")); }
const mean = (xs, k) => xs.reduce((n, x) => n + x[k], 0) / xs.length;
const wins = B.filter((b, i) => b.paid > A[i].paid).length, ties = B.filter((b, i) => b.paid === A[i].paid).length;
const out = {
  date: new Date().toISOString().slice(0, 10), kind: "simulation", source, weeks: WEEKS, runs: RUNS, weekly_budget: Number(budget.toFixed(2)), order_value: Number(orderValue.toFixed(2)),
  truth: truth.map((t) => ({ ad: t.ad, cost_per_lead: Number(t.cpl.toFixed(2)), lead_to_paid: Number(t.rate.toFixed(3)) })),
  by_leads: { paid_orders: Number(mean(A, "paid").toFixed(1)), revenue: Number(mean(A, "revenue").toFixed(0)), profit: Number(mean(A, "profit").toFixed(0)) },
  by_paid_orders: { paid_orders: Number(mean(B, "paid").toFixed(1)), revenue: Number(mean(B, "revenue").toFixed(0)), profit: Number(mean(B, "profit").toFixed(0)) },
  extra_revenue_over_8_weeks: Number((mean(B, "revenue") - mean(A, "revenue")).toFixed(0)),
  paid_orders_more_in_runs: `${wins} of ${RUNS}`, ties,
};
console.log(JSON.stringify(out, null, 1));
