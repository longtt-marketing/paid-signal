// Shared pieces of the Paid Signal Worker: responses and headers, visitor cookie, KV ledger reads and writes, PayPal and Meta
// sync, guards and caps. Routes live in src/routes/*.js; src/worker.js wires them together.
import { paypal } from "./paypal.js";
import { ordersSdk } from "./paypalSdk.js";
import { handleMcp } from "./mcp.js";
import { packClick, unpackClick, parseAdCsv, reconcile, metaEvents, googleRows, possibleDuplicates, paybackOdds, disputeState, supportedMoves } from "./ledger.js";
import { runAgent, anthropicLLM, checkRecommendation } from "./agent.js";
import { runSendAgent, SEND_SYSTEM, SEND_TOOLS } from "./sendAgent.js";
import { runRefundAgent, REFUND_SYSTEM, REFUND_TOOLS } from "./refundAgent.js";
import { runPayoutAgent, commissionOrders, PAYOUT_SYSTEM, PAYOUT_TOOLS } from "./payoutAgent.js";
import { parseCsv, runRevenueAgent, REVENUE_SYSTEM, REVENUE_TOOLS } from "./revenue.js";
import { runChaseAgent, eligibleForReminder, CHASE_SYSTEM, CHASE_TOOLS } from "./chaseAgent.js";
import { scenario, grade } from "./scenarios.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { adName } from "../web/src/names.js";
// Paid Signal Worker. Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID),
// PAYPAL_WEBHOOK_ID once the webhook is registered. KV LEDGER holds sandbox captures (no raw email, only its hash).
// PayPal reports refund times in its own zone (e.g. -07:00); the ledger keeps every time in UTC so they sort at a glance
// the owner request the dashboard sends ("Tell it to raise the ad with the most leads"); /judge replays its latest run
export const RULE_SINCE = "2026-10-31T12:00:00.000Z"; // the budget rule as it stands (3+ paid orders, direction after costs and fees)
export const OWNER_ASK = "Raise the free guide's budget: it brings the most leads.";
export const utc = (t) => { const d = new Date(t || Date.now()); return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); };

/**
 * PayPal's Agent Toolkit (sandbox) with only the named actions switched on. Each tool is called with one argument object.
 * @param {any} env
 * @param {Record<string, Record<string, boolean>>} actions
 * @returns {Record<string, { execute: (args: any) => Promise<any> }>}
 */
export function toolkitTools(env, actions) {
  return /** @type {any} */ (new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
    configuration: { actions, context: { sandbox: true } } }).getTools());
}

// The demo shop sells one thing; the price is fixed server-side so a page cannot choose what it pays.
export const PRODUCT = { sku: "trial-class", name: "Robotics trial class (demo shop)", amount: "49.00", currency: "USD" };
// the demo's ad export: a click for any other ad is kept as "direct", so the ledger cannot be filled with made-up ads
export const AD_KEYS = new Set(["trial_video", "free_guide", "parent_carousel", "holiday_static"]);
export const CLICK_ID = /^[A-Za-z0-9_-]{1,64}$/;
// tools AG Studio's built-in agents and Paid Signal's own Studio tools send; the Claude proxy serves nothing else
export const STUDIO_TOOLS = new Set(["add_page_filter", "add_widget", "add_widget_filter", "clear_plan", "configure_widget", "create_expression", "create_plan",
  "delete_expression", "execute_query", "position_widget", "remove_page_filter", "remove_widget", "remove_widget_filter", "rename_thread", "update_expression",
  "update_plan", "view_page", "view_plan", "view_report", "view_schema", "view_widget", "delegate_to", "complete_task", "read_paid_signal", "list_unpaid_leads",
  "draft_paypal_invoices", "check_paypal_ledger", "submit_budget_recommendation", "who_still_owes", "send_friendly_nudges", "filter_page_to_ad", "show_drafts_for_approval", "propose_nudges", "show_payments_in_ledger", "open_page"]);
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
export const VISITOR_COOKIE = "ps_vid";
export const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function visitorId(request) {
  const cookie = request.headers.get("cookie") || "";
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${VISITOR_COOKIE}=`))?.slice(VISITOR_COOKIE.length + 1);
  return VISITOR_ID.test(value || "") ? value.toLowerCase() : null;
}

export function addVisitorCookie(request, id) {
  const headers = new Headers(request.headers);
  const cookies = (headers.get("cookie") || "").split(";").map((part) => part.trim()).filter((part) => part && !part.startsWith(`${VISITOR_COOKIE}=`));
  headers.set("cookie", [...cookies, `${VISITOR_COOKIE}=${id}`].join("; "));
  return new Request(request, { headers });
}

export function withVisitorCookie(request, response, id, fresh) {
  const path = new URL(request.url).pathname;
  const isHtmlOrApi = path.startsWith("/api/") || path === "/mcp" || (response.headers.get("content-type") || "").toLowerCase().includes("text/html");
  if (!isHtmlOrApi) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  if (fresh) headers.append("set-cookie", `${VISITOR_COOKIE}=${id}; Max-Age=2592000; Path=/; SameSite=Lax; Secure; HttpOnly`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export const publicInvoice = ({ email, psid, lead_id, ...invoice }) => invoice;
export const publicLead = ({ email, psid, lead_id, ...lead }) => lead;
export const publicMeta = ({ events, ...meta }) => ({ ...meta, events: events.map((e) => ({ ...e, user_data: {
  ...e.user_data,
  ...(e.user_data.em ? { em: ["(SHA-256 of the payer's email; sent to Meta, not shown here)"] } : {}),
  ...(e.user_data.page_scoped_user_id ? { page_scoped_user_id: "(Messenger PSID; sent to Meta, kept server-side)" } : {}),
  ...(e.user_data.lead_id ? { lead_id: "(Meta lead ID; sent to Meta, kept server-side)" } : {}),
} })) });

// KV list() is capped per day on this Cloudflare plan (7 Nov: heavy testing used it up and every ledger read failed until
// the reset). Keys under these prefixes are also kept in one index document per prefix, updated by every put and delete
// that goes through this wrapper, so a listing costs one get. A real list() runs at most once an hour per prefix to
// correct the index, and when the daily cap is reached the index, even an older one, still answers.
const INDEXED = ["pay:", "inv:", "commission:", "dec:", "meta:"];
const RELIST_MS = 3600000;
/** @param {any} kv */
export function indexedKV(kv) {
  if (!kv || kv.__indexed) return kv;
  const prefixOf = (k) => INDEXED.find((p) => String(k).startsWith(p));
  const readIdx = async (p) => /** @type {{ keys: string[], listed: number } | null} */ (await kv.get(`idx:${p}`, "json"));
  const writeIdx = (p, keys, listed) => kv.put(`idx:${p}`, JSON.stringify({ listed, keys: [...new Set(keys)].sort() }));
  const realList = async (prefix) => {
    const keys = []; let cursor;
    do { const page = await kv.list({ prefix, cursor }); keys.push(...page.keys.map((k) => k.name)); cursor = page.list_complete ? undefined : page.cursor; } while (cursor);
    return keys;
  };
  return {
    __indexed: true,
    get: (...a) => kv.get(...a),
    getWithMetadata: (...a) => kv.getWithMetadata(...a),
    async put(k, v, o) {
      await kv.put(k, v, o);
      const p = prefixOf(k); if (!p) return;
      const idx = await readIdx(p);
      if (idx && !idx.keys.includes(k)) await writeIdx(p, [...idx.keys, k], idx.listed);
    },
    async delete(k) {
      await kv.delete(k);
      const p = prefixOf(k); if (!p) return;
      const idx = await readIdx(p);
      if (idx && idx.keys.includes(k)) await writeIdx(p, idx.keys.filter((x) => x !== k), idx.listed);
    },
    async list(opts = {}) {
      const prefix = String(opts.prefix || ""), p = INDEXED.find((x) => prefix.startsWith(x));
      if (!p) return kv.list(opts);
      let idx = await readIdx(p);
      if (!idx || Date.now() - (idx.listed || 0) > RELIST_MS) {
        try { const keys = await realList(p); const now = Date.now(); await writeIdx(p, keys, now); idx = { keys, listed: now }; }
        catch (e) { if (!idx) throw e; console.warn("KV list failed; answering from the index", e?.message); }
      }
      return { keys: idx.keys.filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

// the ledger is also read through a short edge cache, cleared on every write here
export const cacheKey = (prefix) => new Request(`https://ledger.paid-signal.internal/${prefix}`);
export async function cachedList(env, prefix) {
  const cache = /** @type {any} */ (globalThis).caches?.default;
  const hit = cache && (await cache.match(cacheKey(prefix)));
  if (hit) return hit.json();
  const out = await listPrefix(env, prefix);
  if (cache) await cache.put(cacheKey(prefix), new Response(JSON.stringify(out), { headers: { "cache-control": "max-age=120" } }));
  return out;
}
export const forget = async (prefix) => { await /** @type {any} */ (globalThis).caches?.default?.delete(cacheKey(prefix)); };

/** Keep the latest gate-checked budget recommendation; the owner's decisions refer to it by id. */
export async function saveRecommendation(env, recommendation, source, visitor, shared = false) {
  const saved = { id: `R-${Date.now().toString(36).toUpperCase()}`, at: new Date().toISOString(), source, recommendation };
  if (shared) await env.LEDGER.put("rec:latest", JSON.stringify(saved));
  else await env.LEDGER.put(`rec:v:${visitor}`, JSON.stringify(saved), { expirationTtl: 2592000 });
  return saved;
}

/**
 * The revenue agent reads what each unpaid lead wrote and calls create_invoice itself; inside that call code prices and
 * checks it, then PayPal's Agent Toolkit creates the draft and the agent gets PayPal's id back. Nothing is sent: each draft
 * waits in Approvals. Used by the dashboard and by
 * the nightly refill, so every draft a judge finds was decided by the agent and priced by code.
 */
/**
 * A PayPal sandbox invoice draft, made through the Agent Toolkit's create_invoice from a proposal code has already priced
 * (price list, the lead's own email as the recipient). Returns PayPal's invoice id, or null if PayPal returned none.
 * @param {Record<string, { execute: (args: any) => Promise<any> }>} toolkit
 * @param {any} lead the lead: its name and email
 * @param {{ note?: string, lines: { name: string, unit: string }[] }} p
 */
export async function createDraftInvoice(toolkit, lead, p) {
  const params = { currency_code: "USD", reference: "Kite Robotics booking", note: p.note, invoicer_business_name: "Kite Robotics Club (demo)",
    primary_recipients: [{ billing_info: { email_address: lead.email, name: { given_name: String(lead.lead).replace(/ \(.*\)$/, "") } } }],
    items: p.lines.map((l) => ({ name: l.name, quantity: "1", unit_amount: { currency_code: "USD", value: l.unit } })) };
  /** @type {any} */ let out = {};
  try { out = JSON.parse(String(await toolkit.create_invoice.execute(params))); } catch {}
  const id = out.id || String(out.href || out.links?.[0]?.href || "").split("/").pop();
  return /^INV2-[A-Z0-9-]+$/.test(id) ? id : null;
}

export async function revenueDrafts(env, url) {
  const t0 = Date.now();
  const invoices = await listPrefix(env, "inv:");
  const leads = (await demoLeads(env, url)).filter((l) => !invoices.some((i) => i.lead === l.lead && i.status === "PAID"));
  const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: REVENUE_SYSTEM, tools: REVENUE_TOOLS });
  const toolkit = toolkitTools(env, { invoices: { create: true } });
  const drafts = [];
  // the agent's own create_invoice call runs this once code has priced and checked it: price list, the lead's own email
  const createDraft = async (p) => {
    const lead = leads.find((l) => l.lead === p.lead);
    const id = await createDraftInvoice(toolkit, lead, p);
    if (!id) return { error: "PayPal returned no invoice id" };
    const rec = { id, lead: lead.lead, ad: lead.ad, email: lead.email, channel: lead.channel || "web", psid: lead.psid || null, page_id: lead.page_id || null, lead_id: lead.lead_id || null,
      amount: p.total, lines: p.lines, status: "DRAFT", message: String(lead.message || "").slice(0, 500) || null,
      reference: packClick({ ad: lead.ad, source: lead.source, clickId: lead.click_id, clickedAt: 0 }), note: p.note, reason: p.reason,
      drafted_by: "revenue agent (Claude) via PayPal Agent Toolkit", created_at: new Date().toISOString() };
    await env.LEDGER.put(`inv:${id}`, JSON.stringify(rec)); drafts.push(rec);
    return { id };
  };
  const run = await runRevenueAgent({ llm, leads, invoices, createDraft });
  await forget("inv:");
  return ({ drafts, skips: run.skips, refusals: run.refusals, summary: run.summary, trace: run.trace, ms: Date.now() - t0 });
}

/** Mark the disputed capture(s) in the ledger with the dispute's state; reconcile and the ad-platform payloads read it. */
export async function applyDispute(env, d) {
  const marked = [];
  for (const t of d.disputed_transactions || []) {
    const id = t.seller_transaction_id; const rec = id && (await env.LEDGER.get(`pay:${id}`, "json"));
    if (!rec) continue;
    rec.dispute = { id: d.dispute_id, status: d.status, reason: d.reason || null, amount: d.dispute_amount?.value || null,
      outcome: d.dispute_outcome?.outcome_code || null, updated_at: d.update_time || new Date().toISOString() };
    await env.LEDGER.put(`pay:${id}`, JSON.stringify(rec)); marked.push(id);
  }
  if (marked.length) await forget("pay:");
  return marked;
}

/**
 * Ask PayPal, through the Agent Toolkit's list_disputes and get_dispute, for every dispute on this account, and mark the
 * ledger. The webhook does the same the moment a dispute opens; this catches any event the sandbox did not deliver.
 */
export async function syncDisputes(env) {
  const tk = toolkitTools(env, { disputes: { list: true, get: true } });
  const parse = (x) => { try { return typeof x === "string" ? JSON.parse(x) : x || {}; } catch { return {}; } };
  const list = parse(await tk.list_disputes.execute({ page_size: 50 })).items || [];
  const marked = [];
  for (const item of list.slice(0, 20)) marked.push(...(await applyDispute(env, parse(await tk.get_dispute.execute({ dispute_id: item.dispute_id })))));
  return { checked_at: new Date().toISOString(), disputes: list.length, open: list.filter((x) => x.status !== "RESOLVED").length, ledger_payments_marked: marked };
}

// The evidence ledger is frozen: every payment captured before this moment (or marked evidence) is what the judge path,
// the story and /proof quote, the same for everyone. A payment a visitor makes later belongs to that visitor: it shows
// on their own dashboard, trail and reconciliation, and never changes what other visitors see.
export const EVIDENCE_BEFORE = "2026-11-04T19:00:00Z";
export const isEvidence = (/** @type {any} */ p) => Boolean(p?.evidence) || String(p?.captured_at || "") < EVIDENCE_BEFORE;
/** @param {any} env @param {string|null} [visitor] the visitor whose own payments join the evidence ledger */
export async function listPayments(env, visitor = null) {
  return (await cachedList(env, "pay:")).filter((p) => isEvidence(p) || (visitor && p.visitor === visitor))
    .sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
}

/** Store what the capture proves: amount, status, the click that led to it. The payer email is kept only as a hash. */
export async function recordCapture(env, order, userAgent, visitor = null) {
  const pu = order.purchase_units?.[0] || {};
  const cap = pu.payments?.captures?.[0];
  if (!cap) return null;
  const click = unpackClick(cap.custom_id || pu.custom_id);
  const email = order.payer?.email_address;
  const record = {
    capture_id: cap.id, order_id: order.id, status: cap.status, amount: cap.amount?.value, currency: cap.amount?.currency_code,
    ad: click.ad, source: click.source, click_id: click.clickId, clicked_at: click.clickedAt, channel: "web",
    captured_at: cap.create_time || new Date().toISOString(), refunded_amount: "0.00",
    // PayPal's fee on this capture as PayPal reports it, so the budget rule uses the fee actually charged
    fee: cap.seller_receivable_breakdown?.paypal_fee?.value ?? null,
    payer_email_sha256: email ? await sha(email.trim().toLowerCase()) : null,
  };
  if (userAgent) record.user_agent = userAgent.slice(0, 300); // the buyer's browser, for Meta's website events
  if (visitor) record.visitor = visitor; // whose payment this is, if it falls after the evidence freeze
  // a replayed capture must not wipe refunds already recorded against it
  const prev = await env.LEDGER.get(`pay:${cap.id}`, "json");
  if (prev) { record.user_agent ??= prev.user_agent; record.fee ??= prev.fee ?? null; record.refunded_amount = prev.refunded_amount; record.status = prev.status; if (prev.refunded_at) record.refunded_at = prev.refunded_at;
    for (const k of ["confirmed_distinct", "refund_id", "refunded_by", "buyer_message", "visitor", "evidence"]) if (prev[k]) record[k] = prev[k]; }
  await env.LEDGER.put(`pay:${cap.id}`, JSON.stringify(record)); await forget("pay:");
  return record;
}

/**
 * The moment PayPal confirms a payment, its Purchase event goes to the shop's Meta dataset. In this demo the dataset is a
 * test one (test_event_code), so Events Manager shows the event live and it never counts toward real ads. Meta's answer
 * is kept with the payment so the dashboard and the receipt can show it. A held capture (duplicate, no click) is not sent.
 */
export async function sendToMeta(env, url, record, { recheckHeld = false } = {}) {
  if (!record || !env.META_CAPI_TOKEN || !env.META_DATASET_ID) return null;
  const sent = await env.LEDGER.get(`meta:${record.capture_id}`, "json");
  // recheckHeld: a person has since confirmed a held payment as a separate order, so the hold is decided again (same event_id)
  if (sent && (sent.ok || (sent.held && !recheckHeld))) return sent; // a send that failed (Meta timed out) is tried again
  const payments = await listPayments(env, record.visitor || null);
  const { events, held } = await metaEvents([record], { sourceUrl: `${url.origin}/shop.html`, hold: heldDuplicates(payments) });
  let out;
  if (!events.length) out = { capture_id: record.capture_id, held: held[0]?.reason || "held", at: new Date().toISOString() };
  else {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${env.META_DATASET_ID}/events`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000),
        // test events only while META_TEST_CODE is set (this demo); a real shop leaves it unset
        body: JSON.stringify({ data: events, ...(env.META_TEST_CODE ? { test_event_code: env.META_TEST_CODE } : {}), access_token: env.META_CAPI_TOKEN }),
      });
      const j = await res.json().catch(() => ({}));
      out = { capture_id: record.capture_id, event_id: events[0].event_id, value: events[0].custom_data.value, ok: res.ok, events_received: j.events_received ?? 0,
        fbtrace_id: j.fbtrace_id || null, error: j.error ? String(j.error.message || "error").slice(0, 160) : null, test_event: Boolean(env.META_TEST_CODE), at: new Date().toISOString() };
    } catch (e) { out = { capture_id: record.capture_id, ok: false, error: "Meta did not answer in time.", at: new Date().toISOString() }; }
  }
  await env.LEDGER.put(`meta:${record.capture_id}`, JSON.stringify(out), { expirationTtl: 60 * 86400 }); await forget("meta:");
  return out;
}

export async function applyRefund(env, captureId, refundedValue, when) {
  const rec = await env.LEDGER.get(`pay:${captureId}`, "json");
  if (!rec) return null;
  const total = (Math.round(Number(rec.refunded_amount || 0) * 100) + Math.round(Number(refundedValue) * 100)) / 100;
  rec.refunded_amount = Math.min(total, Number(rec.amount)).toFixed(2);
  rec.status = Number(rec.refunded_amount) >= Number(rec.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  rec.refunded_at = utc(when);
  await env.LEDGER.put(`pay:${captureId}`, JSON.stringify(rec)); await forget("pay:");
  return rec;
}

// The dashboard's answer is in the HTML itself, so a phone or a slow connection sees it before the app loads.
export async function firstPaint(env, url, page) {
  try {
    const csv = await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text();
    const payments = await listPayments(env);
    const t = reconcile(parseAdCsv(csv).rows, payments).totals;
    const metaCount = (await metaFromLedger(payments, `${url.origin}/shop.html`)).events.length;
    // the same markup and classes the app renders, so the page reads at once and nothing jumps when React takes over
    const html = `<div class="app"><header class="top"><div class="top-in"><a class="brand" href="/"><span class="mark"><i></i></span>Paid Signal</a></div></header>`
      + `<main class="desk"><section class="hero"><div class="hero-copy"><h1 class="sr">Ads report ${t.leads} leads. PayPal confirms ${t.paid} paid ${t.paid === 1 ? "order" : "orders"}.</h1><p class="kicker">Kite Robotics Club · demo ad export · PayPal sandbox</p>`
      + `<div class="duo"><div><b class="n claimed">${t.leads}</b><span>leads the ads report</span></div><div><b class="n paid">${t.paid}</b><span>paid ${t.paid === 1 ? "order" : "orders"} PayPal confirms</span></div></div>`
      + `<p class="pitch">Ad platforms learn from the ${t.leads} leads. PayPal confirms ${t.paid} paid ${t.paid === 1 ? "order" : "orders"}: the ${metaCount} from Meta ads go back to Meta (test events in this demo); the Google ones become an offline-conversion file for Google Ads.</p><div class="hero-actions"><a class="cta" href="/judge">Judge path</a><a class="hero-link" href="/audit">Audit your own ads</a></div></div>`
      + `<div class="hero-bars"><p class="ghost">Loading the ledger…</p></div></section></main></div>`;
    return new (/** @type {any} */ (globalThis).HTMLRewriter)().on("#root", { element(e) { e.setInnerContent(html, { html: true }); } }).transform(page);
  } catch { return page; }
}

/**
 * Agent loops sometimes leave an empty text block, or an assistant turn ending in whitespace, and the Messages API refuses
 * both with a 400. Clean them before the turn goes out, so one stray block cannot stop a Studio agent mid-run.
 */
export function cleanTurns(messages) {
  const out = messages.map((m) => {
    if (typeof m.content === "string") return { ...m, content: m.content.trim() ? m.content : "(no text)" };
    if (!Array.isArray(m.content)) return m;
    const content = m.content.filter((c) => c?.type !== "text" || String(c.text || "").trim());
    return { ...m, content: content.length ? content : [{ type: "text", text: "(no text)" }] };
  });
  const last = out.at(-1);
  if (last?.role === "assistant") {
    if (typeof last.content === "string") last.content = last.content.trimEnd();
    else { const t = [...last.content].reverse().find((c) => c.type === "text"); if (t && last.content.at(-1) === t) t.text = t.text.trimEnd(); }
    // the model behind Studio takes no assistant prefill: a turn that ends on the assistant's own words asks it to go on
    const hasToolUse = Array.isArray(last.content) && last.content.some((c) => c?.type === "tool_use");
    if (!hasToolUse) out.push({ role: "user", content: "Continue." });
  }
  return out;
}

// The dashboard page: only this site's scripts, PayPal and Google Fonts; never framed by another site.
export const PAGE_CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:", "connect-src 'self'", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join("; ");
export function withPageHeaders(res) {
  const out = new Response(res.body, res);
  out.headers.set("content-security-policy", PAGE_CSP);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  out.headers.set("cache-control", "no-store");
  return out;
}

// MCP tools reuse the Worker's own read-only routes, so an MCP client sees exactly what the dashboard shows
// appFetch is the Worker's own fetch handler, passed in by src/worker.js
export async function mcpTool(env, url, name, args, appFetch) {
  const get = async (path, body) => (await appFetch(new Request(url.origin + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), env)).json();
  if (name === "read_paid_signal") {
    const csv = typeof args.csv === "string" && args.csv.trim() ? args.csv : await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text();
    const [{ reconciliation: r, csv_errors }, ledger] = await Promise.all([get("/api/reconcile", { csv }), get("/api/ledger")]);
    const $ = (c) => (c / 100).toFixed(2);
    return {
      totals: { leads: r.totals.leads, paid_orders: r.totals.paid, fully_refunded: r.totals.refunded, spend_usd: $(r.totals.spend_cents), paid_revenue_usd: $(r.totals.revenue_cents) },
      ads: r.ads.map((a) => ({ ad: a.ad, spend_usd: $(a.spend_cents), leads: a.leads, paid_orders: a.paid, fully_refunded: a.refunded, paid_revenue_usd: $(a.revenue_cents), cost_per_paid_order_usd: a.cost_per_paid_cents == null ? null : $(a.cost_per_paid_cents) })),
      possible_duplicates: ledger.duplicates, csv_errors,
    };
  }
  if (name === "list_unpaid_leads") {
    const [{ leads }, { invoices }] = await Promise.all([get("/api/leads"), get("/api/invoices")]);
    const status = (l) => invoices.find((i) => i.lead === l.lead && i.status === "PAID")?.status || invoices.find((i) => i.lead === l.lead)?.status || null;
    return leads.filter((l) => status(l) !== "PAID").map((l) => ({ lead: l.lead, ad: l.ad, asked_for: l.asked_for, invoice: status(l) }));
  }
  if (name === "list_payments") {
    const { payments, duplicates } = await get("/api/ledger");
    const dup = new Map(duplicates.map((d) => [d.capture_id, d.first]));
    return payments.map((p) => ({ capture_id: p.capture_id, ad: p.ad, source: p.source, amount: p.amount, refunded: p.refunded_amount, captured_at: p.captured_at, possible_duplicate_of: dup.get(p.capture_id) || null }));
  }
  if (name === "get_ad_truth" || name === "propose_budget") {
    const csv = await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text();
    const [{ reconciliation: r, meta }, ledger, { invoices }] = await Promise.all([get("/api/reconcile", { csv }), get("/api/ledger"), get("/api/invoices")]);
    if (name === "propose_budget") {
      if (args.budget_usd !== undefined && !(Number(args.budget_usd) >= 1 && Number(args.budget_usd) <= 1000000)) throw new Error("budget_usd must be a number from 1 to 1000000.");
      const spend = r.ads.reduce((n, a) => n + a.spend_cents, 0) || 1;
      const budget = args.budget_usd !== undefined ? Number(args.budget_usd) : spend / 100;
      // the same rule the evidence gate enforces on the budget agent (supportedMoves), so an outside agent gets the same answer
      const moves = supportedMoves(r);
      const proposal = r.ads.map((a) => {
        const m = moves[a.ad];
        const change = !m ? "keep" : m.increase ? "increase" : m.reduce ? "reduce" : "keep";
        const why = !m ? `${a.paid} paid order${a.paid === 1 ? "" : "s"}, fewer than 3: no move either way` : m.why;
        return { ad: a.ad, name: adName(a.ad), paid_orders: a.paid, now_usd: (budget * a.spend_cents / spend).toFixed(2), change, why };
      });
      return { proposal, rule: "the evidence gate's rule: no move on fewer than 3 PayPal-confirmed paid orders; an ad may be raised only if it covers its spend after the shop's costs and PayPal fees and is at or above the average of ads with 3+ paid orders; an ad that does not cover its spend is cut",
        caveat: proposal.every((p) => p.change === "keep") ? "No ad has enough paid orders, or none qualifies, so every ad keeps its budget." : "Based on few orders; treat as a direction, not a forecast.",
        applied: false, how_to_apply: "A person approves budget changes in the Paid Signal dashboard; this tool changes nothing." };
    }
    const capAd = Object.fromEntries(ledger.payments.map((p) => [p.capture_id, p.ad]));
    return r.ads.map((a) => ({ ad: a.ad, name: adName(a.ad), leads_reported: a.leads, invoiced: invoices.filter((i) => i.ad === a.ad && i.status !== "CANCELLED").length, paid_orders: a.paid,
      held_as_duplicate: a.held, fully_refunded: a.refunded, meta_purchase_events: meta.events.filter((e) => capAd[String(e.event_id).replace("paypal:", "")] === a.ad).length }));
  }
  if (name === "check_paypal_ledger") return get("/api/paypal-check");
  throw new Error(`Unknown tool ${name}`);
}

// a possible duplicate is held: not a paid order in the reconciliation and not reported to ad platforms until it is refunded
export const heldDuplicates = (payments) => new Set(possibleDuplicates(payments).map((d) => d.capture_id));
// payments captured before this are the seeded demo ledger; refunds on them are previewed, not sent
export const SEEDED_BEFORE = "2026-10-29T09:00:00Z";
// The creator program: the parent in the testimonial carousel is paid per PayPal-confirmed paid order from that ad, not per
// lead. In the sandbox a PayPal test account (payer id below) stands in for the creator.
export const CREATOR = { ad: "parent_carousel", creator: "the parent who made the testimonial (fictional; a PayPal sandbox account stands in)", rate: "5.00", receiver: "TEBYBGHQP8TSW" };
export async function commissionState(env) {
  const [payments, paid] = await Promise.all([listPayments(env), cachedList(env, "commission:")]);
  const paidOut = Object.fromEntries(paid.flatMap((b) => (b.capture_ids || []).map((id) => [id, b.batch_id])));
  const orders = commissionOrders(payments, CREATOR, heldDuplicates(payments), paidOut, disputeState);
  // a refund or a lost dispute after the payout: the commission on it is owed back (shown, not clawed back automatically)
  const owedBack = paid.flatMap((b) => (b.capture_ids || []).filter((id) => { const p = payments.find((x) => x.capture_id === id); return p && (Number(p.refunded_amount || 0) >= Number(p.amount) || disputeState(p) === "lost"); }));
  // the agent's own sentence was written before PayPal finished the batch; judges see PayPal's read-back instead
  return { orders, batches: paid.sort((a, b) => String(b.at).localeCompare(String(a.at))).map(({ summary, ...b }) => b), owed_back: owedBack };
}

// metaEvents hashes the email itself; here only the stored hash exists, so pass it through as an already-hashed field.
export async function metaFromLedger(payments, sourceUrl) {
  return metaEvents(payments.map((p) => ({ ...p, payer_email: null })), { sourceUrl, hold: heldDuplicates(payments) });
}

export async function listPrefix(env, prefix) {
  const out = []; let cursor;
  do {
    const page = await env.LEDGER.list({ prefix, cursor });
    for (const k of page.keys) { const v = await env.LEDGER.get(k.name, "json"); if (v) out.push(v); }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function demoLeads(env, url) {
  return parseCsv(await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-leads.csv`))).text());
}

/** An invoice paid through PayPal becomes a capture in the ledger, attributed by the click packed in its reference. */
export async function recordInvoicePayment(env, invoice, url = new URL("https://paid-signal.thelongmarketing.workers.dev/")) {
  const kept = await env.LEDGER.get(`inv:${invoice.id}`, "json");
  const click = unpackClick(invoice.detail?.memo || kept?.reference || invoice.detail?.reference);
  const txs = invoice.payments?.transactions || [];
  const learnedAt = new Date().toISOString();
  const update = invoice.detail?.metadata?.last_update_time;
  const updateDate = update && /(?:Z|[+-]\d{2}:\d{2})$/i.test(update) ? new Date(update) : null;
  const invoiceUpdateAt = updateDate && !Number.isNaN(updateDate.getTime()) ? updateDate.toISOString() : null;
  for (const t of txs) {
    const id = t.payment_id; if (!id || (await env.LEDGER.get(`pay:${id}`))) continue;
    await env.LEDGER.put(`pay:${id}`, JSON.stringify({
      capture_id: id, order_id: invoice.id, status: "COMPLETED", amount: t.amount?.value, currency: t.amount?.currency_code || "USD",
      ad: click.ad, source: click.source, click_id: click.clickId, clicked_at: click.clickedAt,
      channel: kept?.channel || "web", psid: kept?.psid || null, page_id: kept?.page_id || null, lead_id: kept?.lead_id || null,
      // The sandbox can label account-local transaction time with Z, so keep it raw and use the invoice UTC audit time.
      captured_at: invoiceUpdateAt || learnedAt, payment_seen_at: learnedAt, paypal_payment_date: t.payment_date_time || t.payment_date || null,
      ...(invoiceUpdateAt ? { paypal_invoice_update_time: invoiceUpdateAt } : {}),
      refunded_amount: "0.00", payer_email_sha256: kept?.email ? await sha(String(kept.email).trim().toLowerCase()) : null, via: "invoice",
      // what the buyer wrote before paying: the refund agent reads it as evidence if this payment is ever flagged
      ...(kept?.message ? { buyer_message: kept.message } : {}),
      ...(kept?.approved_visitor ? { visitor: kept.approved_visitor } : {}),
    }));
    // An invoice payment teaches Meta too, the moment PayPal says it is paid.
    await sendToMeta(env, url, await env.LEDGER.get(`pay:${id}`, "json"));
  }
  const rec = await env.LEDGER.get(`inv:${invoice.id}`, "json");
  if (rec) { rec.status = invoice.status || "PAID"; rec.paid_at = learnedAt; rec.payment_seen_at = learnedAt; await env.LEDGER.put(`inv:${invoice.id}`, JSON.stringify(rec)); }
  await forget("pay:"); await forget("inv:");
}

/** A judge's try invoice that PayPal reports paid: stored in the judge's visitor-scoped ledger, outside the evidence ledger. */
export async function tryPaid(env, invoice, url = new URL("https://paid-signal.thelongmarketing.workers.dev/")) {
  const rec = await env.LEDGER.get(`try:${invoice.id}`, "json");
  if (!rec) return null;
  const t = (invoice.payments?.transactions || [])[0];
  rec.status = invoice.status || rec.status;
  if (t && !rec.paid) rec.paid = { payment_id: t.payment_id || null, amount: t.amount?.value || rec.amount, currency: t.amount?.currency_code || "USD",
    paypal_payment_date: t.payment_date_time || t.payment_date || null, method: t.method || null, seen_at: new Date().toISOString() };
  await env.LEDGER.put(`try:${invoice.id}`, JSON.stringify(rec), { expirationTtl: 60 * 86400 });
  if (invoice.status === "PAID" && t?.payment_id && rec.vid) {
    const key = `pay:${t.payment_id}`;
    let payment = await env.LEDGER.get(key, "json");
    if (!payment) {
      const now = new Date().toISOString();
      payment = { capture_id: t.payment_id, order_id: invoice.id, status: "COMPLETED", amount: t.amount?.value || rec.amount,
        currency: t.amount?.currency_code || "USD", ad: rec.ad || "parent_carousel", source: rec.click?.source || "other", click_id: rec.click?.click_id || "", clicked_at: rec.click?.clicked_at || 0,
        channel: rec.channel || "web", captured_at: now, payment_seen_at: now, paypal_payment_date: t.payment_date_time || t.payment_date || null,
        refunded_amount: "0.00", payer_email_sha256: rec.email ? await sha(String(rec.email).trim().toLowerCase()) : null,
        via: "invoice", ...(rec.message ? { buyer_message: rec.message } : {}), visitor: rec.vid, try_invoice: invoice.id };
      await env.LEDGER.put(key, JSON.stringify(payment));
      await forget("pay:");
    }
    // Do not let an unrelated pre-existing payment id be attributed to this visitor; a matching retry is safe.
    if (payment.try_invoice === invoice.id && payment.visitor === rec.vid) await sendToMeta(env, url, payment);
  }
  await forget("try:");
  return rec;
}
export const publicTry = (r) => r && { id: r.id, status: r.status, amount: r.amount, lines: r.lines, sent_at: r.sent_at || null, sent_by: r.sent_by || null, pay_url: r.pay_url || null,
  invoice_number: r.invoice_number || null, paid: r.paid || null, created_at: r.created_at };

/** Re-check PayPal invoices; the public refresh is throttled, while the scheduled check must always run. */
export async function syncInvoices(env, pp, url, force = false) {
  const all = await cachedList(env, "inv:");
  const open = all.filter((i) => i.status === "SENT" || i.status === "PARTIALLY_PAID");
  if (!open.length) return { checked: 0, paid: 0, invoices: all.map(publicInvoice) };
  if (!force) {
    const last = Number(await env.LEDGER.get("sync:last")) || 0;
    if (Date.now() - last < 300000) return { checked: 0, paid: 0, recent: true, invoices: all.map(publicInvoice) };
  }
  await env.LEDGER.put("sync:last", String(Date.now()));
  let paid = 0;
  for (const i of open) {
    const invoice = await pp.getInvoice(i.id);
    if (invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID") { await recordInvoicePayment(env, invoice, url); paid++; }
  }
  if (paid) await forget("inv:");
  return { checked: open.length, paid, invoices: (await cachedList(env, "inv:")).map(publicInvoice) };
}

/** Shared daily limit plus a per-visitor one, so a single visitor cannot use up the demo for judges. */
export async function guard(env, request, key, perIp, total) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await quota(env, `${key}:ip:${ip}`, perIp))) return `You reached this demo's limit for ${key} today.`;
  if (!(await quota(env, key, total))) return `The shared daily ${key} limit is reached.`;
  return null;
}

// Agent runs (budget, revenue, chase, send) share one daily cap across all visitors, so public use cannot drain the API
// budget during judging; 120 runs is several times a judging day. AG Studio assistant turns keep their own cap (below).
export const CLAUDE_DAILY = 120;
export async function claudeGuard(env, request, key, perIp, total) {
  const stop = await guard(env, request, key, perIp, total);
  if (stop) return stop;
  return await guard(env, request, "Claude runs", 20, CLAUDE_DAILY);
}

export async function budgetFallback(env) {
  const [run, recommendation] = await Promise.all([env.LEDGER.get("run:owner", "json"), env.LEDGER.get("rec:latest", "json")]);
  return { run, recommendation };
}

export function budgetUnavailable(fallback, status = 503) {
  const run = fallback.run, rec = fallback.recommendation;
  const date = (value) => value ? new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
  const saved = run ? `Latest saved run from ${date(run.at)}: ${run.recommendation?.headline || "budget recommendation"}.`
    : rec ? `Latest checked recommendation from ${date(rec.at)}: ${rec.recommendation?.headline || "budget recommendation"}.`
      : "No earlier run is available.";
  const why = status === 429 ? "Today's limit for live runs from this visitor is reached." : "Claude could not run just now.";
  return json({ error: `${why} ${saved}`, fallback }, status);
}

export async function revenueFallback(env) {
  const run = await env.LEDGER.get("run:revenue", "json");
  return { run, recommendation: await env.LEDGER.get("rec:latest", "json") };
}

export function revenueUnavailable(fallback, status = 503) {
  const run = fallback.run;
  const date = run?.at ? new Date(run.at).toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
  const saved = run ? `Latest saved invoice run from ${date}: ${run.summary} ${run.drafts?.length || 0} saved drafts, ${run.skips?.length || 0} leads skipped.` : "No earlier invoice run is available.";
  // 429 is the daily limit, not a failure: say which, so a judge does not read a cap as a broken agent
  const why = status === 429 ? "Today's limit for live runs from this visitor is reached." : "Claude could not run just now.";
  return json({ error: `${why} ${saved}`, fallback }, status);
}

export async function quota(env, key, limit) {
  const day = new Date().toISOString().slice(0, 10), k = `quota:${key}:${day}`;
  const n = Number(await env.LEDGER.get(k)) || 0;
  if (n >= limit) return false;
  await env.LEDGER.put(k, String(n + 1), { expirationTtl: 172800 });
  return true;
}

export { paypal, ordersSdk, handleMcp, packClick, unpackClick, parseAdCsv, reconcile, metaEvents, googleRows, possibleDuplicates, paybackOdds, disputeState, supportedMoves, runAgent, anthropicLLM, checkRecommendation, runSendAgent, SEND_SYSTEM, SEND_TOOLS, runRefundAgent, REFUND_SYSTEM, REFUND_TOOLS, runPayoutAgent, commissionOrders, PAYOUT_SYSTEM, PAYOUT_TOOLS, parseCsv, runRevenueAgent, REVENUE_SYSTEM, REVENUE_TOOLS, runChaseAgent, eligibleForReminder, CHASE_SYSTEM, CHASE_TOOLS, scenario, grade, PayPalAgentToolkit, adName };
