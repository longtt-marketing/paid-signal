// Runs the author's real Meta-to-Shopee test (docs/proof/real-ads-case.json) through Paid Signal's own budget rule, next
// to the ranking an ad platform optimising for clicks would use. Not PayPal: completed affiliate orders stand in for
// paid orders, matched to each ad one-to-one by its link's Sub_id, as a PayPal capture is by its custom_id.
// Usage: node scripts/eval-real-case.mjs > docs/proof/real-case-run.json
import { readFileSync } from "node:fs";
import { proposeSplit, paybackOdds } from "../src/ledger.js";

const c = JSON.parse(readFileSync(new URL("../docs/proof/real-ads-case.json", import.meta.url), "utf8"));
const named = [...c.ads_with_orders, ...c.other_ads.named.filter((n) => !c.ads_with_orders.some((a) => a.ad === n.ad))];
const rest = { ad: `${c.other_ads.ads - c.other_ads.named.length} other ads with no order, taken together`,
  spend: c.other_ads.spend - c.other_ads.named.reduce((n, a) => n + a.spend, 0),
  outbound_clicks: c.other_ads.outbound_clicks - c.other_ads.named.reduce((n, a) => n + a.outbound_clicks, 0), completed: 0, commission_expected: 0 };
const rows = [...named, rest].map((a) => ({ ad: a.ad, spend: a.spend, clicks: a.outbound_clicks, paid: a.completed || 0, commission: a.commission_expected || 0 }));

// the ad platform's view: clicks per dong, best first
const byClicks = [...rows].sort((a, b) => b.clicks / b.spend - a.clicks / a.spend).map((r, i) => ({ ...r, rank_by_clicks_per_spend: i + 1 }));
// Paid Signal's rule, unchanged from the demo: no budget moves on fewer than 3 paid orders
const split = proposeSplit(rows, c.totals.spend);
const withOrders = byClicks.filter((r) => r.paid > 0);
// the dashboard's small-sample read (paybackOdds): commission on completed orders stands in for paid revenue
const asRec = { ads: rows.map((r) => ({ ad: r.ad, spend_cents: r.spend * 100, paid: r.paid })),
  totals: { paid: rows.reduce((n, r) => n + r.paid, 0), spend_cents: c.totals.spend * 100, revenue_cents: c.totals.commission_on_completed_orders * 100 } }; // completed orders only, as paid orders are
const odds = paybackOdds(asRec);

console.log(JSON.stringify({
  date: new Date().toISOString().slice(0, 10),
  what: "The author's real Meta test (2 to 8 Oct 2026, 33 ads) through Paid Signal's budget rule (src/ledger.js proposeSplit). Completed affiliate orders stand in for PayPal-confirmed paid orders.",
  rows_compared: byClicks.length,
  ads_with_completed_orders: withOrders.map((r) => ({ ad: r.ad, completed: r.paid, rank_by_clicks_per_spend: r.rank_by_clicks_per_spend })),
  completed_orders_from_bottom_half_by_clicks: withOrders.filter((r) => r.rank_by_clicks_per_spend > byClicks.length / 2).reduce((n, r) => n + r.paid, 0),
  completed_orders_total: rows.reduce((n, r) => n + r.paid, 0),
  click_rule: { increase: byClicks[0].ad, increase_completed: byClicks[0].paid, reduce: byClicks.at(-1).ad, reduce_completed: byClicks.at(-1).paid },
  small_sample_read: { average_commission_per_completed_order_vnd: Math.round(odds.average_paid_order_cents / 100),
    rows_likely_below_ad_spend: Object.values(odds.ads).filter((o) => o.verdict === "likely below its ad spend").length,
    highest_chance_covers_spend: Math.max(...Object.values(odds.ads).map((o) => o.chance_covers_spend)).toExponential(1) },
  paid_signal_rule: { moved: split.filter((s) => !s.reason.startsWith("kept")).length, reasons: [...new Set(split.map((s) => s.reason))] },
  ranking: byClicks.map((r) => ({ rank: r.rank_by_clicks_per_spend, ad: r.ad, spend_vnd: r.spend, clicks: r.clicks, completed: r.paid })),
}, null, 1));
