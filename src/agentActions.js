// Every thing an agent wrote to PayPal, from the ledger's own records: invoices the revenue agent drafted, the send agent
// sent and the chase agent reminded; refunds the refund agent made; payouts the commission agent sent. The route reads
// each one back from PayPal, so the Studio page shows what PayPal says about it now, not what the agent said it did.

const short = (s, n = 60) => String(s || "").slice(0, n);

/**
 * @param {{ invoices?: any[], payments?: any[], payouts?: any[] }} records
 * @returns {{ key: string, at: string, agent: string, did: string, kind: string, id: string, amount: number }[]}
 */
export function agentActions({ invoices = [], payments = [], payouts = [] }) {
  const out = [];
  for (const i of invoices) {
    if (!i?.id) continue;
    const amount = Number(i.amount) || 0;
    if (String(i.drafted_by || "").includes("agent")) out.push({ key: `draft:${i.id}`, at: i.created_at || "", agent: "Revenue agent", did: `drafted an invoice for ${short(String(i.lead || "").replace(" (fictional)", ""), 40) || "a lead"}`, kind: "invoice", id: i.id, amount });
    if (String(i.sent_by || "").includes("agent")) out.push({ key: `send:${i.id}`, at: i.sent_at || "", agent: "Send agent", did: "sent the approved draft", kind: "invoice", id: i.id, amount });
    // every reminder kept on the invoice (older records keep only the latest), each with its own time
    const reminders = i.reminders?.length ? i.reminders : i.reminded_at && String(i.reminder?.by || "").includes("agent") ? [{ at: i.reminded_at, by: i.reminder.by }] : [];
    for (const r of reminders) if (String(r.by || "").includes("agent")) out.push({ key: `nudge:${i.id}:${r.at}`, at: r.at, agent: "Chase agent", did: "sent a payment reminder", kind: "invoice", id: i.id, amount, ...(r.paypal ? { write: r.paypal } : {}) });
  }
  for (const p of payments) {
    if (p?.refund_id && String(p.refunded_by || "").includes("refund agent")) out.push({ key: `refund:${p.refund_id}`, at: p.refunded_at || p.captured_at || "", agent: "Refund agent", did: "refunded a double payment", kind: "refund", id: p.refund_id, amount: Number(p.refunded_amount || p.amount) || 0 });
  }
  for (const b of payouts) {
    // the shared demo's payouts only: a judge's own Try payout (and its once-marker) carries invoice_id or state
    if (b?.batch_id && !b.invoice_id && !b.state) out.push({ key: `payout:${b.batch_id}`, at: b.at || b.approved_at || "", agent: "Commission agent", did: `paid the ad's creator for ${b.capture_ids?.length || 0} paid order${b.capture_ids?.length === 1 ? "" : "s"}`, kind: "payout", id: b.batch_id, amount: Number(b.total) || 0 });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** What PayPal returned, as one status word and the API it came through. */
export function readBackStatus(kind, body) {
  if (kind === "invoice") return { status: body?.status || null, through: "Invoicing v2" };
  if (kind === "refund") return { status: body?.status || null, through: "Payments v2" };
  return { status: body?.items?.[0]?.transaction_status || body?.batch_header?.batch_status || null, through: "Payouts v1" };
}
