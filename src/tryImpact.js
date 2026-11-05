// Pure receipt data for one judge-owned payment. All payment totals and budget decisions come from the live ledger rules.
import { reconcile, supportedMoves, possibleDuplicates, disputeState } from "./ledger.js";
import { commissionOrders } from "./payoutAgent.js";

/**
 * @param {{ before: any[], after: any[], adRows: any[], payment: any, meta: any, payout: any, refund: any }} input
 */
export function tryImpact({ before, after, adRows, payment, meta, payout, refund }) {
  const beforeRec = reconcile(adRows, before), afterRec = reconcile(adRows, after);
  const row = (rec, ad) => {
    const r = rec.ads.find((x) => x.ad === ad);
    return { paid_orders: r?.paid || 0, paid_revenue: (r?.revenue_cents || 0) / 100,
      back_per_ad_dollar: r?.spend_cents ? (r.revenue_cents / r.spend_cents) : null };
  };
  const beforeMoves = supportedMoves(beforeRec), afterMoves = supportedMoves(afterRec);
  const paidOut = payout?.batch_id && payment?.capture_id ? { [payment.capture_id]: payout.batch_id } : {};
  const orders = commissionOrders(after, { ad: "parent_carousel", rate: "5.00" },
    new Set(possibleDuplicates(after).map((x) => x.capture_id)), paidOut, disputeState);
  const order = orders.find((x) => x.capture_id === payment?.capture_id);
  const refunded = Number(payment?.refunded_amount || 0) >= Number(payment?.amount || 0) && Number(payment?.amount || 0) > 0;
  const payoutStatus = payout?.read_back?.item_status || payout?.read_back?.status || payout?.status || null;
  const hasPayout = Boolean(payout?.batch_id);
  const metaSent = Boolean(meta?.ok);
  return {
    payment_id: payment?.capture_id || null,
    ads: {
      parent_carousel: { before: row(beforeRec, "parent_carousel"), after: row(afterRec, "parent_carousel") },
      free_guide: { before: row(beforeRec, "free_guide"), after: row(afterRec, "free_guide") },
    },
    budget: {
      parent_carousel: { before_raise_supported: Boolean(beforeMoves.parent_carousel?.increase), after_raise_supported: Boolean(afterMoves.parent_carousel?.increase) },
      free_guide: { before_raise_blocked: !beforeMoves.free_guide?.increase, after_raise_blocked: !afterMoves.free_guide?.increase },
    },
    meta: { sent: metaSent, event_id: meta?.event_id || null, events_received: meta?.events_received ?? null,
      reason: metaSent ? null : meta?.held ? `Held: ${meta.held}` : meta?.error || "No Meta receipt was recorded.",
      refund_note: refunded && metaSent ? "already sent; Meta has no retraction, so it is subtracted here" : null },
    creator: { earns: Boolean(order?.eligible || hasPayout), amount: "5.00", paid_out: hasPayout, payout_status: payoutStatus,
      batch_id: payout?.batch_id || null, owed_back: refunded && hasPayout },
    refund: { refunded, amount: payment?.refunded_amount || "0.00", status: payment?.status || null,
      refund_id: refund?.id || payment?.refund_id || null },
  };
}
