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
    const c = split(l), rawSpend = String(c[si] ?? "").replace(/[$,\s]/g, ""), rawLeads = String(c[li] ?? "").replace(/[,\s]/g, "");
    if (!c[ai] || !/^\d+(\.\d+)?$/.test(rawSpend) || !/^\d+$/.test(rawLeads)) { errors.push(`Row ${n + 2} skipped: ad, spend (a number, 0 or more) and leads (a whole number, 0 or more) are needed.`); continue; }
    const spend = cents(rawSpend), leads = Number(rawLeads);
    rows.push({ ad: c[ai], spend_cents: spend, leads });
  }
  return { rows, errors };
}

/**
 * A capture counts as a paid order unless fully refunded; partial refunds reduce revenue. A possible duplicate (same
 * payer, same ad, minutes apart) is held: not a paid order and not revenue until it is refunded, the same
 * rule that keeps it back from Meta and Google.
 */
export function reconcile(adRows, payments) {
  const byAd = new Map(adRows.map((r) => [r.ad, { ad: r.ad, spend_cents: r.spend_cents, leads: r.leads, paid: 0, refunded: 0, held: 0, revenue_cents: 0, held_cents: 0, captures: [] }]));
  const unmatched = [];
  const held = new Set(possibleDuplicates(payments).map((d) => d.capture_id));
  for (const p of payments) {
    const row = byAd.get(p.ad);
    if (!row) { unmatched.push(p.capture_id); continue; }
    const gross = cents(p.amount), back = cents(p.refunded_amount || 0);
    row.captures.push(p.capture_id);
    if (back >= gross) row.refunded++;
    else if (held.has(p.capture_id)) { row.held++; row.held_cents += gross - back; continue; }
    else row.paid++;
    row.revenue_cents += Math.max(0, gross - back);
  }
  const ads = [...byAd.values()].map((r) => ({
    ...r,
    cost_per_paid_cents: r.paid ? Math.round(r.spend_cents / r.paid) : null,
    lead_to_paid: r.leads ? r.paid / r.leads : null,
    roas: r.spend_cents ? r.revenue_cents / r.spend_cents : null,
    // what the ad returned after its own spend, refunds already taken out; product cost is not known here, so not profit
    net_cents: r.revenue_cents - r.spend_cents,
  }));
  const sum = (k) => ads.reduce((a, r) => a + r[k], 0);
  return {
    ads,
    totals: {
      spend_cents: sum("spend_cents"), leads: sum("leads"), paid: sum("paid"), refunded: sum("refunded"), held: sum("held"), revenue_cents: sum("revenue_cents"), held_cents: sum("held_cents"),
      spend_without_paid_cents: ads.filter((r) => r.paid === 0).reduce((a, r) => a + r.spend_cents, 0),
      net_cents: sum("revenue_cents") - sum("spend_cents"),
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
  [t.leads, t.paid, t.refunded, t.held, dollars(t.spend_cents), dollars(t.revenue_cents), dollars(t.held_cents), dollars(t.spend_without_paid_cents), dollars(Math.abs(t.net_cents))].forEach(add);
  for (const r of rec.ads) {
    [r.leads, r.paid, r.refunded, r.held, r.captures.length, dollars(r.spend_cents), dollars(r.revenue_cents), dollars(r.held_cents), dollars(Math.abs(r.net_cents))].forEach(add);
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
  const clean = String(text ?? "").replace(/\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]{10,}\b/g, " ").replace(/\b\d{12,}\b/g, " ") // all-digit capture ids too
    // dates and clock times say when, not how much: 2026-10-28, 10:49(:51)(Z), Oct 28 / 28 October, 28th
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?Z?)?\b/g, " ").replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:Z|UTC|am|pm)?\b/gi, " ")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\b/gi, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/g, " ");
  const found = clean.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) || [];
  return found.map((s) => s.replace(/[$,]/g, "")).filter((n) => !ok.has(n) && !ok.has(n.replace(/\.00$/, "")));
}

/**
 * Next period's budget split by PayPal-confirmed paid orders per dollar (with a small prior so one order is not certainty),
 * keeping at least `floor` of the budget on every ad so a slow ad still gets measured. An ad with fewer than `minPaid` paid
 * orders keeps its current share: one or two orders are not evidence enough to move money. Only the budget of ads that
 * have enough evidence moves, between those ads. The same rule the budget simulation tests (scripts/eval-budget-sim.mjs).
 * @param {Array<{ ad: string, spend: number, paid: number, share?: number }>} rows  share: current share, else spend / total
 * @param {number} budget
 */
export function proposeSplit(rows, budget, floor = 0.1, minPaid = 3) {
  const total = rows.reduce((n, r) => n + r.spend, 0) || 1;
  const now = rows.map((r) => (r.share ?? r.spend / total));
  const ready = rows.map((r) => r.paid >= minPaid);
  const n = ready.filter(Boolean).length;
  const pool = now.reduce((a, s, i) => a + (ready[i] ? s : 0), 0);
  const score = rows.map((r, i) => (ready[i] ? (r.paid + 0.5) / (r.spend + 10) : 0));
  const sum = score.reduce((a, b) => a + b, 0) || 1;
  const movable = n >= 2 && pool - floor * n > 0;
  return rows.map((r, i) => ({
    ad: r.ad,
    share: movable && ready[i] ? floor + (pool - floor * n) * (score[i] / sum) : now[i],
    reason: !ready[i] ? `kept: ${r.paid} paid order${r.paid === 1 ? "" : "s"}, fewer than ${minPaid}` : movable ? "moved by paid orders per dollar" : `kept: fewer than 2 ads have ${minPaid}+ paid orders`,
  })).map((x) => ({ ...x, budget: Math.round(budget * x.share * 100) / 100 }));
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
 * @param {{ sourceUrl?: string, hold?: Set<string> }} [opts] hold: possible duplicates, kept back until refunded
 */
export async function metaEvents(payments, { sourceUrl, hold } = {}) {
  const events = [], held = [];
  for (const p of payments) {
    const gross = cents(p.amount), back = cents(p.refunded_amount || 0);
    if (back >= gross) { held.push({ capture_id: p.capture_id, reason: "fully refunded" }); continue; }
    // PayPal still confirms the money, but with no ad click there is no ad to teach
    if (!p.click_id) { held.push({ capture_id: p.capture_id, reason: "no ad click" }); continue; }
    if (hold?.has(p.capture_id)) { held.push({ capture_id: p.capture_id, reason: "possible duplicate" }); continue; }
    if (clickAge(p) > 28 * DAY) { held.push({ capture_id: p.capture_id, reason: "paid more than 28 days after the click" }); continue; }
    const user = {};
    // fbc needs the real click time; an invoice payment has none, so it is matched on the lead's hashed email instead
    if (p.source === "fb" && p.click_id && p.clicked_at) user.fbc = `fb.1.${p.clicked_at}.${p.click_id}`;
    // the ledger keeps only the hash; Meta matches on it, so a purchase from a Google click still reaches Meta
    if (p.payer_email) user.em = [await sha256(p.payer_email.trim().toLowerCase())];
    else if (p.payer_email_sha256) user.em = [p.payer_email_sha256];
    if (p.user_agent) user.client_user_agent = p.user_agent; // Meta wants it on website events; stored at capture
    if (!user.fbc && !user.em) { held.push({ capture_id: p.capture_id, reason: "nothing Meta can match on" }); continue; }
    events.push({
      event_name: "Purchase", event_time: Math.floor(Date.parse(p.captured_at) / 1000), event_id: `paypal:${p.capture_id}`,
      // an invoice is paid after a conversation, not on a web page: Meta's "chat" source, with no page URL
      ...(p.via === "invoice" ? { action_source: "chat" } : { action_source: "website", ...(sourceUrl ? { event_source_url: sourceUrl } : {}) }), user_data: user,
      custom_data: { value: Number(dollars(gross - back)), currency: p.currency || "USD", order_id: p.order_id },
    });
  }
  return { events, held };
}

// Google Ads wants "yyyy-mm-dd hh:mm:ss+hh:mm"; the ledger keeps ISO UTC
const gTime = (iso) => String(iso).replace("T", " ").replace(/\.\d+/, "").replace(/Z$/, "+00:00");

/**
 * Google Ads offline conversion rows (by gclid) plus retractions for refunded captures.
 * @param {any[]} payments
 * @param {string} [conversionName]
 * @param {{ hold?: Set<string> }} [opts] hold: possible duplicates, not uploaded while flagged
 */
export function googleRows(payments, conversionName = "PayPal paid order", { hold } = {}) {
  const conversions = [], adjustments = [];
  for (const p of payments) {
    if (p.source !== "g" || !p.click_id || clickAge(p) > 90 * DAY || hold?.has(p.capture_id)) continue;
    const gross = cents(p.amount), back = cents(p.refunded_amount || 0);
    conversions.push({ gclid: p.click_id, conversion_name: conversionName, conversion_time: gTime(p.captured_at), value: dollars(gross), currency: p.currency || "USD", order_id: p.capture_id });
    if (back >= gross) adjustments.push({ order_id: p.capture_id, conversion_name: conversionName, adjustment_type: "RETRACTION", adjustment_time: gTime(p.refunded_at || p.captured_at) });
    else if (back > 0) adjustments.push({ order_id: p.capture_id, conversion_name: conversionName, adjustment_type: "RESTATEMENT", adjusted_value: dollars(gross - back), adjustment_time: gTime(p.refunded_at || p.captured_at) });
  }
  return { conversions, adjustments };
}

export { dollars, cents };
