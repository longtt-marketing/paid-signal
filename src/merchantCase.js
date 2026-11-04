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
