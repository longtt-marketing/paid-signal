// Pure money arithmetic: ad export rows + PayPal captures -> per-ad paid outcome and ad-platform conversion payloads.
// Amounts are handled in cents so a $0.10 + $0.20 sum never drifts. Nothing here calls a network.

const cents = (v) => Math.round(Number(String(v ?? "").replace(/[^0-9.\-]/g, "")) * 100);
const dollars = (c) => (c / 100).toFixed(2);

/** The click travels inside PayPal's custom_id: "a=<ad key>;s=<fb|g|other>;c=<click id>;t=<click ms>". */
export function packClick({ ad, source, clickId, clickedAt }) {
  const safe = (x) => String(x ?? "").replace(/[;=]/g, "").slice(0, 80);
  const out = `a=${safe(ad)};s=${safe(source)};c=${safe(clickId)};t=${Number(clickedAt) || 0}`;
  return out.slice(0, 127);
}
export function unpackClick(customId) {
  const f = Object.fromEntries(String(customId ?? "").split(";").map((p) => p.split("=")).filter((p) => p.length === 2));
  return { ad: f.a || "", source: f.s || "", clickId: f.c || "", clickedAt: Number(f.t) || 0 };
}

/** Header names vary by export; map the ones Meta, Google and a hand-made sheet use. */
export function parseAdCsv(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ["The ad export is empty."] };
  const split = (l) => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  // exact names first, in priority order; never a rate column such as "cost per result"
  const col = (names) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
    for (const n of names) { const i = head.findIndex((h) => h.startsWith(n) && !h.includes(" per ")); if (i >= 0) return i; }
    return -1;
  };
  const ai = col(["ad", "ad key", "ad name", "campaign"]), si = col(["spend", "amount spent", "cost"]), li = col(["leads", "results", "conversions"]);
  const errors = [];
  if (ai < 0 || si < 0 || li < 0) return { rows: [], errors: ["The export needs columns for ad, spend and leads."] };
  const rows = [];
  for (const [n, l] of lines.slice(1).entries()) {
    const c = split(l), spend = cents(c[si]), leads = Number(String(c[li]).replace(/[^0-9.]/g, ""));
    if (!c[ai] || !Number.isFinite(spend) || !Number.isFinite(leads)) { errors.push(`Row ${n + 2} skipped: missing ad, spend or leads.`); continue; }
    rows.push({ ad: c[ai], spend_cents: spend, leads });
  }
  return { rows, errors };
}

/** A capture counts as a paid order unless fully refunded; partial refunds reduce revenue. */
export function reconcile(adRows, payments) {
  const byAd = new Map(adRows.map((r) => [r.ad, { ad: r.ad, spend_cents: r.spend_cents, leads: r.leads, paid: 0, refunded: 0, revenue_cents: 0, captures: [] }]));
  const unmatched = [];
  for (const p of payments) {
    const row = byAd.get(p.ad);
    if (!row) { unmatched.push(p.capture_id); continue; }
    const gross = cents(p.amount), back = cents(p.refunded_amount || 0);
    row.captures.push(p.capture_id);
    if (back >= gross) row.refunded++; else row.paid++;
    row.revenue_cents += Math.max(0, gross - back);
  }
  const ads = [...byAd.values()].map((r) => ({
    ...r,
    cost_per_paid_cents: r.paid ? Math.round(r.spend_cents / r.paid) : null,
    lead_to_paid: r.leads ? r.paid / r.leads : null,
    roas: r.spend_cents ? r.revenue_cents / r.spend_cents : null,
  }));
  const sum = (k) => ads.reduce((a, r) => a + r[k], 0);
  return {
    ads,
    totals: {
      spend_cents: sum("spend_cents"), leads: sum("leads"), paid: sum("paid"), refunded: sum("refunded"), revenue_cents: sum("revenue_cents"),
      spend_without_paid_cents: ads.filter((r) => r.paid === 0).reduce((a, r) => a + r.spend_cents, 0),
    },
    unmatched_captures: unmatched,
  };
}

/** The numbers the agent may quote, as display strings; anything else in its text is rejected. */
export function quotableNumbers(rec) {
  const out = new Set();
  const add = (v) => { if (v !== null && v !== undefined && v !== "") out.add(String(v)); };
  const t = rec.totals;
  // counts the agent can see in the table: how many ads, how many captures
  add(rec.ads.length); add(rec.ads.reduce((n, r) => n + r.captures.length, 0));
  [t.leads, t.paid, t.refunded, dollars(t.spend_cents), dollars(t.revenue_cents), dollars(t.spend_without_paid_cents)].forEach(add);
  for (const r of rec.ads) {
    [r.leads, r.paid, r.refunded, r.captures.length, dollars(r.spend_cents), dollars(r.revenue_cents)].forEach(add);
    if (r.cost_per_paid_cents !== null) add(dollars(r.cost_per_paid_cents));
    if (r.lead_to_paid !== null) add(Math.round(r.lead_to_paid * 100) + "%");
    if (r.roas !== null) add(r.roas.toFixed(2));
  }
  return out;
}

/** Every number in the text must be one the reconciliation produced (currency signs and commas ignored). */
export function ungroundedNumbers(text, allowed, extra = []) {
  const ok = new Set([...allowed, ...extra].map((s) => String(s).replace(/[$,]/g, "")));
  // ids such as capture 59A98014DG653005N are evidence, not quantities: drop them before extracting numbers
  const clean = String(text ?? "").replace(/\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]{10,}\b/g, " ").replace(/\b\d{12,}\b/g, " "); // all-digit capture ids too
  const found = clean.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
  return found.map((s) => s.replace(/[$,]/g, "")).filter((n) => !ok.has(n) && !ok.has(n.replace(/\.00$/, "")));
}

/** Two live captures from the same payer for the same ad within `windowMs` look like a double click at checkout. */
export function possibleDuplicates(payments, windowMs = 10 * 60 * 1000) {
  const at = (p) => Date.parse(p.captured_at);
  const live = payments.filter((p) => p.payer_email_sha256 && cents(p.refunded_amount || 0) < cents(p.amount)).sort((a, b) => at(a) - at(b));
  const out = [];
  for (const [i, b] of live.entries()) {
    const a = live.slice(0, i).reverse().find((x) => x.payer_email_sha256 === b.payer_email_sha256 && x.ad === b.ad && at(b) - at(x) <= windowMs);
    if (a) out.push({ capture_id: b.capture_id, first: a.capture_id, seconds: Math.round((at(b) - at(a)) / 1000) });
  }
  return out;
}

// a payment long after its click is not credited to the ad: Meta's longest click window is 28 days, Google's 90
const DAY = 86400000;
const clickAge = (p) => (p.clicked_at ? Date.parse(p.captured_at) - p.clicked_at : 0);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256(s) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }

/**
 * Meta Conversions API Purchase events for paid captures. event_id is derived from the capture so a resend
 * deduplicates; fbc follows Meta's fb.1.<click ms>.<fbclid> format. Fully refunded captures are held back and listed.
 * @param {any[]} payments
 * @param {{ sourceUrl?: string }} [opts]
 */
export async function metaEvents(payments, { sourceUrl } = {}) {
  const events = [], held = [];
  for (const p of payments) {
    const gross = cents(p.amount), back = cents(p.refunded_amount || 0);
    if (back >= gross) { held.push({ capture_id: p.capture_id, reason: "fully refunded" }); continue; }
    // PayPal still confirms the money, but with no ad click there is no ad to teach
    if (!p.click_id) { held.push({ capture_id: p.capture_id, reason: "no ad click" }); continue; }
    if (clickAge(p) > 28 * DAY) { held.push({ capture_id: p.capture_id, reason: "paid more than 28 days after the click" }); continue; }
    const user = {};
    if (p.source === "fb" && p.click_id) user.fbc = `fb.1.${p.clicked_at || Date.parse(p.captured_at)}.${p.click_id}`;
    // the ledger keeps only the hash; Meta matches on it, so a purchase from a Google click still reaches Meta
    if (p.payer_email) user.em = [await sha256(p.payer_email.trim().toLowerCase())];
    else if (p.payer_email_sha256) user.em = [p.payer_email_sha256];
    if (p.user_agent) user.client_user_agent = p.user_agent; // Meta wants it on website events; stored at capture
    events.push({
      event_name: "Purchase", event_time: Math.floor(Date.parse(p.captured_at) / 1000), event_id: `paypal:${p.capture_id}`,
      action_source: "website", ...(sourceUrl ? { event_source_url: sourceUrl } : {}), user_data: user,
      custom_data: { value: Number(dollars(gross - back)), currency: p.currency || "USD", order_id: p.order_id },
    });
  }
  return { events, held };
}

// Google Ads wants "yyyy-mm-dd hh:mm:ss+hh:mm"; the ledger keeps ISO UTC
const gTime = (iso) => String(iso).replace("T", " ").replace(/\.\d+/, "").replace(/Z$/, "+00:00");

/** Google Ads offline conversion rows (by gclid) plus retractions for refunded captures. */
export function googleRows(payments, conversionName = "PayPal paid order") {
  const conversions = [], adjustments = [];
  for (const p of payments) {
    if (p.source !== "g" || !p.click_id || clickAge(p) > 90 * DAY) continue;
    const gross = cents(p.amount), back = cents(p.refunded_amount || 0);
    conversions.push({ gclid: p.click_id, conversion_name: conversionName, conversion_time: gTime(p.captured_at), value: dollars(gross), currency: p.currency || "USD", order_id: p.capture_id });
    if (back >= gross) adjustments.push({ order_id: p.capture_id, conversion_name: conversionName, adjustment_type: "RETRACTION", adjustment_time: gTime(p.refunded_at || p.captured_at) });
    else if (back > 0) adjustments.push({ order_id: p.capture_id, conversion_name: conversionName, adjustment_type: "RESTATEMENT", adjusted_value: dollars(gross - back), adjustment_time: gTime(p.refunded_at || p.captured_at) });
  }
  return { conversions, adjustments };
}

export { dollars, cents };
