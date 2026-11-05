// A real shop's month (docs/proof/merchant-case-2026-10.json) read two ways: by the ad report's cost per conversation, and
// by money actually paid and kept, then through Paid Signal's own budget rule (proposeSplit), unchanged from the demo.
import { proposeSplit } from "./ledger.js";

/**
 * @param {{ groups: {id:string,name:string,spend:number,conversations:number,first_paid:number,full_refunds:number,gross:number,refunded:number}[], invoices:{issued:number,paid:number,unpaid_at_reconciliation:number,cancelled_unpaid:number}, usd_rate:number }} c
 */
export function readMerchantCase(c) {
  const sum = (/** @type {(g: any) => number} */ f) => c.groups.reduce((n, g) => n + f(g), 0);
  const spend = sum((g) => g.spend), conversations = sum((g) => g.conversations);
  const paid = sum((g) => g.first_paid - g.full_refunds), net = sum((g) => g.gross - g.refunded);
  const groups = c.groups.map((g) => {
    const p = g.first_paid - g.full_refunds, n = g.gross - g.refunded;
    return { id: g.id, name: g.name, spend: g.spend, conversations: g.conversations, paid: p, net: n,
      cost_per_conversation: Math.round(g.spend / g.conversations), cost_per_paid_order: Math.round(g.spend / p),
      paid_per_conversation: p / g.conversations, roas: n / g.spend,
      share_spend: g.spend / spend, share_conversations: g.conversations / conversations, share_paid: p / paid, share_net: n / net };
  });
  const byCostPerConversation = [...groups].sort((a, b) => a.cost_per_conversation - b.cost_per_conversation).map((g) => g.id);
  const byMoney = [...groups].sort((a, b) => b.roas - a.roas).map((g) => g.id);
  // the demo's rule works in dollars; VND converted at the case's fixed rate
  const split = proposeSplit(groups.map((g) => ({ ad: g.id, spend: g.spend / c.usd_rate, paid: g.paid })), spend / c.usd_rate)
    .map((s) => ({ id: s.ad, share_now: groups.find((g) => g.id === s.ad).share_spend, share_proposed: s.share, reason: s.reason }));
  const inv = c.invoices;
  return {
    totals: { spend, conversations, paid, net, roas: net / spend, cost_per_paid_order: Math.round(spend / paid), spend_usd: spend / c.usd_rate, net_usd: net / c.usd_rate },
    invoices_add_up: inv.paid + inv.unpaid_at_reconciliation + inv.cancelled_unpaid === inv.issued && inv.paid === sum((g) => g.first_paid),
    groups, rank_by_cost_per_conversation: byCostPerConversation, rank_by_money_kept: byMoney, paid_signal_split: split,
  };
}

const esc = (/** @type {unknown} */ s) => String(s).replace(/[&<>"]/g, (ch) => /** @type {Record<string,string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/**
 * The judge page's shop section as static HTML, written into public/judge.html by scripts/eval-merchant-case.mjs,
 * so the numbers are in the page itself and need no script to show.
 * @param {ReturnType<typeof readMerchantCase>} r
 * @param {{ payment?: string, attribution?: string }} c
 */
export function gapHTML(r, c) {
  const pct = (/** @type {number} */ x) => `${(x * 100).toFixed(1)}%`;
  const vnd = (/** @type {number} */ n) => `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M VND`;
  const bar = (/** @type {string} */ label, /** @type {number} */ x, cls = "") =>
    `<div class="bar${cls ? " " + cls : ""}"><span>${label}</span><div><i style="width:${(x * 100).toFixed(1)}%"></i></div><b>${pct(x)}</b></div>`;
  const cards = r.groups.map((g) => `<div class="card shop-card"><span class="k">${esc(g.id)} · ${esc(g.name)}</span>`
    + bar("chats", g.share_conversations) + bar("money", g.share_net, "money")
    + `<small>${g.conversations.toLocaleString("en-US")} chats · ${g.paid} kept orders · ${g.roas.toFixed(2)}x ad spend back</small></div>`).join("");
  const split = r.paid_signal_split.map((s) => `${s.id} ${(s.share_now * 100).toFixed(1)}% → ${(s.share_proposed * 100).toFixed(1)}%`).join(", ");
  return `<div class="hd"><span class="no">5</span><h2 id="gap-h">A real shop's October</h2></div>`
    + `<p class="sub" id="gap-sub">A Vietnamese gift shop the author runs ads for. Paid by bank transfer.</p>`
    + `<div class="grid3" id="gap-grid">${cards}</div>`
    + `<details class="card det-card"><summary>How the shop counted, and limits</summary>`
    + `<p id="gap-rank">October 2026: ${vnd(r.totals.spend)} (about $${Math.round(r.totals.spend_usd).toLocaleString("en-US")}) on three ad groups, ${r.totals.conversations.toLocaleString("en-US")} chats, ${r.totals.paid} orders paid and kept after refunds. Ranked by cost per chat, the ad report's view: ${r.rank_by_cost_per_conversation.join(", ")}. Ranked by money kept per ad dollar: ${r.rank_by_money_kept.join(", ")}.</p>`
    + `<p id="gap-src">${esc(c.payment || "")} ${esc(c.attribution || "")} That matching is done by hand today; it is the step Paid Signal does from PayPal's records. The figures are reported by the author from the order book and the ad account; the shop confirms them and published its book (1,214 invoices, 735 payments, 30 refunds, anonymised customer ids, in docs/proof); the ad account's own exports are no longer accessible. "Money" is revenue after refunds, before product, delivery and fees.</p>`
    + `<p>Paid Signal's split rule (the same code as the demo: paid orders kept per dollar of spend) would suggest ${split}. An illustration, not a measured lift; a person decides, and Paid Signal does not change a live Meta budget. The shop's payments did not go through Paid Signal or PayPal: the shop is why it exists, not a result of it. Numbers: <a href="https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/merchant-case-2026-10.json">merchant-case-2026-10.json</a>.</p></details>`;
}

/**
 * The one line at the top of the judge path; the full shop card sits below "Be the customer".
 * @param {ReturnType<typeof readMerchantCase>} r
 */
export function hookHTML(r) {
  const a = r.groups.reduce((x, g) => (g.share_conversations > x.share_conversations ? g : x));
  const pct = (/** @type {number} */ x) => `${(x * 100).toFixed(1)}%`;
  return `The ad with ${pct(a.share_conversations)} of the chats brought ${pct(a.share_net)} of the money.`;
}
