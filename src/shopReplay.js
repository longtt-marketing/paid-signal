// The gift shop's real October book (docs/proof/merchant-case-*.csv) run through Paid Signal's own ledger code: the same
// reconcile() and possibleDuplicates() the live demo uses. It answers two questions a judge asks of the shop case:
// does the code reproduce the shop's hand-made reconciliation, and what would it have caught as the money arrived?
import { reconcile, possibleDuplicates, BANK_TRANSFER_WINDOW_MS } from "./ledger.js";

/** "2026-10-01 14:38" in the shop's time zone (Vietnam, UTC+7) as ISO. */
export const shopTime = (/** @type {string} */ s) => {
  const value = String(s).trim().replace(" ", "T");
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return value;
  return `${value.length === 16 ? `${value}:00` : value}+07:00`;
};


// the column names a book may use for each field, in the shop's Vietnamese headers or plain English
/** @type {Record<string, string[]>} */
const COLUMNS = {
  order: ["order_id", "order code", "M\u00e3 \u0111\u01a1n n\u1ed9i b\u1ed9", "S\u1ed1 \u0111\u1ed1i chi\u1ebfu"],
  customer: ["customer_id", "M\u00e3 kh\u00e1ch \u1ea9n danh"],
  ad: ["ad_group", "group", "Nh\u00f3m Ads"],
  invoice: ["invoice value", "amount", "Gi\u00e1 tr\u1ecb h\u00f3a \u0111\u01a1n"],
  status: ["status", "Tr\u1ea1ng th\u00e1i"],
  payment: ["payment_id", "M\u00e3 giao d\u1ecbch n\u1ed9i b\u1ed9"],
  type: ["type", "Lo\u1ea1i giao d\u1ecbch"],
  time: ["paid_at", "time", "Ng\u00e0y thu"],
  amount: ["amount", "S\u1ed1 ti\u1ec1n thu"],
  refundPayment: ["refunded_payment_id", "S\u1ed1 \u0111\u1ed1i chi\u1ebfu"],
  refundAmount: ["refund_amount", "S\u1ed1 ti\u1ec1n ho\u00e0n"],
};
const field = (/** @type {Record<string, string>} */ row, /** @type {string} */ key) => { for (const name of COLUMNS[key]) if (Object.hasOwn(row, name)) return row[name]; return ""; };
/**
 * Which required columns a dropped book lacks, by file, named as the English header to add.
 * @param {Record<string, string>[]} orders @param {Record<string, string>[]} payments @param {Record<string, string>[]} refunds
 */
export function validateShopHeaders(orders, payments, refunds) {
  /** @type {string[]} */
  const missing = [];
  const check = (/** @type {Record<string, string>[]} */ rows, /** @type {string} */ file, /** @type {string[]} */ keys) => { const headers = new Set(rows.flatMap((r) => Object.keys(r))); for (const key of keys) if (!COLUMNS[key].some((name) => headers.has(name))) missing.push(`${file}: ${COLUMNS[key][0]}`); };
  check(orders, "order book", ["order", "customer", "ad", "invoice", "status"]);
  check(payments, "payments", ["payment", "order", "ad", "type", "time", "amount"]);
  check(refunds, "refunds", ["refundPayment", "refundAmount"]);
  return missing;
}

/**
 * The book's rows (objects keyed by the CSV headers) as ledger payments. The anonymised customer id stands where the
 * live demo keeps the payer's email hash; every payment in this book was a bank transfer (VietQR).
 * Refunds come from the refund book (each refund names the payment it returns), not from the payment rows' own column.
 * @param {Record<string, string>[]} orders @param {Record<string, string>[]} payments @param {Record<string, string>[]} refunds
 */
export function shopPayments(orders, payments, refunds) {
  const customer = Object.fromEntries(orders.map((o) => [field(o, "order"), field(o, "customer")]));
  const back = /** @type {Record<string, number>} */ ({});
  for (const r of refunds) { const id = field(r, "refundPayment"); back[id] = (back[id] || 0) + Number(field(r, "refundAmount")); }
  return payments.map((p) => {
    const id = field(p, "payment"), orderId = field(p, "order"), backAmount = back[id] || 0;
    return { capture_id: id, order_id: orderId, ad: field(p, "ad"), amount: String(field(p, "amount")), currency: "VND",
      captured_at: shopTime(field(p, "time")), refunded_amount: String(backAmount), payer_email_sha256: customer[orderId] || null,
      method: "bank_transfer", duplicate_in_book: /duplicate|repeat|tr\u00f9ng/i.test(field(p, "type")),
      refund_count: refunds.filter((r) => field(r, "refundPayment") === id).length, refund_total: backAmount };
  });
}

/**
 * @param {{ orders: Record<string, string>[], payments: Record<string, string>[], refunds: Record<string, string>[], includeDetails?: boolean,
 *   groups?: { id: string, spend: number, conversations: number, first_paid: number, full_refunds: number, gross: number, refunded: number }[] | null }} book
 * Without groups (no ad report) the money results are per ad group with no spend; includeDetails adds what /audit shows.
 */
export function replayShop({ orders, payments, refunds, groups = null, includeDetails = false }) {
  const known = new Set(orders.map((o) => field(o, "order")));
  const all = shopPayments(orders, payments, refunds);
  // a payment for an order the book does not have, or a refund for a payment it does not have, needs a person: shown, not counted
  const ledger = all.filter((p) => known.has(p.order_id));
  const unmatchedPayments = all.filter((p) => !known.has(p.order_id));
  const paymentIds = new Set(all.map((p) => p.capture_id));
  const unmatchedRefunds = refunds.filter((r) => !paymentIds.has(field(r, "refundPayment")));
  const hasAds = Array.isArray(groups);
  if (!groups) {
    const ids = [...new Set([...orders.map((o) => field(o, "ad")), ...payments.map((p) => field(p, "ad"))].filter(Boolean))];
    groups = ids.map((id) => ({ id, spend: 0, conversations: 0, first_paid: 0, full_refunds: 0, gross: 0, refunded: 0 }));
  }
  const adRows = groups.map((g) => ({ ad: g.id, spend_cents: g.spend * 100, leads: g.conversations }));
  const final = reconcile(adRows, ledger);
  const byGroup = Object.fromEntries(final.ads.map((a) => [a.ad, a]));
  const heldFlags = possibleDuplicates(ledger.map((p) => ({ ...p, refunded_amount: "0" })));
  const knownOrders = new Set(orders.map((o) => field(o, "order")));
  const unmatchedOrderCaptures = unmatchedPayments.map((p) => p.capture_id);
  const rows = groups.map((g) => {
    const a = byGroup[g.id], groupPayments = ledger.filter((p) => p.ad === g.id);
    const flags = heldFlags.filter((f) => groupPayments.some((p) => p.capture_id === f.capture_id));
    return { id: g.id, payments: a.captures.length, paid: a.paid, refunded_captures: a.refunded, revenue: a.revenue_cents / 100,
      ...(includeDetails ? {
        refunds: groupPayments.reduce((n, p) => n + (p.refund_total || 0), 0), refund_count: groupPayments.reduce((n, p) => n + (p.refund_count || 0), 0),
        held: flags.length, held_same_order: flags.filter((f) => { const current = groupPayments.find((p) => p.capture_id === f.capture_id), first = groupPayments.find((p) => p.capture_id === f.first); return Boolean(current?.order_id) && current.order_id === first?.order_id && current.amount === first?.amount; }).length,
        held_payer_window: flags.filter((f) => groupPayments.find((p) => p.capture_id === f.capture_id)?.order_id !== groupPayments.find((p) => p.capture_id === f.first)?.order_id).length,
        unmatched_orders: unmatchedPayments.filter((p) => p.ad === g.id).length,
        spend: g.spend, chats: g.conversations, cost_per_chat: g.conversations ? g.spend / g.conversations : null,
        kept_per_ad_dollar: g.spend ? a.revenue_cents / 100 / g.spend : null,
      } : {}),
      book_paid: includeDetails ? null : g.first_paid - g.full_refunds, book_revenue: includeDetails ? null : g.gross - g.refunded,
      matches: includeDetails ? null : a.paid === g.first_paid - g.full_refunds && a.revenue_cents / 100 === g.gross - g.refunded };
  });
  // as the money arrived: no refund made yet, so a double transfer is still live and the ledger must hold it
  const arriving = ledger.map((p) => ({ ...p, refunded_amount: "0" }));
  const inBook = new Set(ledger.filter((p) => p.duplicate_in_book).map((p) => p.capture_id));
  const score = (/** @type {{ capture_id: string, seconds: number }[]} */ flags) => {
    const ids = new Set(flags.map((f) => f.capture_id));
    return { flagged: ids.size, caught: [...inBook].filter((x) => ids.has(x)).length,
      false_alarms: [...ids].filter((x) => !inBook.has(x)).length, missed: [...inBook].filter((x) => !ids.has(x)).length };
  };
  const bankFlags = possibleDuplicates(arriving);
  // the time rule alone (no order id), so the window's own effect is visible
  const noOrder = arriving.map((p) => ({ ...p, order_id: undefined }));
  const minutes = bankFlags.filter((f) => inBook.has(f.capture_id)).map((f) => Math.round(f.seconds / 60)).sort((x, y) => x - y);
  return {
    totals: { payments: ledger.length, paid: final.totals.paid, refunded_captures: final.totals.refunded, revenue: final.totals.revenue_cents / 100,
      first_payments: ledger.filter((p) => !p.duplicate_in_book).length, refunds: refunds.length,
      unmatched_payments: unmatchedPayments.length, unmatched_payment_amount: unmatchedPayments.reduce((n, p) => n + Number(p.amount), 0), unmatched_refunds: unmatchedRefunds.length, ...(includeDetails ? { unmatched: final.unmatched_captures.length } : {}), repeat_customers: orders.length - new Set(orders.map((o) => o["Mã khách ẩn danh"])).size },
    groups: rows,
    matches_book: includeDetails ? null : hasAds ? rows.every((r) => r.matches) : null,
    ...(includeDetails ? { rankings: hasAds ? { cost_per_chat: [...rows].sort((a,b) => a.cost_per_chat - b.cost_per_chat).map((x) => x.id), kept_per_ad_dollar: [...rows].sort((a,b) => b.kept_per_ad_dollar - a.kept_per_ad_dollar).map((x) => x.id) } : null, unmatched_captures: final.unmatched_captures, unmatched_order_captures: unmatchedOrderCaptures } : {}),
    duplicates: {
      in_book: inBook.size,
      // the window the live PayPal demo uses (a double click at checkout lands within seconds)
      same_order: score(possibleDuplicates(arriving)),
      card_window: score(possibleDuplicates(noOrder.map((p) => ({ ...p, method: "paypal" })))),
      // bank transfers: a customer who thinks the first transfer failed sends again many minutes later
      bank_window: score(possibleDuplicates(noOrder)),
      bank_window_minutes: BANK_TRANSFER_WINDOW_MS / 60000,
      gap_minutes: minutes,
    },
  };
}

const vnd = (/** @type {number} */ n) => `${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M VND`;

/**
 * The judge page's replay block, written into public/judge.html by scripts/eval-shop-replay.mjs.
 * @param {ReturnType<typeof replayShop>} r
 */
export function replayHTML(r) {
  const d = r.duplicates;
  const groups = r.groups.map((g) => `${g.id}: ${g.paid} orders, ${vnd(g.revenue)}`).join(" · ");
  return `<div class="card">`
    + `<div class="row first"><span class="l">Rerun in our ledger</span><span class="v">${r.totals.paid} kept orders, ${vnd(r.totals.revenue)}: ${r.matches_book ? "the same as" : "not the same as"} the shop's workbook</span><span class="chip ${r.matches_book ? "ok" : "no2"}">${r.matches_book ? "Match" : "Differs"}</span></div>`
    + `<div class="row"><span class="l">Double payments</span><span class="v">${d.in_book} found: same amount, same order code, ${d.gap_minutes[0]} to ${d.gap_minutes[d.gap_minutes.length - 1]} min apart</span><span class="chip held">Held</span></div>`
    + `<details class="det"><summary>Method and limits</summary><p>${r.totals.payments} bank transfers and the ${r.totals.refunds} refunds from its refund book, fed to the same ledger code the demo uses. ${groups}. This checks the arithmetic, the refunds and the order matching, not judgement or ad causality. Without order codes the time rule (same payer, same ad, close together) holds ${d.card_window.caught} of ${d.in_book} with the 10-minute checkout window and ${d.bank_window.caught} of ${d.in_book} with the ${d.bank_window_minutes}-minute window bank transfers get, a window set after reading this book. Every customer in this book ordered once, so false alarms cannot be measured on it. Run your own book in the browser: <a href="/audit#shop-title">/audit</a>.</p></details></div>`;
}
