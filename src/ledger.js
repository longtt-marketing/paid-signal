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
 * A buyer's PayPal dispute on a capture: "open" until PayPal resolves it, "lost" when it was resolved for the buyer or the
 * shop accepted the claim (the buyer has the money back), "won" otherwise.
 * @param {{ dispute?: { status?: string, outcome?: string | null } }} p
 */
export function disputeState(p) {
  const d = p.dispute;
  if (!d) return null;
  if (d.status !== "RESOLVED") return "open";
  return /BUYER_FAVOUR|ACCEPTED/.test(String(d.outcome || "")) ? "lost" : "won";
}

/**
 * A capture counts as a paid order unless fully refunded; partial refunds reduce revenue. A possible duplicate (same
 * payer, same ad, minutes apart) is held: not a paid order and not revenue until it is refunded, the same
 * rule that keeps it back from Meta and Google.
 */
export function reconcile(adRows, payments) {
  const byAd = new Map(adRows.map((r) => [r.ad, { ad: r.ad, spend_cents: r.spend_cents, leads: r.leads, paid: 0, refunded: 0, held: 0, revenue_cents: 0, held_cents: 0, disputed: 0, disputed_cents: 0, captures: [] }]));
  const unmatched = [];
  const held = new Set(possibleDuplicates(payments).map((d) => d.capture_id));
  for (const p of payments) {
    const row = byAd.get(p.ad);
    if (!row) { unmatched.push(p.capture_id); continue; }
    const gross = cents(p.amount), back = cents(p.refunded_amount || 0);
    row.captures.push(p.capture_id);
    // a dispute the buyer won is money back, like a refund; an open one is not a paid order until PayPal decides
    const ds = disputeState(p);
    if (ds === "lost") { row.refunded++; continue; }
    if (back >= gross) row.refunded++;
    else if (ds === "open") { row.disputed++; row.disputed_cents += gross - back; continue; }
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
      disputed: sum("disputed"), disputed_cents: sum("disputed_cents"),
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
  [t.leads, t.paid, t.refunded, t.held, t.disputed, dollars(t.disputed_cents), dollars(t.spend_cents), dollars(t.revenue_cents), dollars(t.held_cents), dollars(t.spend_without_paid_cents), dollars(Math.abs(t.net_cents))].forEach(add);
  for (const r of rec.ads) {
    [r.leads, r.paid, r.refunded, r.held, r.disputed, dollars(r.disputed_cents), r.captures.length, dollars(r.spend_cents), dollars(r.revenue_cents), dollars(r.held_cents), dollars(Math.abs(r.net_cents))].forEach(add);
    if (r.cost_per_paid_cents !== null) add(dollars(r.cost_per_paid_cents));
    if (r.lead_to_paid !== null) add(Math.round(r.lead_to_paid * 100) + "%");
    if (r.roas !== null) add(r.roas.toFixed(2));
  }
  // the direction rule's average (supportedMoves), which the agent may quote when it explains a move or a refusal
  for (const m of Object.values(supportedMoves(rec))) if (m.average !== null) add(m.average.toFixed(2));
  // the small-sample read the agent is shown (paybackOdds): chance, range, spend that settles it, the average paid order
  const odds = paybackOdds(rec);
  if (odds.average_paid_order_cents !== null) add(dollars(odds.average_paid_order_cents));
  for (const o of Object.values(odds.ads)) {
    add(Math.round(o.chance_covers_spend * 100) + "%"); o.cost_per_paid_range_cents.forEach((c) => add(dollars(c)));
    if (o.more_spend_to_decide_cents !== null) add(dollars(o.more_spend_to_decide_cents));
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

/**
 * What a small sample does say. Paid orders per dollar of an ad follow a Poisson rate with a Gamma prior worth one paid order
 * at the shop's own cost per paid order, so an ad with no data starts at the shop average. An ad covers its ad spend when
 * its rate is at least 1 / (the shop's average paid order). Returns, per ad: the chance it covers its spend, a 90% range for
 * its cost per paid order, and, while that is unclear, how much more spend with no paid order would make "below its ad
 * spend" 90% likely. Same Gamma with a whole-number shape throughout, so the CDF is a finite Poisson sum, no special functions.
 * @param {ReturnType<typeof reconcile>} rec
 */
export function paybackOdds(rec, sure = 0.9, priorOrders = 1) {
  const t = rec.totals;
  if (!t.paid || !t.spend_cents || !t.revenue_cents) return { average_paid_order_cents: null, ads: {} };
  const aov = t.revenue_cents / t.paid / 100, be = 1 / aov, prior = t.spend_cents / 100 / t.paid; // dollars
  // P(rate < r) for Gamma(shape k, rate b): 1 - sum_{i<k} e^-x x^i / i!, x = b r
  const cdf = (k, b, r) => { const x = b * r; let term = Math.exp(-x), s = term; for (let i = 1; i < k; i++) { term *= x / i; s += term; } return 1 - s; };
  const solve = (f, lo, hi) => { for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m)) hi = m; else lo = m; } return hi; };
  const ads = {};
  for (const r of rec.ads) {
    if (!r.spend_cents) continue;
    const k = priorOrders + r.paid, b = priorOrders * prior + r.spend_cents / 100; // priorOrders: how many orders the prior is worth (a whole number)
    const covers = 1 - cdf(k, b, be);
    const rateAt = (q) => solve((x) => cdf(k, b, x) >= q, 0, 100);
    const range = [Math.round(1 / rateAt(0.95)) * 100, Math.round(1 / rateAt(0.05)) * 100]; // whole dollars, in cents
    // spend S with no new order: shape stays k, b grows to b + S; smallest S where covering is at most 1 - sure
    const more = covers > 1 - sure && covers < sure ? Math.ceil(solve((s) => 1 - cdf(k, b + s, be) <= 1 - sure, 0, 1e6)) * 100 : null;
    ads[r.ad] = { chance_covers_spend: covers, cost_per_paid_range_cents: range, more_spend_to_decide_cents: more, verdict: covers <= 1 - sure ? "likely below its ad spend" : covers >= sure ? "likely covers its ad spend" : "not clear yet" };
  }
  return { average_paid_order_cents: Math.round(aov * 100), ads };
}

/**
 * Which budget moves the payments support, per ad with at least `minPaid` paid orders (the others may only be kept).
 * Raise an ad only if it returns at least $1 of paid revenue per $1 of ad spend and at least the average of those ads;
 * reduce or pause one below $1, or below that average. Paid revenue is not profit (product cost is unknown), so $1 per $1
 * is a floor, not a target. The gate refuses any move against this, whatever words justify it.
 * @param {ReturnType<typeof reconcile>} rec
 */
export function supportedMoves(rec, minPaid = 3) {
  const ready = rec.ads.filter((r) => r.paid >= minPaid && r.spend_cents > 0);
  const avg = ready.length >= 2 ? ready.reduce((n, r) => n + r.revenue_cents / r.spend_cents, 0) / ready.length : null;
  /** @type {Record<string, { per_dollar: number, average: number | null, increase: boolean, reduce: boolean, why: string }>} */
  const out = {};
  for (const r of ready) {
    const pd = r.revenue_cents / r.spend_cents;
    const increase = pd >= 1 && (avg === null || pd >= avg - 1e-9);
    const reduce = pd < 1 || (avg !== null && pd < avg - 1e-9);
    const vs = avg === null ? "" : `, against an average of $${avg.toFixed(2)} for ads with ${minPaid}+ paid orders`;
    out[r.ad] = { per_dollar: pd, average: avg, increase, reduce,
      why: `$${pd.toFixed(2)} of paid revenue per $1 of ad spend${vs}` };
  }
  return out;
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

// a payment long after its click is not credited to the ad: Meta attributes clicks for up to 7 days and takes events no
// older than 7 days; Google's window is longer and has its own rows
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
    const ds = disputeState(p);
    if (ds === "open" || ds === "lost") { held.push({ capture_id: p.capture_id, reason: ds === "open" ? "open PayPal dispute" : "dispute lost: the buyer was refunded" }); continue; }
    // PayPal still confirms the money, but with no ad click there is no ad to teach
    if (!p.click_id) { held.push({ capture_id: p.capture_id, reason: "no ad click" }); continue; }
    if (hold?.has(p.capture_id)) { held.push({ capture_id: p.capture_id, reason: "possible duplicate" }); continue; }
    // a buyer who came from a Google ad teaches Google, not Meta: sending it to Meta would let Meta take credit for it
    if (p.source === "g") { held.push({ capture_id: p.capture_id, reason: "Google click: sent to Google instead" }); continue; }
    if (clickAge(p) > 7 * DAY) { held.push({ capture_id: p.capture_id, reason: "paid more than 7 days after the click" }); continue; }
    const user = {};
    // fbc needs the real click time; an invoice payment has none, so it is matched on the lead's hashed email instead
    if (p.source === "fb" && p.click_id && p.clicked_at) user.fbc = `fb.1.${p.clicked_at}.${p.click_id}`;
    // the ledger keeps only the hash; Meta matches on it when there is no click time (an invoice paid after a chat)
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
    if (p.source !== "g" || !p.click_id || clickAge(p) > 90 * DAY || hold?.has(p.capture_id) || disputeState(p) === "open") continue;
    const gross = cents(p.amount), back = disputeState(p) === "lost" ? gross : cents(p.refunded_amount || 0);
    conversions.push({ gclid: p.click_id, conversion_name: conversionName, conversion_time: gTime(p.captured_at), value: dollars(gross), currency: p.currency || "USD", order_id: p.capture_id });
    if (back >= gross) adjustments.push({ order_id: p.capture_id, conversion_name: conversionName, adjustment_type: "RETRACTION", adjustment_time: gTime(p.refunded_at || p.dispute?.updated_at || p.captured_at) });
    else if (back > 0) adjustments.push({ order_id: p.capture_id, conversion_name: conversionName, adjustment_type: "RESTATEMENT", adjusted_value: dollars(gross - back), adjustment_time: gTime(p.refunded_at || p.captured_at) });
  }
  return { conversions, adjustments };
}

export { dollars, cents };
