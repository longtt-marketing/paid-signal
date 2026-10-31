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
 * A shop's own PayPal activity download (CSV) as ledger payments, for the no-login audit: completed incoming payments,
 * refunds subtracted from the payment they refer to (Reference Txn ID), and the ad each payment came from when the shop
 * put it in the order: Paid Signal's "a=<ad>;..." custom_id, a "utm_content=<ad>" tag, or a Custom Number, Item Title or
 * Invoice Number that is exactly an ad in the export. Anything else stays unattributed: no ad is guessed.
 * @param {string} text the CSV  @param {string[]} adKeys ads in the export
 */
export function parsePayPalCsv(text, adKeys = []) {
  const lines = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return { payments: [], errors: ["The PayPal file is empty."], summary: null };
  const split = (l) => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const at = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const c = { date: at("date"), time: at("time"), type: at("type"), status: at("status"), currency: at("currency"), gross: at("gross"), fee: at("fee"), email: at("from email address"),
    id: at("transaction id"), ref: at("reference txn id"), custom: at("custom number", "custom field", "custom"), item: at("item title"), invoice: at("invoice number") };
  if (c.gross < 0 || c.id < 0 || c.type < 0) return { payments: [], errors: ["This does not look like a PayPal activity download: it needs Type, Gross and Transaction ID columns."], summary: null };
  const keys = new Map(adKeys.map((k) => [String(k).trim().toLowerCase(), k]));
  const adOf = (...vals) => {
    for (const v of vals) {
      const s = String(v ?? "").trim(); if (!s) continue;
      if (/(^|;)a=/.test(s)) { const a = unpackClick(s).ad; if (a) return { ad: keys.get(a.toLowerCase()) ?? a, how: "custom_id" }; }
      const u = s.match(/utm_content=([^&;\s]+)/i); if (u) { const a = decodeURIComponent(u[1]); return { ad: keys.get(a.toLowerCase()) ?? a, how: "utm_content" }; }
      if (keys.has(s.toLowerCase())) return { ad: keys.get(s.toLowerCase()), how: "exact ad name" };
    }
    return { ad: "", how: null };
  };
  const skip = /withdraw|deposit|transfer|conversion|hold|authori[sz]ation|fee|reserve|bank|general credit card/i;
  const byId = new Map(), refunds = [], errors = [];
  for (const [n, l] of lines.slice(1).entries()) {
    const r = split(l), type = r[c.type] || "", status = c.status >= 0 ? r[c.status] || "" : "Completed", gross = cents(r[c.gross]);
    if (!r[c.id] || Number.isNaN(gross)) { errors.push(`Row ${n + 2} skipped: no transaction id or amount.`); continue; }
    if (c.currency >= 0 && r[c.currency] && r[c.currency] !== "USD") { errors.push(`Row ${n + 2} skipped: ${r[c.currency]}, not USD.`); continue; }
    if (gross < 0 && /refund|reversal/i.test(type)) { refunds.push({ ref: c.ref >= 0 ? r[c.ref] : "", back: -gross }); continue; }
    if (gross <= 0 || skip.test(type) || !/^completed$/i.test(status)) continue;
    const { ad, how } = adOf(c.custom >= 0 ? r[c.custom] : "", c.item >= 0 ? r[c.item] : "", c.invoice >= 0 ? r[c.invoice] : "");
    const when = Date.parse(`${r[c.date] || ""} ${r[c.time] || ""}`.trim());
    byId.set(r[c.id], { capture_id: r[c.id], status: "COMPLETED", amount: dollars(gross), refunded_amount: "0.00", fee: c.fee >= 0 && r[c.fee] ? dollars(Math.abs(cents(r[c.fee]))) : null,
      ad, attributed_by: how, captured_at: Number.isNaN(when) ? null : new Date(when).toISOString(), payer_email_sha256: c.email >= 0 ? String(r[c.email] || "").trim().toLowerCase() || null : null });
  }
  let unlinked = 0;
  for (const f of refunds) {
    const p = byId.get(f.ref); if (!p) { unlinked++; continue; }
    const back = cents(p.refunded_amount) + f.back;
    p.refunded_amount = dollars(Math.min(back, cents(p.amount)));
    p.status = back >= cents(p.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  }
  const payments = [...byId.values()], tagged = payments.filter((p) => p.ad);
  const known = tagged.filter((p) => keys.has(p.ad.toLowerCase()));
  const sum = (xs) => xs.reduce((n, p) => n + cents(p.amount) - cents(p.refunded_amount), 0);
  const dates = payments.map((p) => p.captured_at).filter(Boolean).sort();
  return { payments, errors, summary: { payments: payments.length, refunds: refunds.length, refunds_not_found: unlinked, tagged: tagged.length, matched_to_export: known.length,
    tags_not_in_export: [...new Set(tagged.filter((p) => !keys.has(p.ad.toLowerCase())).map((p) => p.ad))], untagged_net_cents: sum(payments.filter((p) => !p.ad)), net_cents: sum(payments),
    from: dates[0] || null, to: dates.at(-1) || null } };
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
  const o = String(d.outcome || "");
  if (/^(RESOLVED_BUYER_FAVOUR|ACCEPTED)$/.test(o)) return "lost";
  if (/^(RESOLVED_SELLER_FAVOUR|CANCELED_BY_BUYER|DENIED)$/.test(o)) return "won";
  return "unclear"; // RESOLVED_WITH_PAYOUT, NONE or anything new: never counted as a win, held like an open one
}

/**
 * A capture counts as a paid order unless fully refunded; partial refunds reduce revenue. A possible duplicate (same
 * payer, same ad, minutes apart) is held: not a paid order and not revenue until it is refunded, the same
 * rule that keeps it back from Meta and Google.
 */
export function reconcile(adRows, payments) {
  const byAd = new Map(adRows.map((r) => [r.ad, { ad: r.ad, spend_cents: r.spend_cents, leads: r.leads, paid: 0, refunded: 0, held: 0, revenue_cents: 0, held_cents: 0, disputed: 0, disputed_cents: 0, fee_cents: 0, fees_observed: 0, fees_estimated: 0, captures: [] }]));
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
    else if (ds === "open" || ds === "unclear") { row.disputed++; row.disputed_cents += gross - back; continue; }
    else if (held.has(p.capture_id)) { row.held++; row.held_cents += gross - back; continue; }
    else row.paid++;
    row.revenue_cents += Math.max(0, gross - back);
    // PayPal's own fee on the capture when it was read at capture; otherwise PayPal's published rate (SHOP_COSTS)
    if (back < gross) { if (p.fee != null) { row.fee_cents += cents(p.fee); row.fees_observed++; } else { row.fee_cents += Math.round((gross - back) * SHOP_COSTS.fee_rate) + SHOP_COSTS.fee_fixed_cents; row.fees_estimated++; } }
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
  for (const m of Object.values(supportedMoves(rec))) { add(m.after_costs.toFixed(2)); if (m.average !== null) add(m.average.toFixed(2)); }
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
 * The shop's own costs, which the budget rule takes off paid revenue before comparing it with ad spend. The demo shop is
 * fictional, so these are its stated assumptions: what delivering a class costs as a share of its price, and PayPal's
 * standard checkout fee (the live captures show $1.97 on $49.00, close to 2.99% + $0.49). A real shop sets its own.
 */
export const SHOP_COSTS = { cost_share: 0.3, fee_rate: 0.0299, fee_fixed_cents: 49 };

/** Paid revenue left after the shop's costs and PayPal's fees, per $1 of the ad's spend. */
export const afterCostsPerDollar = (r, c = SHOP_COSTS) =>
  !r.spend_cents ? 0 : (r.revenue_cents * (1 - c.cost_share) - (r.fee_cents ?? (r.revenue_cents * c.fee_rate + r.paid * c.fee_fixed_cents))) / r.spend_cents;

/**
 * Which budget moves the payments support, per ad with at least `minPaid` paid orders (the others may only be kept).
 * Raise an ad only if what is left of its paid revenue after the shop's costs and PayPal's fees covers its ad spend ($1 per
 * $1) and its paid revenue per $1 is at least the average of those ads; reduce or pause only one that does not cover its
 * spend after costs, and do not leave such an ad as it is. An ad that covers its spend but is below the average is kept, not
 * cut. The gate refuses any move against this, whatever words justify it.
 * @param {ReturnType<typeof reconcile>} rec
 */
export function supportedMoves(rec, minPaid = 3, costs = SHOP_COSTS) {
  const ready = rec.ads.filter((r) => r.paid >= minPaid && r.spend_cents > 0);
  const avg = ready.length >= 2 ? ready.reduce((n, r) => n + r.revenue_cents / r.spend_cents, 0) / ready.length : null;
  /** @type {Record<string, { per_dollar: number, after_costs: number, average: number | null, increase: boolean, reduce: boolean, keep: boolean, why: string }>} */
  const out = {};
  for (const r of ready) {
    const pd = r.revenue_cents / r.spend_cents, net = afterCostsPerDollar(r, costs);
    const increase = net >= 1 && (avg === null || pd >= avg - 1e-9);
    // an ad that covers its spend after costs is not cut, even below the average; one that does not is not kept as it is
    const reduce = net < 1, keep = net >= 1;
    const vs = avg === null ? "" : `, against an average of $${avg.toFixed(2)} for ads with ${minPaid}+ paid orders`;
    out[r.ad] = { per_dollar: pd, after_costs: net, average: avg, increase, reduce, keep,
      why: `$${pd.toFixed(2)} of paid revenue per $1 of ad spend, $${net.toFixed(2)} after the shop's costs and PayPal fees${vs}` };
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
    if (ds === "open" || ds === "unclear" || ds === "lost") { held.push({ capture_id: p.capture_id, reason: ds === "lost" ? "dispute lost: the buyer was refunded" : ds === "open" ? "open PayPal dispute" : "dispute resolved without a clear outcome" }); continue; }
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
    if (p.source !== "g" || !p.click_id || clickAge(p) > 90 * DAY || hold?.has(p.capture_id) || ["open", "unclear"].includes(disputeState(p))) continue;
    const gross = cents(p.amount), back = disputeState(p) === "lost" ? gross : cents(p.refunded_amount || 0);
    conversions.push({ gclid: p.click_id, conversion_name: conversionName, conversion_time: gTime(p.captured_at), value: dollars(gross), currency: p.currency || "USD", order_id: p.capture_id });
    if (back >= gross) adjustments.push({ order_id: p.capture_id, conversion_name: conversionName, adjustment_type: "RETRACTION", adjustment_time: gTime(p.refunded_at || p.dispute?.updated_at || p.captured_at) });
    else if (back > 0) adjustments.push({ order_id: p.capture_id, conversion_name: conversionName, adjustment_type: "RESTATEMENT", adjusted_value: dollars(gross - back), adjustment_time: gTime(p.refunded_at || p.captured_at) });
  }
  return { conversions, adjustments };
}

export { dollars, cents };
