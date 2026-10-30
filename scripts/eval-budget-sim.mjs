// Does moving budget by PayPal-confirmed paid orders make more money than moving it by leads, which is what ad platforms
// optimise for? A simulation, not a measurement. Each ad's cost per lead comes from the ad export; its true lead-to-paid
// rate is unknown, so every run draws one from what the export and PayPal show (a Beta posterior on paid / leads, flat
// prior). The policies never see that draw: they learn week by week from noisy results, exactly as a shop would. With one
// or two orders per ad the posterior is wide, which is the honest uncertainty; the output reports a range, not one number.
// Three policies share the same weeks: keep the current split, follow leads per dollar, follow paid orders per dollar with
// the dashboard's own rule (an ad moves only once it has 3 paid orders; every ad keeps at least 10%).
// "Revenue minus ad spend" ignores product cost, so it is not profit.
// Usage: node scripts/eval-budget-sim.mjs [ads.csv] > docs/proof/budget-sim.json
//   ads.csv columns: ad,spend,leads,paid_orders,revenue (the demo uses the live ledger instead)
import { readFileSync } from "node:fs";
import { parseAdCsv, reconcile, proposeSplit } from "../src/ledger.js";

const WEEKS = 8, RUNS = 2000, FLOOR = 0.1;
let seed = 20261030; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) || 1e-9;
const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
const poisson = (l) => { if (l <= 0) return 0; if (l > 60) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss())); let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= rnd(); } while (p > L); return k - 1; };
const binom = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (rnd() < p) k++; return k; };
const gammaInt = (k) => { let s = 0; for (let i = 0; i < k; i++) s -= Math.log(rnd()); return s; }; // integer shape only
const beta = (a, b) => { const x = gammaInt(a); return x / (x + gammaInt(b)); };

let ads, source, observed;
if (process.argv[2]) {
  const [head, ...rows] = readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/);
  const keys = head.split(",");
  ads = rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v]))).map((r) => ({ ad: r.ad, spend: Number(r.spend), leads: Number(r.leads || r.leads_or_messages), paid: Number(r.paid_orders), revenue: Number(r.revenue) }));
  source = process.argv[2];
} else {
  const payments = (await (await fetch("https://paid-signal.thelongmarketing.workers.dev/api/ledger")).json()).payments.map((p) => ({ ...p, payer_email_sha256: p.payer_key })); // the public ledger carries a salted payer key, not the email hash
  const rec = reconcile(parseAdCsv(readFileSync(new URL("../public/data/demo-ads.csv", import.meta.url), "utf8")).rows, payments);
  ads = rec.ads.map((a) => ({ ad: a.ad, spend: a.spend_cents / 100, leads: a.leads, paid: a.paid, revenue: a.revenue_cents / 100 }));
  source = "demo ad export + live PayPal sandbox ledger";
}
const budget = ads.reduce((n, a) => n + a.spend, 0);
const totalPaid = ads.reduce((n, a) => n + a.paid, 0);
const totalRevenue = ads.reduce((n, a) => n + a.revenue, 0);
const orderValue = totalRevenue / Math.max(1, totalPaid);
observed = { spend: +budget.toFixed(2), paid_orders: totalPaid, revenue: +totalRevenue.toFixed(2), revenue_minus_ad_spend: +(totalRevenue - budget).toFixed(2) };
const cpl = ads.map((a) => a.spend / Math.max(1, a.leads));

function run(policy, rates) {
  let split = ads.map((a) => a.spend / budget);
  const seen = ads.map(() => ({ spend: 0, leads: 0, paid: 0 }));
  let paid = 0, spend = 0;
  for (let w = 0; w < WEEKS; w++) {
    ads.forEach((_, i) => {
      const s = budget * split[i], leads = poisson(s / cpl[i]), p = binom(leads, rates[i]);
      seen[i].spend += s; seen[i].leads += leads; seen[i].paid += p; paid += p; spend += s;
    });
    if (policy === "paid") split = proposeSplit(seen.map((x, i) => ({ ad: ads[i].ad, spend: x.spend, paid: x.paid, share: split[i] })), 1, FLOOR).map((x) => x.share); // the dashboard's own rule
    else if (policy === "leads") { const score = seen.map((x) => (x.leads + 1) / (x.spend + 10)), sum = score.reduce((a, b) => a + b, 0); split = score.map((x) => FLOOR + (1 - FLOOR * score.length) * (x / sum)); }
  }
  return { paid, net: paid * orderValue - spend };
}

const res = { keep: [], leads: [], paid: [] };
for (let r = 0; r < RUNS; r++) {
  const rates = ads.map((a) => beta(a.paid + 1, Math.max(0, a.leads - a.paid) + 1)); // this run's unknown truth
  for (const k of Object.keys(res)) { const s0 = seed; res[k].push(run(k, rates)); seed = s0; }
  rnd(); // move on so the next run draws fresh weeks
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const sum = (xs) => ({
  paid_orders: +(xs.reduce((n, x) => n + x.paid, 0) / xs.length).toFixed(1),
  revenue_minus_ad_spend: { mean: Math.round(xs.reduce((n, x) => n + x.net, 0) / xs.length), p10: Math.round(q(xs.map((x) => x.net), 0.1)), p90: Math.round(q(xs.map((x) => x.net), 0.9)) },
});
const diff = res.paid.map((b, i) => b.net - res.leads[i].net);
const out = {
  date: new Date().toISOString().slice(0, 10), kind: "simulation", source, weeks: WEEKS, runs: RUNS, weekly_budget: +budget.toFixed(2), order_value: +orderValue.toFixed(2),
  evidence: `${totalPaid} paid orders across ${ads.length} ads; each run draws every ad's true paid rate from Beta(paid+1, leads-paid+1), so the range is wide on purpose`,
  observed_week: observed,
  observed: ads.map((a, i) => ({ ad: a.ad, cost_per_lead: +cpl[i].toFixed(2), leads: a.leads, paid: a.paid })),
  keep_split: sum(res.keep), by_leads: sum(res.leads), by_paid_orders: sum(res.paid),
  paid_minus_leads: { mean: Math.round(diff.reduce((a, b) => a + b, 0) / RUNS), p10: Math.round(q(diff, 0.1)), p90: Math.round(q(diff, 0.9)) },
  paid_orders_beat_leads_in: `${diff.filter((d) => d > 0).length} of ${RUNS}`,
  paid_orders_beat_keeping_in: `${res.paid.filter((b, i) => b.net > res.keep[i].net).length} of ${RUNS}`,
};
console.log(JSON.stringify(out, null, 1));
