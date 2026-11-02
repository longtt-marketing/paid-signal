import { pathToFileURL } from "node:url";

const BASE = (process.env.PAID_SIGNAL_URL || "https://paid-signal.thelongmarketing.workers.dev").replace(/\/$/, "");

function iso(value) {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(String(value))) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function correctedInvoiceRecord(payment, invoices = []) {
  if (!payment || payment.via !== "invoice") throw new Error("The capture is not an invoice payment.");
  const invoice = invoices.find((item) => item.id === payment.order_id);
  const capturedAt = iso(payment.paypal_invoice_update_time) || iso(payment.payment_seen_at) || iso(invoice?.payment_seen_at) || iso(invoice?.paid_at);
  if (!capturedAt) throw new Error("No trustworthy UTC payment time is recorded for this capture.");
  const { payer_key, ...record } = payment;
  return { ...record, captured_at: capturedAt, paypal_payment_date: payment.paypal_payment_date || payment.captured_at || null };
}

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}.`);
  return response.json();
}

async function main() {
  const captureId = process.argv[2];
  if (!captureId) throw new Error("Usage: node scripts/fix-invoice-time.mjs <capture-id>");
  const [{ payments }, { invoices }] = await Promise.all([getJson("/api/ledger"), getJson("/api/invoices")]);
  const payment = payments.find((item) => item.capture_id === captureId);
  if (!payment) throw new Error(`Capture ${captureId} was not found in /api/ledger.`);
  process.stdout.write(`${JSON.stringify(correctedInvoiceRecord(payment, invoices), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
