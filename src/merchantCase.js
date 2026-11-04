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
    `<div class="gap-bar${cls ? " " + cls : ""}"><span>${label}</span><div><i style="width:${(x * 100).toFixed(1)}%"></i></div><span>${pct(x)}</span></div>`;
  const cards = r.groups.map((g) => `<div class="gap-card"><span class="k">${esc(g.id)} · ${esc(g.name)}</span>`
    + `<div class="nums"><b>${g.conversations.toLocaleString("en-US")}</b><i>chats →</i><b class="paid">${g.paid}</b><i>paid orders</i></div>`
    + bar("of chats", g.share_conversations) + bar("of money", g.share_net, "money")
    + `<small>${g.cost_per_conversation.toLocaleString("en-US")} VND a chat · ${g.roas.toFixed(2)}x ad spend back in paid money</small></div>`).join("");
  const split = r.paid_signal_split.map((s) => `${s.id} ${(s.share_now * 100).toFixed(1)}% → ${(s.share_proposed * 100).toFixed(1)}%`).join(", ");
  return `<h2 id="gap-h">Why it matters: one real shop's October, as reported by the author</h2>`
    + `<p class="gap-sub" id="gap-sub">A gift shop that sells in chat; the author runs its Meta ads. October 2026: ${vnd(r.totals.spend)} (about $${Math.round(r.totals.spend_usd).toLocaleString("en-US")}) on three ad groups, ${r.totals.conversations.toLocaleString("en-US")} chats, ${r.totals.paid} orders paid and kept after refunds.</p>`
    + `<div class="gap-grid" id="gap-grid">${cards}</div>`
    + `<p class="gap-rank" id="gap-rank">Ranked by cost per chat, the ad report's view: ${r.rank_by_cost_per_conversation.join(", ")}. Ranked by money kept per ad dollar (revenue after refunds ÷ spend): <span class="go">${r.rank_by_money_kept.join(", ")}</span>. The cheapest chats came from the ad that brought the least money.</p>`
    + `<p class="gap-src" id="gap-src"><b>How the shop counted.</b> ${esc(c.payment || "")} ${esc(c.attribution || "")} That matching is done by hand today; it is the step Paid Signal does from PayPal's records. The figures are reported by the author from the order book and the ad account; the shop confirms them and agreed to publish its book (1,214 invoices, 735 payments, 30 refunds, anonymised customer ids, in docs/proof); the ad account's own exports are no longer accessible. "Money" is revenue after refunds, before product, delivery and fees.</p>`
    + `<p class="gap-src"><b>What Paid Signal would suggest.</b> Its split rule (<code>proposeSplit</code>, the same code as the demo: paid orders kept per dollar of spend, refunds excluded, order value not used) gives ${split}. That is an illustration, not a measured lift or an optimal allocation; which moves the budget agent may make is a separate rule (<code>supportedMoves</code>). A person decides, and Paid Signal does not change a live Meta budget. The shop's payments did not go through Paid Signal or PayPal: the shop is why it exists, not a result of it. Numbers: <a href="https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/merchant-case-2026-10.json">merchant-case-2026-10.json</a>.</p>`;
}

/**
 * The one line at the top of the judge path; the full shop card sits below "Be the customer".
 * @param {ReturnType<typeof readMerchantCase>} r
 */
export function hookHTML(r) {
  const a = r.groups.reduce((x, g) => (g.share_conversations > x.share_conversations ? g : x));
  const pct = (/** @type {number} */ x) => `${(x * 100).toFixed(1)}%`;
  return `In one real shop's October (figures reported by the author), the ad with <b>${pct(a.share_conversations)} of the chats</b> brought <b>${pct(a.share_net)} of the money</b>; its own book, run through our ledger, has its 7 double transfers held.`;
}
