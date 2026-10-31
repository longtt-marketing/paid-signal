// Observed historical conversion mismatch, on real ads: do the ads that bring sign-ups cheaply also bring real customers
// cheaply? Data: "Facebook ad campaign" by madislemsalu on Kaggle (https://www.kaggle.com/datasets/madislemsalu/facebook-ad-campaign),
// ODC Public Domain Dedication and Licence, "Courtesy of Bunq": 1,143 Facebook ad rows from 17 to 30 Aug 2017 with spend,
// total_conversion (sign-ups or installs) and approved_conversion (those who became active users). No order values, no
// refunds, no payment ids: this tests the ranking signal Paid Signal replaces, not Paid Signal, and claims no revenue lift.
// 382 rows have campaign_id and fb_campaign_id missing with the other columns shifted left; their ad ids continue
// campaign 1178's range, so they are read as campaign 1178 and left out of the fb_campaign_id view.
// Usage: node scripts/study-public-ads.mjs > docs/proof/public-ads-study.json
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const raw = readFileSync(new URL("../docs/data/facebook-ad-campaign-bunq.csv", import.meta.url));
const rows = raw.toString("utf8").trim().split(/\r?\n/).slice(1).map((l) => {
  const c = l.split(",");
  const shifted = c[3].includes("-");
  const [ad, start, , camp, fbc, age, gender, i1, , , imp, clicks, spent, tc, ac] = shifted ? [c[0], c[1], c[2], "1178", null, ...c.slice(3, 13)] : c;
  return { ad, day: Number(start.slice(0, 2)), camp, fbc, age, gender, interest: i1, spend: Number(spent), leads: Number(tc), customers: Number(ac), shifted };
});

/** Sum rows into units by a key. */
const groupBy = (rs, key) => {
  const m = new Map();
  for (const r of rs) { const k = key(r); if (k == null) continue; const u = m.get(k) || { unit: k, spend: 0, leads: 0, customers: 0, days: {} }; u.spend += r.spend; u.leads += r.leads; u.customers += r.customers; m.set(k, u); }
  return [...m.values()];
};
// deterministic bootstrap
let seed = 20171030; const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r3 = (x) => Math.round(x * 1000) / 1000;

/** Share of ad pairs that cost per sign-up and cost per customer put in opposite order (ties left out). */
function discordance(us) {
  let d = 0, n = 0;
  for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
    const a = us[i], b = us[j];
    const l = a.spend / a.leads - b.spend / b.leads, c = a.spend / a.customers - b.spend / b.customers;
    if (l === 0 || c === 0) continue; n++; if (Math.sign(l) !== Math.sign(c)) d++;
  }
  return n ? d / n : null;
}
/** Of the cheapest quarter of ads by cost per sign-up, the share that is not in the cheapest quarter by cost per customer. */
function topQuarterMiss(us) {
  const k = Math.max(1, Math.round(us.length / 4));
  const byLead = [...us].sort((a, b) => a.spend / a.leads - b.spend / b.leads).slice(0, k);
  const byCust = new Set([...us].sort((a, b) => a.spend / a.customers - b.spend / b.customers).slice(0, k).map((u) => u.unit));
  return byLead.filter((u) => !byCust.has(u.unit)).length / k;
}
function study(units, label) {
  const priced = units.filter((u) => u.spend > 0 && u.leads > 0);
  const noCustomer = priced.filter((u) => u.customers === 0);
  // chance alone: if every sign-up became a customer at the account's own rate, an ad with n sign-ups has none with
  // probability (1 - rate)^n; the spend that would land on such ads by chance is the bar the observed share must clear
  const rate = priced.reduce((n, u) => n + u.customers, 0) / priced.reduce((n, u) => n + u.leads, 0);
  const pricedSpend = priced.reduce((n, u) => n + u.spend, 0);
  const expected = priced.reduce((n, u) => n + u.spend * (1 - rate) ** u.leads, 0) / pricedSpend;
  const out = { unit: label, units: units.length, with_spend_and_signups: priced.length,
    signups_but_no_customer: { units: noCustomer.length, spend_usd: Math.round(noCustomer.reduce((n, u) => n + u.spend, 0)), share_of_spend: r3(noCustomer.reduce((n, u) => n + u.spend, 0) / pricedSpend), share_expected_by_chance_at_one_rate: r3(expected), account_signup_to_customer: r3(rate) },
    by_minimum_customers: {} };
  for (const k of [1, 3, 5]) {
    const us = priced.filter((u) => u.customers >= k);
    if (us.length < 8) { out.by_minimum_customers[k] = { units: us.length, note: "too few units" }; continue; }
    const boot = { d: [], t: [] };
    for (let b = 0; b < 500; b++) { const s = us.map(() => us[Math.floor(rand() * us.length)]); boot.d.push(discordance(s)); boot.t.push(topQuarterMiss(s)); }
    out.by_minimum_customers[k] = { units: us.length,
      pairs_ordered_opposite: r3(discordance(us)), ci90: [r3(pct(boot.d, 0.05)), r3(pct(boot.d, 0.95))],
      cheapest_quarter_by_signup_not_cheapest_by_customer: r3(topQuarterMiss(us)), ci90_quarter: [r3(pct(boot.t, 0.05)), r3(pct(boot.t, 0.95))] };
  }
  return out;
}

/** Out-of-sample check: rank on 17-23 Aug, then see which ranking ordered 24-30 Aug's cost per customer better. */
function holdout(key) {
  const tr = new Map(groupBy(rows.filter((r) => r.day <= 23), key).map((u) => [u.unit, u]));
  const te = new Map(groupBy(rows.filter((r) => r.day > 23), key).map((u) => [u.unit, u]));
  const us = [...tr.keys()].filter((k) => tr.get(k).spend > 0 && te.has(k) && te.get(k).spend > 0).map((k) => ({ k, tr: tr.get(k), te: te.get(k) }));
  const agree = (score, set) => { let n = 0, d = 0; for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
    const a = set[i], b = set[j], ta = a.te.customers / a.te.spend, tb = b.te.customers / b.te.spend, sa = score(a.tr), sb = score(b.tr);
    if (ta === tb || sa === sb) continue; const w = Math.min(a.te.spend, b.te.spend); d += w; n += w * ((sa > sb) === (ta > tb)); } return d ? n / d : null; };
  const signups = (u) => u.leads / u.spend, customers = (u) => u.customers / u.spend;
  const diffs = [];
  for (let b = 0; b < 400; b++) { const s = us.map(() => us[Math.floor(rand() * us.length)]); diffs.push(agree(customers, s) - agree(signups, s)); }
  return { units: us.length, spend_weighted_pairs_right_next_week: { by_signups_per_dollar: r3(agree(signups, us)), by_customers_per_dollar: r3(agree(customers, us)) },
    customers_minus_signups_ci90: [r3(pct(diffs, 0.05)), r3(pct(diffs, 0.95))] };
}

const tot = (k) => Math.round(rows.reduce((n, r) => n + r[k], 0) * 100) / 100;
console.log(JSON.stringify({
  date: new Date().toISOString().slice(0, 10),
  kind: "observed historical conversion mismatch on a public dataset (no PayPal data, no revenue, no lift claimed)",
  source: { name: "Facebook ad campaign (madislemsalu, Kaggle), courtesy of Bunq", url: "https://www.kaggle.com/datasets/madislemsalu/facebook-ad-campaign", licence: "ODC Public Domain Dedication and Licence (PDDL)", file: "docs/data/facebook-ad-campaign-bunq.csv", sha256: createHash("sha256").update(raw).digest("hex") },
  definitions: { spend: "spent (Facebook spend)", signups: "total_conversion: sign-ups or installs", customers: "approved_conversion: those who became active users" },
  rows: rows.length, rows_shifted_read_as_campaign_1178: rows.filter((r) => r.shifted).length, zero_spend_rows: rows.filter((r) => r.spend === 0).length,
  totals: { spend: tot("spend"), signups: tot("leads"), customers: tot("customers") },
  per_ad: study(groupBy(rows, (r) => r.ad), "ad_id"),
  per_ad_set: study(groupBy(rows, (r) => r.fbc), "fb_campaign_id (rows that carry it)"),
  per_audience: study(groupBy(rows, (r) => `${r.camp}|${r.age}|${r.gender}|${r.interest}`), "campaign × age × gender × interest"),
  next_week_check: { split: "rank on 17-23 Aug 2017, score on 24-30 Aug 2017", per_audience: holdout((r) => `${r.camp}|${r.age}|${r.gender}|${r.interest}`), per_interest: holdout((r) => `${r.camp}|${r.interest}`) },
}, null, 1));
