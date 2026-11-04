// The gift shop's real October book (docs/proof/merchant-case-*.csv) run through Paid Signal's own ledger code: the same
// reconcile() and possibleDuplicates() the live demo uses. It answers two questions a judge asks of the shop case:
// does the code reproduce the shop's hand-made reconciliation, and what would it have caught as the money arrived?
import { reconcile, possibleDuplicates, BANK_TRANSFER_WINDOW_MS } from "./ledger.js";

/** "2026-10-01 14:38" in the shop's time zone (Vietnam, UTC+7) as ISO. */
export const shopTime = (/** @type {string} */ s) => `${String(s).trim().replace(" ", "T")}:00+07:00`;

/**
 * The book's rows (objects keyed by the CSV headers) as ledger payments. The anonymised customer id stands where the
 * live demo keeps the payer's email hash; every payment in this book was a bank transfer (VietQR).
 * @param {Record<string, string>[]} orders @param {Record<string, string>[]} payments
 */
export function shopPayments(orders, payments) {
  const customer = Object.fromEntries(orders.map((o) => [o["Mã đơn nội bộ"], o["Mã khách ẩn danh"]]));
  return payments.map((p) => ({
    capture_id: p["Mã giao dịch nội bộ"], order_id: p["Số đối chiếu"], ad: p["Nhóm Ads"],
    amount: String(p["Số tiền thu"]), currency: "VND", captured_at: shopTime(p["Ngày thu"]),
    refunded_amount: String(p["Số tiền hoàn"] || 0), payer_email_sha256: customer[p["Số đối chiếu"]] || null,
    method: "bank_transfer", duplicate_in_book: p["Loại giao dịch"] === "Thu trùng",
  }));
}

/**
 * @param {{ orders: Record<string, string>[], payments: Record<string, string>[],
 *   groups: { id: string, spend: number, conversations: number, first_paid: number, full_refunds: number, gross: number, refunded: number }[] }} book
 */
export function replayShop({ orders, payments, groups }) {
  const ledger = shopPayments(orders, payments);
  const adRows = groups.map((g) => ({ ad: g.id, spend_cents: g.spend * 100, leads: g.conversations }));
  const final = reconcile(adRows, ledger);
  const byGroup = Object.fromEntries(final.ads.map((a) => [a.ad, a]));
  const rows = groups.map((g) => {
    const a = byGroup[g.id];
    return { id: g.id, payments: a.captures.length, paid: a.paid, refunded_captures: a.refunded, revenue: a.revenue_cents / 100,
      book_paid: g.first_paid - g.full_refunds, book_revenue: g.gross - g.refunded,
      matches: a.paid === g.first_paid - g.full_refunds && a.revenue_cents / 100 === g.gross - g.refunded };
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
      first_payments: ledger.filter((p) => !p.duplicate_in_book).length, repeat_customers: orders.length - new Set(orders.map((o) => o["Mã khách ẩn danh"])).size },
    groups: rows,
    matches_book: rows.every((r) => r.matches),
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
  return `<h3 class="replay-h">The shop's book, run through Paid Signal's own ledger code</h3>`
    + `<p class="replay-p">${r.totals.payments} bank transfers (${r.totals.first_payments} first payments and their repeats) and every refund, fed to the same <code>reconcile()</code> the demo uses. It ${r.matches_book ? "gives the same result as" : "does not match"} the shop's reconciliation workbook: ${r.totals.paid} paid orders kept, ${vnd(r.totals.revenue)} (${groups}). That checks the arithmetic, the refunds and the order matching; it is not a test of judgement.</p>`
    + `<p class="replay-p"><b>The double transfers:</b> the book has ${d.in_book}, ${d.gap_minutes[0]} to ${d.gap_minutes[d.gap_minutes.length - 1]} minutes apart (a customer thinks the first transfer failed and sends again). Each is a second transfer for the same order code, so the ledger now holds a bank transfer sent again for one order whatever the gap: ${d.same_order.caught} of ${d.in_book}. The time rule alone (same payer, same ad, close together, for payments with no order id) held ${d.card_window.caught} of ${d.in_book} with the 10-minute checkout window and ${d.bank_window.caught} of ${d.in_book} with the ${d.bank_window_minutes}-minute window bank transfers now get, a window set after reading this book. Every customer in this book ordered once, so false alarms cannot be measured here.</p>`;
}
