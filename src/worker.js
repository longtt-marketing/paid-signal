// Paid Signal Worker. Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID),
// PAYPAL_WEBHOOK_ID once the webhook is registered. KV LEDGER holds sandbox captures (no raw email, only its hash).
import { paypal } from "./paypal.js";
import { ordersSdk } from "./paypalSdk.js";
import { handleMcp } from "./mcp.js";
import { packClick, unpackClick, parseAdCsv, reconcile, metaEvents, googleRows, possibleDuplicates, paybackOdds, disputeState, supportedMoves } from "./ledger.js";
// PayPal reports refund times in its own zone (e.g. -07:00); the ledger keeps every time in UTC so they sort at a glance
// the owner request the dashboard sends ("Tell it to raise the ad with the most leads"); /judge replays its latest run
const RULE_SINCE = "2026-10-31T12:00:00.000Z"; // the budget rule as it stands (3+ paid orders, direction after costs and fees)
const OWNER_ASK = "Raise the free guide's budget: it brings the most leads.";
const utc = (t) => { const d = new Date(t || Date.now()); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };
import { runAgent, anthropicLLM, checkRecommendation } from "./agent.js";
import { runSendAgent, SEND_SYSTEM, SEND_TOOLS } from "./sendAgent.js";
import { runRefundAgent, REFUND_SYSTEM, REFUND_TOOLS } from "./refundAgent.js";
import { runPayoutAgent, commissionOrders, PAYOUT_SYSTEM, PAYOUT_TOOLS } from "./payoutAgent.js";
import { parseCsv, runRevenueAgent, REVENUE_SYSTEM, REVENUE_TOOLS } from "./revenue.js";
import { runChaseAgent, eligibleForReminder, CHASE_SYSTEM, CHASE_TOOLS } from "./chaseAgent.js";
import { scenario, grade } from "./scenarios.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { adName } from "../web/src/names.js";

// The demo shop sells one thing; the price is fixed server-side so a page cannot choose what it pays.
const PRODUCT = { sku: "trial-class", name: "Robotics trial class (demo shop)", amount: "49.00", currency: "USD" };
// the demo's ad export: a click for any other ad is kept as "direct", so the ledger cannot be filled with made-up ads
const AD_KEYS = new Set(["trial_video", "free_guide", "parent_carousel", "holiday_static"]);
const CLICK_ID = /^[A-Za-z0-9_-]{1,64}$/;
// tools AG Studio's built-in agents and Paid Signal's own Studio tools send; the Claude proxy serves nothing else
const STUDIO_TOOLS = new Set(["add_page_filter", "add_widget", "add_widget_filter", "clear_plan", "configure_widget", "create_expression", "create_plan",
  "delete_expression", "execute_query", "position_widget", "remove_page_filter", "remove_widget", "remove_widget_filter", "rename_thread", "update_expression",
  "update_plan", "view_page", "view_plan", "view_report", "view_schema", "view_widget", "delegate_to", "complete_task", "read_paid_signal", "list_unpaid_leads",
  "draft_paypal_invoices", "check_paypal_ledger", "submit_budget_recommendation", "who_still_owes", "send_friendly_nudges"]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const VISITOR_COOKIE = "ps_vid";
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function visitorId(request) {
  const cookie = request.headers.get("cookie") || "";
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${VISITOR_COOKIE}=`))?.slice(VISITOR_COOKIE.length + 1);
  return VISITOR_ID.test(value || "") ? value.toLowerCase() : null;
}

function addVisitorCookie(request, id) {
  const headers = new Headers(request.headers);
  const cookies = (headers.get("cookie") || "").split(";").map((part) => part.trim()).filter((part) => part && !part.startsWith(`${VISITOR_COOKIE}=`));
  headers.set("cookie", [...cookies, `${VISITOR_COOKIE}=${id}`].join("; "));
  return new Request(request, { headers });
}

function withVisitorCookie(request, response, id, fresh) {
  const path = new URL(request.url).pathname;
  const isHtmlOrApi = path.startsWith("/api/") || path === "/mcp" || (response.headers.get("content-type") || "").toLowerCase().includes("text/html");
  if (!isHtmlOrApi) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  if (fresh) headers.append("set-cookie", `${VISITOR_COOKIE}=${id}; Max-Age=2592000; Path=/; SameSite=Lax; Secure; HttpOnly`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const publicInvoice = ({ email, psid, lead_id, ...invoice }) => invoice;
const publicLead = ({ email, psid, lead_id, ...lead }) => lead;
const publicMeta = ({ events, ...meta }) => ({ ...meta, events: events.map((e) => ({ ...e, user_data: {
  ...e.user_data,
  ...(e.user_data.em ? { em: ["(SHA-256 of the payer's email; sent to Meta, not shown here)"] } : {}),
  ...(e.user_data.page_scoped_user_id ? { page_scoped_user_id: "(Messenger PSID; sent to Meta, kept server-side)" } : {}),
  ...(e.user_data.lead_id ? { lead_id: "(Meta lead ID; sent to Meta, kept server-side)" } : {}),
} })) });

// KV list calls are the scarce resource: the ledger is read through a 20-second edge cache, cleared on every write here
const cacheKey = (prefix) => new Request(`https://ledger.paid-signal.internal/${prefix}`);
async function cachedList(env, prefix) {
  const cache = globalThis.caches?.default;
  const hit = cache && (await cache.match(cacheKey(prefix)));
  if (hit) return hit.json();
  const out = await listPrefix(env, prefix);
  if (cache) await cache.put(cacheKey(prefix), new Response(JSON.stringify(out), { headers: { "cache-control": "max-age=120" } }));
  return out;
}
const forget = async (prefix) => { await globalThis.caches?.default?.delete(cacheKey(prefix)); };

/** Keep the latest gate-checked budget recommendation; the owner's decisions refer to it by id. */
async function saveRecommendation(env, recommendation, source, visitor, shared = false) {
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
async function revenueDrafts(env, url) {
  const t0 = Date.now();
  const invoices = await listPrefix(env, "inv:");
  const leads = (await demoLeads(env, url)).filter((l) => !invoices.some((i) => i.lead === l.lead && i.status === "PAID"));
  const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: REVENUE_SYSTEM, tools: REVENUE_TOOLS });
  const toolkit = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
    configuration: { actions: { invoices: { create: true } }, context: { sandbox: true } } }).getTools();
  const drafts = [];
  // the agent's own create_invoice call runs this once code has priced and checked it: price list, the lead's own email
  const createDraft = async (p) => {
    const lead = leads.find((l) => l.lead === p.lead);
    const params = { currency_code: "USD", reference: "Kite Robotics booking", note: p.note, invoicer_business_name: "Kite Robotics Club (demo)",
      primary_recipients: [{ billing_info: { email_address: lead.email, name: { given_name: lead.lead.replace(/ \(.*\)$/, "") } } }],
      items: p.lines.map((l) => ({ name: l.name, quantity: "1", unit_amount: { currency_code: "USD", value: l.unit } })) };
    let out = {}; try { out = JSON.parse(String(await toolkit.create_invoice.execute(params))); } catch {}
    const id = out.id || String(out.href || out.links?.[0]?.href || "").split("/").pop();
    if (!/^INV2-[A-Z0-9-]+$/.test(id)) return { error: "PayPal returned no invoice id" };
    const rec = { id, lead: lead.lead, ad: lead.ad, email: lead.email, channel: lead.channel || "web", psid: lead.psid || null, page_id: lead.page_id || null, lead_id: lead.lead_id || null,
      amount: p.total, lines: p.lines, status: "DRAFT",
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
async function applyDispute(env, d) {
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
async function syncDisputes(env) {
  const tk = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
    configuration: { actions: { disputes: { list: true, get: true } }, context: { sandbox: true } } }).getTools();
  const parse = (x) => { try { return typeof x === "string" ? JSON.parse(x) : x || {}; } catch { return {}; } };
  const list = parse(await tk.list_disputes.execute({ page_size: 50 })).items || [];
  const marked = [];
  for (const item of list.slice(0, 20)) marked.push(...(await applyDispute(env, parse(await tk.get_dispute.execute({ dispute_id: item.dispute_id })))));
  return { checked_at: new Date().toISOString(), disputes: list.length, open: list.filter((x) => x.status !== "RESOLVED").length, ledger_payments_marked: marked };
}

async function listPayments(env) {
  return (await cachedList(env, "pay:")).sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
}

/** Store what the capture proves: amount, status, the click that led to it. The payer email is kept only as a hash. */
async function recordCapture(env, order, userAgent) {
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
  // a replayed capture must not wipe refunds already recorded against it
  const prev = await env.LEDGER.get(`pay:${cap.id}`, "json");
  if (prev) { record.user_agent ??= prev.user_agent; record.fee ??= prev.fee ?? null; record.refunded_amount = prev.refunded_amount; record.status = prev.status; if (prev.refunded_at) record.refunded_at = prev.refunded_at; }
  await env.LEDGER.put(`pay:${cap.id}`, JSON.stringify(record)); await forget("pay:");
  return record;
}

/**
 * The moment PayPal confirms a payment, its Purchase event goes to the shop's Meta dataset. In this demo the dataset is a
 * test one (test_event_code), so Events Manager shows the event live and it never counts toward real ads. Meta's answer
 * is kept with the payment so the dashboard and the receipt can show it. A held capture (duplicate, no click) is not sent.
 */
async function sendToMeta(env, url, record) {
  if (!record || !env.META_CAPI_TOKEN || !env.META_DATASET_ID) return null;
  const sent = await env.LEDGER.get(`meta:${record.capture_id}`, "json");
  if (sent && (sent.ok || sent.held)) return sent; // a send that failed (Meta timed out) is tried again
  const payments = await listPayments(env);
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

async function applyRefund(env, captureId, refundedValue, when) {
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
async function firstPaint(env, url, page) {
  try {
    const csv = await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text();
    const payments = await listPayments(env);
    const t = reconcile(parseAdCsv(csv).rows, payments).totals;
    const metaCount = (await metaFromLedger(payments, `${url.origin}/shop.html`)).events.length;
    // the same markup and classes the app renders, so the page reads at once and nothing jumps when React takes over
    const html = `<div class="app"><header class="top"><div class="top-in"><a class="brand" href="/"><span class="mark"><i></i></span>Paid Signal</a></div></header>`
      + `<main class="desk"><section class="hero"><div class="hero-copy"><h1 class="sr">Ads report ${t.leads} leads. PayPal confirms ${t.paid} paid ${t.paid === 1 ? "order" : "orders"}.</h1><p class="kicker">Kite Robotics Club · demo ad export · PayPal sandbox</p>`
      + `<div class="duo"><div><b class="n claimed">${t.leads}</b><span>leads the ads report</span></div><div><b class="n paid">${t.paid}</b><span>paid ${t.paid === 1 ? "order" : "orders"} PayPal confirms</span></div></div>`
      + `<p class="pitch">Ad platforms learn from the ${t.leads} leads. PayPal confirms ${t.paid} paid ${t.paid === 1 ? "order" : "orders"}: the ${metaCount} from Meta ads go back to Meta (test events in this demo); the Google ones become an offline-conversion file for Google Ads.</p><div class="hero-actions"><a class="cta" href="/judge">Judge path, 60 s</a><a class="hero-link" href="/audit">Audit your own ads</a></div></div>`
      + `<div class="hero-bars"><p class="ghost">Loading the ledger…</p></div></section></main></div>`;
    return new HTMLRewriter().on("#root", { element(e) { e.setInnerContent(html, { html: true }); } }).transform(page);
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
  }
  return out;
}

// The dashboard page: only this site's scripts, PayPal and Google Fonts; never framed by another site.
const PAGE_CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:", "connect-src 'self'", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join("; ");
function withPageHeaders(res) {
  const out = new Response(res.body, res);
  out.headers.set("content-security-policy", PAGE_CSP);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  out.headers.set("cache-control", "no-store");
  return out;
}

// MCP tools reuse the Worker's own read-only routes, so an MCP client sees exactly what the dashboard shows
async function mcpTool(env, url, name, args) {
  const get = async (path, body) => (await app.fetch(new Request(url.origin + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), env)).json();
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
const heldDuplicates = (payments) => new Set(possibleDuplicates(payments).map((d) => d.capture_id));
// payments captured before this are the seeded demo ledger; refunds on them are previewed, not sent
const SEEDED_BEFORE = "2026-10-29T09:00:00Z";
// The creator program: the parent in the testimonial carousel is paid per PayPal-confirmed paid order from that ad, not per
// lead. In the sandbox a PayPal test account (payer id below) stands in for the creator.
const CREATOR = { ad: "parent_carousel", creator: "the parent who made the testimonial (fictional; a PayPal sandbox account stands in)", rate: "5.00", receiver: "TEBYBGHQP8TSW" };
async function commissionState(env) {
  const [payments, paid] = await Promise.all([listPayments(env), cachedList(env, "commission:")]);
  const paidOut = Object.fromEntries(paid.flatMap((b) => (b.capture_ids || []).map((id) => [id, b.batch_id])));
  const orders = commissionOrders(payments, CREATOR, heldDuplicates(payments), paidOut, disputeState);
  // a refund or a lost dispute after the payout: the commission on it is owed back (shown, not clawed back automatically)
  const owedBack = paid.flatMap((b) => (b.capture_ids || []).filter((id) => { const p = payments.find((x) => x.capture_id === id); return p && (Number(p.refunded_amount || 0) >= Number(p.amount) || disputeState(p) === "lost"); }));
  return { orders, batches: paid.sort((a, b) => String(b.at).localeCompare(String(a.at))), owed_back: owedBack };
}

// metaEvents hashes the email itself; here only the stored hash exists, so pass it through as an already-hashed field.
async function metaFromLedger(payments, sourceUrl) {
  return metaEvents(payments.map((p) => ({ ...p, payer_email: null })), { sourceUrl, hold: heldDuplicates(payments) });
}

async function listPrefix(env, prefix) {
  const out = []; let cursor;
  do {
    const page = await env.LEDGER.list({ prefix, cursor });
    for (const k of page.keys) { const v = await env.LEDGER.get(k.name, "json"); if (v) out.push(v); }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function demoLeads(env, url) {
  return parseCsv(await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-leads.csv`))).text());
}

/** An invoice paid through PayPal becomes a capture in the ledger, attributed by the click packed in its reference. */
async function recordInvoicePayment(env, invoice, url = new URL("https://paid-signal.thelongmarketing.workers.dev/")) {
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
    }));
    // An invoice payment teaches Meta too, the moment PayPal says it is paid.
    await sendToMeta(env, url, await env.LEDGER.get(`pay:${id}`, "json"));
  }
  const rec = await env.LEDGER.get(`inv:${invoice.id}`, "json");
  if (rec) { rec.status = invoice.status || "PAID"; rec.paid_at = learnedAt; rec.payment_seen_at = learnedAt; await env.LEDGER.put(`inv:${invoice.id}`, JSON.stringify(rec)); }
  await forget("pay:"); await forget("inv:");
}

/** A judge's try invoice that PayPal reports paid: kept on the try record (the judge's session), not in the shop's ledger. */
async function tryPaid(env, invoice) {
  const rec = await env.LEDGER.get(`try:${invoice.id}`, "json");
  if (!rec) return null;
  const t = (invoice.payments?.transactions || [])[0];
  rec.status = invoice.status || rec.status;
  if (t && !rec.paid) rec.paid = { payment_id: t.payment_id || null, amount: t.amount?.value || rec.amount, currency: t.amount?.currency_code || "USD",
    paypal_payment_date: t.payment_date_time || t.payment_date || null, method: t.method || null, seen_at: new Date().toISOString() };
  await env.LEDGER.put(`try:${invoice.id}`, JSON.stringify(rec), { expirationTtl: 60 * 86400 });
  return rec;
}
const publicTry = (r) => r && { id: r.id, status: r.status, amount: r.amount, lines: r.lines, sent_at: r.sent_at || null, sent_by: r.sent_by || null, pay_url: r.pay_url || null,
  invoice_number: r.invoice_number || null, paid: r.paid || null, created_at: r.created_at };

/** Re-check PayPal invoices; the public refresh is throttled, while the scheduled check must always run. */
async function syncInvoices(env, pp, url, force = false) {
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
async function guard(env, request, key, perIp, total) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await quota(env, `${key}:ip:${ip}`, perIp))) return `You reached this demo's limit for ${key} today.`;
  if (!(await quota(env, key, total))) return `The shared daily ${key} limit is reached.`;
  return null;
}

// Agent runs (budget, revenue, chase, send) share one daily cap across all visitors, so public use cannot drain the API
// budget during judging; 120 runs is several times a judging day. AG Studio assistant turns keep their own cap (below).
const CLAUDE_DAILY = 120;
async function claudeGuard(env, request, key, perIp, total) {
  const stop = await guard(env, request, key, perIp, total);
  if (stop) return stop;
  return await guard(env, request, "Claude runs", 20, CLAUDE_DAILY);
}

async function budgetFallback(env) {
  const [run, recommendation] = await Promise.all([env.LEDGER.get("run:owner", "json"), env.LEDGER.get("rec:latest", "json")]);
  return { run, recommendation };
}

function budgetUnavailable(fallback, status = 503) {
  const run = fallback.run, rec = fallback.recommendation;
  const date = (value) => value ? new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
  const saved = run ? `Latest saved run from ${date(run.at)}: ${run.recommendation?.headline || "budget recommendation"}.`
    : rec ? `Latest checked recommendation from ${date(rec.at)}: ${rec.recommendation?.headline || "budget recommendation"}.`
      : "No earlier run is available.";
  const why = status === 429 ? "Today's limit for live runs from this visitor is reached." : "Claude could not run just now.";
  return json({ error: `${why} ${saved}`, fallback }, status);
}

async function revenueFallback(env) {
  const run = await env.LEDGER.get("run:revenue", "json");
  return { run, recommendation: await env.LEDGER.get("rec:latest", "json") };
}

function revenueUnavailable(fallback, status = 503) {
  const run = fallback.run;
  const date = run?.at ? new Date(run.at).toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
  const saved = run ? `Latest saved invoice run from ${date}: ${run.summary} ${run.drafts?.length || 0} saved drafts, ${run.skips?.length || 0} leads skipped.` : "No earlier invoice run is available.";
  // 429 is the daily limit, not a failure: say which, so a judge does not read a cap as a broken agent
  const why = status === 429 ? "Today's limit for live runs from this visitor is reached." : "Claude could not run just now.";
  return json({ error: `${why} ${saved}`, fallback }, status);
}

async function quota(env, key, limit) {
  const day = new Date().toISOString().slice(0, 10), k = `quota:${key}:${day}`;
  const n = Number(await env.LEDGER.get(k)) || 0;
  if (n >= limit) return false;
  await env.LEDGER.put(k, String(n + 1), { expirationTtl: 172800 });
  return true;
}

const app = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pp = paypal({ clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET });
    // order create/read and refunds go through PayPal's APIMatic-generated server SDK; the rest uses the small REST client
    const orders = ordersSdk({ clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET });
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    // every write is JSON from this site (a cross-site form or text/plain post is refused), and bursts are slowed per visitor
    if (request.method === "POST" && (url.pathname.startsWith("/api/") || url.pathname === "/mcp") && url.pathname !== "/api/webhook") {
      if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json({ error: "Send JSON." }, 415);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin && url.pathname !== "/mcp") return json({ error: "Cross-site requests are not accepted." }, 403);
      // the routes that spend Claude turns answer only this site's own pages, which always send their Origin
      if ((url.pathname === "/api/ai/turn" || url.pathname.startsWith("/api/agent") || url.pathname === "/api/judge/try" || url.pathname === "/api/invoices/approve" || url.pathname === "/api/refund" || url.pathname === "/api/duplicates/refund" || url.pathname === "/api/commissions/pay" || url.pathname === "/api/judge/try/send" || url.pathname === "/api/judge/refund-try" || url.pathname === "/api/decisions") && origin !== url.origin)
        return json({ error: "Only the Paid Signal page can call this." }, 403);
      if (env.BURST && !(await env.BURST.limit({ key: ip })).success) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
    }
    try {
      if (url.pathname === "/api/config") return json({ paypal_client_id: env.PAYPAL_CLIENT_ID, product: PRODUCT, environment: "sandbox", ag_studio_license: env.AG_STUDIO_LICENSE || null });

      if (url.pathname === "/api/checkout" && request.method === "POST") {
        const b = await request.json();
        const stop = await guard(env, request, "checkouts", 20, 400); if (stop) return json({ error: stop }, 429);
        const clickOk = AD_KEYS.has(b.ad) && CLICK_ID.test(String(b.click_id || ""));
        const source = clickOk && ["fb", "g"].includes(b.source) ? b.source : "other";
        const customId = packClick({ ad: clickOk ? b.ad : "direct", source, clickId: clickOk ? b.click_id : "", clickedAt: clickOk ? Number(b.clicked_at) || 0 : 0 });
        // one checkout intent per visit: a second click on Pay gets the same PayPal order back, so it cannot be charged twice
        const intent = typeof b.intent === "string" && /^[a-z0-9-]{8,40}$/.test(b.intent) ? b.intent : crypto.randomUUID();
        const order = await orders.createOrder({
          amount: PRODUCT.amount, currency: PRODUCT.currency, description: PRODUCT.name, customId,
          invoiceId: `PS-${intent.replace(/-/g, "").slice(0, 16)}`, returnUrl: `${url.origin}/shop.html?done=1`, cancelUrl: `${url.origin}/shop.html`,
          requestId: `chk-${intent}`,
        });
        return json({ id: order.id, custom_id: customId, approve_url: (order.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve")?.href });
      }

      if (url.pathname === "/api/capture" && request.method === "POST") {
        const { order_id } = await request.json();
        if (!/^[A-Z0-9]{10,24}$/.test(String(order_id))) return json({ error: "Bad order id." }, 400);
        let order = await orders.captureOrder(order_id, `cap-${order_id}`);
        let record = await recordCapture(env, order, request.headers.get("user-agent"));
        // a 2xx whose body lacked the capture (the SDK's schema check failed on it) is read back from PayPal before recording
        if (!record) { order = await orders.getOrder(order_id); record = await recordCapture(env, order, request.headers.get("user-agent")); }
        const meta = await sendToMeta(env, url, record);
        return json({ status: order.status, payment: record, meta });
      }

      if (url.pathname === "/api/refund" && request.method === "POST") {
        const { capture_id, amount } = await request.json();
        const cur = await env.LEDGER.get(`pay:${capture_id}`, "json");
        if (!cur) return json({ error: "Unknown capture." }, 404);
        const left = (Math.round(Number(cur.amount) * 100) - Math.round(Number(cur.refunded_amount || 0) * 100)) / 100;
        if (amount !== undefined && !(Number(amount) > 0 && Number(amount) <= left)) return json({ error: `Refund between $0.01 and $${left.toFixed(2)}.` }, 400);
        // the seeded demo payments carry the scenarios page and the dashboard story through judging: preview, don't send
        const partial = amount !== undefined && Number(amount) < left;
        if (String(cur.captured_at) < SEEDED_BEFORE) return json({ preview: true, message: `Capture ${capture_id} is one of the demo's seeded sandbox payments, so this refund is only previewed: its ad would lose $${amount ?? left} of paid revenue, and ${partial ? (cur.source === "g" ? "its Google row would become a restatement" : "its paid revenue would drop here; a Meta event already sent keeps its value, as Meta's Conversions API has no retraction") : (cur.source === "g" ? "its Google row would become a retraction" : "its Meta event would be held back if not yet sent; one already sent stays, as Meta's Conversions API has no retraction")}. To run a real sandbox refund, pay in the demo shop and refund that payment.` });
        const stop = await guard(env, request, "refunds", 3, 30); if (stop) return json({ error: stop }, 429);
        // the same refund retried (double click, network retry) carries the same request id, so PayPal applies it once
        const refundKey = `refund-${capture_id}-${amount === undefined ? "full" : Number(amount).toFixed(2)}-${cur.refunded_amount || "0.00"}`;
        const r = await orders.refundCapture(capture_id, { amount: amount === undefined ? undefined : Number(amount).toFixed(2), requestId: refundKey });
        // mark the refund as applied first, so PayPal's PAYMENT.CAPTURE.REFUNDED webhook for it is not counted again
        await env.LEDGER.put(`seen:${r.id}`, "1");
        const rec = await applyRefund(env, capture_id, r.amount?.value || amount, r.create_time);
        return json({ refund: { id: r.id, status: r.status, amount: r.amount?.value }, payment: rec });
      }

      // PayPal pushes capture and refund events here; nothing is trusted until PayPal verifies the signature.
      if (url.pathname === "/api/webhook" && request.method === "POST") {
        const certUrl = request.headers.get("paypal-cert-url") || "";
        let certHost = ""; try { certHost = new URL(certUrl).hostname; } catch {}
        if (!request.headers.get("paypal-transmission-id") || !/(^|\.)paypal\.com$/.test(certHost)) return json({ error: "unverified" }, 401);
        const event = await request.json();
        if (!env.PAYPAL_WEBHOOK_ID || !(await pp.verifyWebhook({ headers: request.headers, event, webhookId: env.PAYPAL_WEBHOOK_ID }))) return json({ error: "unverified" }, 401);
        const res = event.resource || {};
        if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
          const known = await env.LEDGER.get(`pay:${res.id}`, "json");
          const orderId = res.supplementary_data?.related_ids?.order_id;
          // already recorded at capture: only make sure Meta got it (the capture call may have timed out on Meta)
          if (known) await sendToMeta(env, url, known);
          else if (orderId) await sendToMeta(env, url, await recordCapture(env, await orders.getOrder(orderId)));
        }
        if (event.event_type === "INVOICING.INVOICE.PAID" && res.id) {
          // a judge's own try invoice is kept in the judge's session record, never in the shop's ledger
          if (await env.LEDGER.get(`try:${res.id}`)) await tryPaid(env, await pp.getInvoice(res.id));
          else await recordInvoicePayment(env, await pp.getInvoice(res.id), url);
        }
        // a buyer's dispute takes the payment out of paid orders (and out of what the ad platforms are told) while it is open
        if (/^CUSTOMER\.DISPUTE\./.test(event.event_type)) await applyDispute(env, res);
        if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
          const captureId = (res.links || []).find((l) => l.rel === "up")?.href?.split("/").pop();
          if (captureId) {
            const known = await env.LEDGER.get(`seen:${res.id}`);
            if (!known) { await applyRefund(env, captureId, res.amount?.value, res.create_time); await env.LEDGER.put(`seen:${res.id}`, "1"); }
          }
        }
        await env.LEDGER.put(`hook:${Date.now()}:${event.id}`, JSON.stringify({ type: event.event_type, at: new Date().toISOString() }), { expirationTtl: 1209600 });
        return json({ ok: true });
      }

      // The money trail of one payment: the ad click, what PayPal itself says about the capture (read now, not from the
      // ledger), what Meta answered, and what the payment changes for its ad. Defaults to the payment Meta got at capture.
      if (url.pathname === "/api/trail") {
        const [payments, metas] = await Promise.all([listPayments(env), cachedList(env, "meta:")]);
        const metaBy = Object.fromEntries(metas.map((m) => [m.capture_id, m]));
        const want = url.searchParams.get("capture");
        if (want && !payments.some((x) => x.capture_id === want)) return json({ error: `No payment ${want.slice(0, 40)} in the ledger.` }, 404);
        const p = payments.find((x) => x.capture_id === want) || payments.find((x) => metaBy[x.capture_id]?.ok && !metaBy[x.capture_id]?.backfill) || payments.at(-1);
        if (!p) return json({ error: "No payments yet." }, 404);
        let paypal = await env.LEDGER.get(`trailpp:${p.capture_id}`, "json");
        if (!paypal) {
          try {
            if (p.via === "invoice") {
              const inv = await pp.getInvoice(p.order_id);
              paypal = { read: "Invoicing v2: GET /v2/invoicing/invoices/{id}", status: inv.status, amount: inv.amount?.value, currency: inv.amount?.currency_code, invoice_id: inv.id,
                paid_at: inv.payments?.transactions?.[0]?.payment_date || null, payment_id: inv.payments?.transactions?.[0]?.payment_id || null };
            } else {
              const c = await orders.getCapture(p.capture_id), b = c.seller_receivable_breakdown || {};
              paypal = { read: "Payments v2: GET /v2/payments/captures/{id}, through the server SDK", status: c.status, amount: c.amount?.value, currency: c.amount?.currency_code,
                create_time: c.create_time, custom_id: c.custom_id || null, final_capture: c.final_capture ?? null,
                fee: b.paypal_fee?.value || null, net: b.net_amount?.value || null, refunded: b.total_refunded_amount?.value || null };
              // a capture does not carry its refunds; the ledger has them from PayPal's signature-verified refund webhooks
              if (!paypal.refunded && Number(p.refunded_amount) > 0) { paypal.refunded = p.refunded_amount; paypal.refunded_from = "PayPal refund webhooks (ledger)"; }
            }
            paypal.read_at = new Date().toISOString();
            await env.LEDGER.put(`trailpp:${p.capture_id}`, JSON.stringify(paypal), { expirationTtl: 600 }); // PayPal is asked at most every 10 minutes
          } catch (e) { paypal = { error: String(e?.message || e).slice(0, 200) }; }
        }
        const csv = await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text();
        const rec = reconcile(parseAdCsv(csv).rows, payments);
        const row = rec.ads.find((a) => a.ad === p.ad), odds = paybackOdds(rec).ads[p.ad], move = supportedMoves(rec)[p.ad];
        const m = metaBy[p.capture_id] || null, held = heldDuplicates(payments).has(p.capture_id);
        const secs = (a, b) => (a && b ? Math.round((b - a) / 100) / 10 : null);
        return json({
          payment: { capture_id: p.capture_id, order_id: p.order_id, amount: p.amount, currency: p.currency, captured_at: p.captured_at, via: p.via || "checkout", channel: p.channel || "web",
            status: p.status, refunded_amount: p.refunded_amount || "0.00", refunded_at: p.refunded_at ? utc(p.refunded_at) : null, refunded_by: p.refunded_by || null, refund_id: p.refund_id || null, dispute: p.dispute || null, dispute_state: disputeState(p), held_as_duplicate: held },
          click: { ad: p.ad || null, ad_name: p.ad ? adName(p.ad) : null, source: p.source || null, click_id: p.click_id || null, clicked_at: p.clicked_at || null },
          paypal,
          meta: m && { ok: Boolean(m.ok), held: m.held || null, event_id: m.event_id || null, value: m.value ?? null, events_received: m.events_received ?? null, fbtrace_id: m.fbtrace_id || null,
            test_event: m.test_event ?? null, backfill: Boolean(m.backfill), superseded: m.ok && p.source === "g", error: m.error || null, at: m.at || null },
          timings: { click_to_capture_s: p.clicked_at ? secs(p.clicked_at, Date.parse(p.captured_at)) : null,
            capture_to_meta_s: m?.ok && !m.backfill ? secs(Date.parse(p.captured_at), Date.parse(m.at)) : null },
          ad_row: row && { leads: row.leads, paid_orders: row.paid, spend: (row.spend_cents / 100).toFixed(2), paid_revenue: (row.revenue_cents / 100).toFixed(2),
            per_dollar: row.spend_cents ? (row.revenue_cents / row.spend_cents).toFixed(2) : null, chance_covers_spend: odds ? Math.round(odds.chance_covers_spend * 100) : null,
            cut_after: odds?.more_spend_to_decide_cents != null ? (odds.more_spend_to_decide_cents / 100).toFixed(2) : null, move: move ? { increase: move.increase, reduce: move.reduce, why: move.why } : null },
          payments: payments.map((x) => ({ capture_id: x.capture_id, ad_name: x.ad ? adName(x.ad) : "No ad click", amount: x.amount, captured_at: x.captured_at, via: x.via || "checkout",
            meta: metaBy[x.capture_id]?.ok ? (x.source === "g" ? "Google click, sent in backfill before the Google-only rule; not counted" : metaBy[x.capture_id].backfill ? "sent in backfill" : "sent at capture") : metaBy[x.capture_id]?.held ? `held (${metaBy[x.capture_id].held})` : "not sent" })),
        });
      }

      if (url.pathname === "/api/ledger") {
        const [payments, meta] = await Promise.all([listPayments(env), cachedList(env, "meta:")]);
        // the payer's email hash stays on the server (duplicate check, Meta match); the public ledger gets a salted key that
        // only says "same payer" and cannot be checked against a guessed email
        const keyed = await Promise.all(payments.map(async ({ payer_email_sha256, user_agent, psid, lead_id, ...p }) => ({ ...p, ...(p.refunded_at ? { refunded_at: utc(p.refunded_at) } : {}), clicked_at: p.clicked_at || null, payer_key: payer_email_sha256 ? (await sha(`${env.PAYPAL_CLIENT_SECRET}:${payer_email_sha256}`)).slice(0, 12) : null })));
        // a Google-click buyer sent to Meta before Google buyers were routed to Google only: still a fact, no longer counted
        const source = Object.fromEntries(payments.map((p) => [p.capture_id, p.source]));
        const sends = meta.map((m) => (m.ok && source[m.capture_id] === "g" ? { ...m, superseded: "Google click, sent before Google buyers went to Google only" } : m));
        return json({ payments: keyed,
          duplicates: possibleDuplicates(payments), meta: sends, meta_live: Boolean(env.META_CAPI_TOKEN && env.META_DATASET_ID) });
      }

      // Leads the ad export counted but PayPal never saw pay. The agent may draft invoices for them; a person sends.
      // the email stays on the server (the invoice goes to it); the public list shows who wrote what, not where
      if (url.pathname === "/api/leads") return json({ leads: (await demoLeads(env, url)).map(publicLead) });
      if (url.pathname === "/data/demo-leads.csv") return json({ error: "Not found" }, 404); // read only through ASSETS, above

      // the recipient's email stays on the server (PayPal sends to it); the public list shows who, not where
      if (url.pathname === "/api/invoices" && request.method === "GET") return json({ invoices: (await cachedList(env, "inv:")).map(publicInvoice) });

      // Webhooks are the main path, but the sandbox does not always emit INVOICING.INVOICE.PAID: ask PayPal about every
      // sent invoice and record the ones it says are paid (recordInvoicePayment is idempotent per payment id).
      if (url.pathname === "/api/invoices/sync" && request.method === "POST") {
        return json(await syncInvoices(env, pp, url));
      }

      // The revenue agent reads what each unpaid lead wrote and proposes invoices; code prices and checks every proposal,
      // and PayPal's Agent Toolkit creates the drafts. Nothing is sent: each draft waits in Approvals.
      // The judge becomes the customer: the judge approves the draft Claude just made, the send agent sends it through the
      // Agent Toolkit, and the judge pays it on PayPal's own invoice page as the sandbox buyer. Only drafts from this browser.
      if (url.pathname === "/api/judge/try/send" && request.method === "POST") {
        let body; try { body = await request.json(); } catch { return json({ error: "Send the invoice id as JSON." }, 400); }
        const rec = /^INV2-[A-Z0-9-]+$/.test(String(body.invoice_id || "")) ? await env.LEDGER.get(`try:${body.invoice_id}`, "json") : null;
        if (!rec || !rec.vid || rec.vid !== visitorId(request)) return json({ error: "Only an invoice Claude drafted for you in this browser can be sent." }, 404);
        if (rec.status !== "DRAFT") return json({ invoice: publicTry(rec) });
        if (!(Number(rec.amount) > 0 && Number(rec.amount) <= 200)) return json({ error: "Only small demo invoices are sent." }, 400);
        const stop = await claudeGuard(env, request, "judge sends", 3, 60); if (stop) return json({ error: stop }, 429);
        const tools = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
          configuration: { actions: { invoices: { get: true, send: true } }, context: { sandbox: true } } }).getTools();
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: SEND_SYSTEM, tools: SEND_TOOLS });
        let agent;
        try { agent = await runSendAgent({ llm, tools, approved: { id: rec.id, lead: "the judge (as a customer)", ad: rec.ad, amount: String(rec.amount) } }); }
        catch (e) { return json({ error: `The send agent could not run: ${String(e?.message || e).slice(0, 200)}` }, 502); }
        const fresh = await pp.getInvoice(rec.id);
        Object.assign(rec, { status: fresh.status, invoice_number: fresh.detail?.invoice_number || null, pay_url: fresh.detail?.metadata?.recipient_view_url || null,
          ...(agent.sent && fresh.status && fresh.status !== "DRAFT" ? { sent_at: new Date().toISOString(), sent_by: "send agent (Claude + PayPal Agent Toolkit)" } : {}) });
        await env.LEDGER.put(`try:${rec.id}`, JSON.stringify(rec), { expirationTtl: 60 * 86400 });
        return json({ invoice: publicTry(rec), agent: { summary: agent.summary, trace: agent.trace } });
      }

      // The judge's invoice as PayPal reports it now: read live until it is paid.
      if (url.pathname === "/api/judge/try/status") {
        const id = url.searchParams.get("id") || "";
        let rec = /^INV2-[A-Z0-9-]+$/.test(id) ? await env.LEDGER.get(`try:${id}`, "json") : null;
        if (!rec || rec.vid !== visitorId(request)) return json({ error: "Unknown invoice for this browser." }, 404);
        if (rec.status !== "PAID" && rec.status !== "DRAFT") { try { rec = (await tryPaid(env, await pp.getInvoice(id))) || rec; } catch {} }
        return json({ invoice: publicTry(rec), checked_at: new Date().toISOString() });
      }

      if (url.pathname === "/api/judge/try" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Send a message as JSON." }, 400); }
        if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 500) return json({ error: "Enter a message of 1 to 500 characters." }, 400);
        const stop = await claudeGuard(env, request, "judge try runs", 3, CLAUDE_DAILY);
        if (stop) return revenueUnavailable(await revenueFallback(env), 429);
        const t0 = Date.now(), lead = { lead: "Judge lead", ad: "parent_carousel", source: "other", click_id: "", channel: "web", email: "judge-lead@example.com", message: body.message.trim() };
        try {
          const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: REVENUE_SYSTEM, tools: REVENUE_TOOLS });
          const toolkit = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
            configuration: { actions: { invoices: { create: true } }, context: { sandbox: true } } }).getTools();
          const createDraft = async (p) => {
            const params = { currency_code: "USD", reference: "Kite Robotics booking", note: p.note, invoicer_business_name: "Kite Robotics Club (demo)",
              primary_recipients: [{ billing_info: { email_address: lead.email, name: { given_name: lead.lead } } }],
              items: p.lines.map((l) => ({ name: l.name, quantity: "1", unit_amount: { currency_code: "USD", value: l.unit } })) };
            let out = {}; try { out = JSON.parse(String(await toolkit.create_invoice.execute(params))); } catch {}
            const id = out.id || String(out.href || out.links?.[0]?.href || "").split("/").pop();
            if (!/^INV2-[A-Z0-9-]+$/.test(id)) return { error: "PayPal returned no invoice id" };
            await env.LEDGER.put(`try:${id}`, JSON.stringify({ id, vid: visitorId(request), lead: lead.lead, ad: lead.ad, email: lead.email, channel: lead.channel,
              amount: p.total, lines: p.lines, note: p.note, reason: p.reason, status: "DRAFT", drafted_by: "revenue agent (Claude) via PayPal Agent Toolkit", created_at: new Date().toISOString() }));
            return { id };
          };
          const run = await runRevenueAgent({ llm, leads: [lead], invoices: [], createDraft });
          const draft = run.proposals[0], skipped = run.skips[0];
          const trace = run.trace.map((s) => ({ ...s, called_by: s.tool === "read_leads" || s.tool === "create_invoice" || s.tool === "skip_lead" ? "Claude" : "code",
            ...(s.tool === "create_invoice" ? { price_set_by: "code" } : {}) }));
          let paypalRecord = null;
          if (draft?.id) {
            try {
              const invoice = await pp.getInvoice(draft.id);
              paypalRecord = { status: invoice.status || null, invoice_number: invoice.detail?.invoice_number ?? invoice.invoice_number ?? null,
                total_amount: invoice.amount?.value ?? null, currency: invoice.amount?.currency_code ?? invoice.detail?.currency_code ?? null,
                line_items: Array.isArray(invoice.items) ? invoice.items : [], read_at: new Date().toISOString() };
            } catch {
              paypalRecord = { error: "Could not read the draft back from PayPal.", read_at: new Date().toISOString() };
            }
          }
          return json({ decision: draft?.id ? "drafted" : "skipped", reason: draft?.reason || skipped?.reason || run.refusals[0]?.problems?.join(" ") || "The agent did not propose a draft.",
            flag: skipped?.flag || null, invoice_id: draft?.id || null, amount: draft?.id ? draft.total : null, line_items: draft?.id ? draft.lines : [], paypal: paypalRecord, trace, ms: Date.now() - t0 });
        } catch { console.warn("judge try revenue agent failed"); return revenueUnavailable(await revenueFallback(env), 502); }
      }

      if (url.pathname === "/api/agent/revenue" && request.method === "POST") {
        const stop = await claudeGuard(env, request, "revenue agent runs", 4, 40);
        if (stop) return revenueUnavailable(await revenueFallback(env), 429);
        let out;
        try { out = await revenueDrafts(env, url); }
        catch { console.warn("revenue agent failed"); return revenueUnavailable(await revenueFallback(env), 502); }
        // the judge path replays the latest run: who was skipped and why, the injection refusal; no emails
        const safe = { ...out, drafts: out.drafts.map(publicInvoice) };
        await env.LEDGER.put("run:revenue", JSON.stringify({ at: new Date().toISOString(), skips: out.skips, refusals: out.refusals, summary: out.summary, trace: out.trace, ms: out.ms,
          drafts: out.drafts.map(publicInvoice) }));
        return json(safe);
      }

      // Sent invoices nobody has paid: the chase agent reads each with the Agent Toolkit, chooses whom to remind and writes
      // the note; code allows only eligible invoices, at most 3 reminders, and no amount but the invoice's own.
      if (url.pathname === "/api/agent/chase" && request.method === "POST") {
        const stop = await claudeGuard(env, request, "chase agent runs", 3, 20); if (stop) return json({ error: stop }, 429);
        const t0 = Date.now();
        const eligible = eligibleForReminder(await listPrefix(env, "inv:"));
        if (!eligible.length) return json({ reminded: [], summary: "No sent invoice is waiting long enough for a reminder.", trace: [], eligible: 0, ms: 0 });
        const tools = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
          configuration: { actions: { invoices: { get: true, sendReminder: true } }, context: { sandbox: true } } }).getTools();
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: CHASE_SYSTEM, tools: CHASE_TOOLS });
        const run = await runChaseAgent({ llm, tools, eligible, leads: await demoLeads(env, url) });
        const at = new Date().toISOString();
        for (const r of run.reminded) {
          const rec = await env.LEDGER.get(`inv:${r.id}`, "json");
          if (rec) await env.LEDGER.put(`inv:${r.id}`, JSON.stringify({ ...rec, reminded_at: at, reminder: { subject: r.subject, note: r.note, by: "chase agent (Claude + PayPal Agent Toolkit)" } }));
        }
        if (run.reminded.length) await forget("inv:");
        return json({ ...run, eligible: eligible.length, ms: Date.now() - t0 });
      }

      // A person approves a drafted invoice; the send agent (Claude with PayPal's Agent Toolkit) checks and sends that one.
      if (url.pathname === "/api/invoices/approve" && request.method === "POST") {
        const { id } = await request.json();
        const rec = await env.LEDGER.get(`inv:${id}`, "json");
        if (!rec) return json({ error: "Unknown invoice." }, 404);
        if (rec.status !== "DRAFT") return json({ error: `Invoice is ${rec.status}, not a draft.` }, 400);
        // per visitor first, then a shared budget, so one visitor cannot send every draft before the judges arrive
        const stop = await claudeGuard(env, request, "invoice sends", 3, 30); if (stop) return json({ error: stop }, 429);
        const tools = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
          configuration: { actions: { invoices: { get: true, send: true } }, context: { sandbox: true } } }).getTools();
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: SEND_SYSTEM, tools: SEND_TOOLS });
        const approvedAt = new Date().toISOString();
        const agent = await runSendAgent({ llm, tools, approved: { id, lead: rec.lead, ad: rec.ad, amount: String(rec.amount || "49.00") } });
        const fresh = await pp.getInvoice(id);
        Object.assign(rec, { status: fresh.status, approved_at: approvedAt, pay_url: fresh.detail?.metadata?.recipient_view_url || rec.pay_url || null,
          // "sent by the agent" only when PayPal itself no longer shows a draft
          ...(agent.sent && fresh.status && fresh.status !== "DRAFT" ? { sent_at: new Date().toISOString(), sent_by: "send agent (Claude + PayPal Agent Toolkit)" } : {}) });
        await env.LEDGER.put(`inv:${id}`, JSON.stringify(rec)); await forget("inv:");
        return json({ invoice: publicInvoice(rec), agent });
      }

      // A person approves resolving a likely double payment; the refund agent (Claude + PayPal Agent Toolkit) decides and,
      // if it is one, refunds the second capture in full with create_refund and reads the refund back with get_refund.
      if (url.pathname === "/api/duplicates/refund" && request.method === "POST") {
        const { capture_id } = await request.json();
        const payments = await listPayments(env);
        const flag = possibleDuplicates(payments).find((d) => d.capture_id === capture_id);
        if (!flag) return json({ error: "That capture is not flagged as a likely double payment (or it is already refunded)." }, 400);
        // one approval at a time per capture, so two clicks cannot refund twice (the toolkit call carries no request id)
        if (await env.LEDGER.get(`refund-lock:${capture_id}`)) return json({ error: "A refund for this capture is already running or done." }, 409);
        const stop = await claudeGuard(env, request, "refund agent", 2, 10); if (stop) return json({ error: stop }, 429);
        await env.LEDGER.put(`refund-lock:${capture_id}`, new Date().toISOString(), { expirationTtl: 3600 });
        const key = async (p) => (p.payer_email_sha256 ? (await sha(`${env.PAYPAL_CLIENT_SECRET}:${p.payer_email_sha256}`)).slice(0, 12) : "unknown");
        const view = async (p) => ({ capture_id: p.capture_id, payer_key: await key(p), ad: p.ad, amount: p.amount, currency: p.currency || "USD", captured_at: utc(p.captured_at) });
        const pair = { first: await view(payments.find((p) => p.capture_id === flag.first)), second: await view(payments.find((p) => p.capture_id === capture_id)), seconds: flag.seconds };
        const tools = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
          configuration: { actions: { payments: { createRefund: true, getRefunds: true } }, context: { sandbox: true } } }).getTools();
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: REFUND_SYSTEM, tools: REFUND_TOOLS });
        const approvedAt = new Date().toISOString();
        let agent;
        try { agent = await runRefundAgent({ llm, tools, pair }); }
        catch (e) { await env.LEDGER.delete(`refund-lock:${capture_id}`); return json({ error: `The refund agent could not run: ${String(e?.message || e).slice(0, 200)}` }, 502); }
        let payment = null;
        if (agent.refund?.id) {
          // the webhook for this refund must not count it again
          await env.LEDGER.put(`seen:${agent.refund.id}`, "1");
          payment = await applyRefund(env, capture_id, agent.refund.amount, agent.refund.read_back?.create_time || new Date().toISOString());
          if (payment) { payment.refunded_by = "refund agent (Claude + PayPal Agent Toolkit)"; payment.refund_id = agent.refund.id; await env.LEDGER.put(`pay:${capture_id}`, JSON.stringify(payment)); await forget("pay:"); }
        } else await env.LEDGER.delete(`refund-lock:${capture_id}`);
        const run = { pair, approved_at: approvedAt, finished_at: new Date().toISOString(), refund: agent.refund, summary: agent.summary, trace: agent.trace };
        if (agent.refund?.id) await env.LEDGER.put("run:refund", JSON.stringify(run));
        return json(run);
      }

      // Same double charge, two buyers: the judge picks what the buyer wrote and the refund agent decides live. Real Claude and
      // the same code limits; the refund tool is simulated here (no money moves), the real refund is the one below it.
      if (url.pathname === "/api/judge/refund-try" && request.method === "POST") {
        let body; try { body = await request.json(); } catch { body = {}; }
        const SAID = {
          siblings: ["Booked the trial for my daughter Mai.", "And her brother Sam too, I paid for him separately."],
          twice: ["Booked one trial for Mai.", "The page froze after I pressed Pay, so I pressed it again. I think I paid twice."],
        };
        const context = SAID[body.variant];
        if (!context) return json({ error: "Pick one of the two buyers." }, 400);
        // past the limit, show the last live decision for this buyer (with its time) instead of an error
        const last = await env.LEDGER.get(`refund-try:${body.variant}`, "json");
        const stop = await claudeGuard(env, request, "refund tries", 10, 120);
        if (stop) return last ? json({ ...last, replay: true, note: "Today's limit for live tries is reached, so this is the last live decision for this buyer." }) : json({ error: stop }, 429);
        const pair = { first: { capture_id: "TRY-1ST", payer_key: "same-payer", ad: "trial_video", amount: "49.00", currency: "USD", captured_at: "2026-10-28T10:49:51.000Z" },
          second: { capture_id: "TRY-2ND", payer_key: "same-payer", ad: "trial_video", amount: "49.00", currency: "USD", captured_at: "2026-10-28T10:53:27.000Z" }, seconds: 216, context };
        const tools = { create_refund: { execute: async () => JSON.stringify({ id: "SIMULATED", status: "COMPLETED", note: "simulated on the judge path; no money moved" }) },
          get_refund: { execute: async (a) => JSON.stringify({ id: a.refund_id, status: "COMPLETED", amount: { value: "49.00", currency_code: "USD" } }) } };
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: REFUND_SYSTEM, tools: REFUND_TOOLS });
        try {
          const out = await runRefundAgent({ llm, tools, pair });
          const res = { variant: body.variant, said: context, decision: out.refund ? "refund" : "decline", summary: out.summary, trace: out.trace, simulated: true, at: new Date().toISOString() };
          await env.LEDGER.put(`refund-try:${body.variant}`, JSON.stringify(res));
          return json(res);
        } catch (e) { return json({ error: `The refund agent could not run: ${String(e?.message || e).slice(0, 200)}` }, 502); }
      }

      // The last refund the refund agent made, for the judge path: the flagged pair, the approval, the toolkit calls, PayPal's status.
      if (url.pathname === "/api/judge/refund-loop") {
        const [run, payments] = await Promise.all([env.LEDGER.get("run:refund", "json"), listPayments(env)]);
        const open = possibleDuplicates(payments).map((d) => ({ capture_id: d.capture_id, first: d.first, seconds: d.seconds }));
        return json({ last: run, open, checked_at: new Date().toISOString() });
      }

      // A person approves the creator's commission; the commission agent (Claude) picks the orders that earn it and pays
      // with PayPal Payouts. Code pins the recipient, checks each order against the ledger and fixes the amount.
      if (url.pathname === "/api/commissions/pay" && request.method === "POST") {
        const st = await commissionState(env);
        if (!st.orders.some((o) => o.eligible)) return json({ error: "No paid order of this ad is waiting for commission." }, 400);
        if (await env.LEDGER.get("commission-lock")) return json({ error: "A commission payout is already running." }, 409);
        const stop = await claudeGuard(env, request, "commission agent", 2, 10); if (stop) return json({ error: stop }, 429);
        await env.LEDGER.put("commission-lock", "1", { expirationTtl: 120 });
        const program = { ad: CREATOR.ad, ad_name: adName(CREATOR.ad), creator: CREATOR.creator, rate: CREATOR.rate };
        const pay = {
          // the batch id is derived from the orders paid, so a retry of the same payout is refused by PayPal, never paid twice
          create: async ({ capture_ids, total, note }) => pp.createPayout({ batchId: `commission-${CREATOR.ad}-${(await sha([...capture_ids].sort().join(","))).slice(0, 16)}`,
            receiver: CREATOR.receiver, value: total, note, subject: "Your Kite Robotics creator commission (demo)", itemId: [...capture_ids].sort().join("+").slice(0, 120) }),
          get: (id) => pp.getPayout(id),
        };
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: PAYOUT_SYSTEM, tools: PAYOUT_TOOLS });
        const approvedAt = new Date().toISOString();
        let agent;
        try { agent = await runPayoutAgent({ llm, pay, program, orders: st.orders }); }
        catch (e) { await env.LEDGER.delete("commission-lock"); return json({ error: `The commission agent could not run: ${String(e?.message || e).slice(0, 200)}` }, 502); }
        const run = { program: { ...program, rate_basis: "per PayPal-confirmed paid order" }, orders: st.orders, approved_at: approvedAt, finished_at: new Date().toISOString(),
          payout: agent.payout, summary: agent.summary, trace: agent.trace, paid_by: "commission agent (Claude + PayPal Payouts)" };
        if (agent.payout?.batch_id) { await env.LEDGER.put(`commission:${agent.payout.batch_id}`, JSON.stringify({ ...agent.payout, at: run.finished_at, approved_at: approvedAt, summary: agent.summary, trace: agent.trace })); await forget("commission:"); }
        await env.LEDGER.delete("commission-lock");
        return json(run);
      }

      // The creator's commission for the judge path: every order of the ad and why it earns or not, the payouts made, what is owed back.
      if (url.pathname === "/api/judge/commission") {
        let st = await commissionState(env);
        // a payout batch starts PENDING; read it again from PayPal until it settles, and keep what PayPal says
        const done = (b) => ["SUCCESS", "DENIED", "CANCELED", "FAILED", "UNCLAIMED", "RETURNED", "REFUNDED", "BLOCKED"].includes(b.read_back?.item_status || "");
        let changed = false;
        for (const b of st.batches.filter((x) => !done(x)).slice(0, 3)) {
          try {
            const out = await pp.getPayout(b.batch_id);
            b.status = out?.batch_header?.batch_status || b.status;
            b.read_back = { status: out?.batch_header?.batch_status || null, item_status: out?.items?.[0]?.transaction_status || null, time_completed: out?.batch_header?.time_completed || null,
              transaction_id: out?.items?.[0]?.transaction_id || null, read_at: new Date().toISOString() };
            await env.LEDGER.put(`commission:${b.batch_id}`, JSON.stringify(b)); changed = true;
          } catch {}
        }
        if (changed) { await forget("commission:"); st = await commissionState(env); }
        // leads as the ad report counts them (the export the owner reads), not the demo's sample of lead messages
        const adRows = parseAdCsv(await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text()).rows;
        const leadsOf = (ad) => adRows.find((r) => r.ad === ad)?.leads ?? 0, leads = leadsOf(CREATOR.ad);
        // the same deal paid per lead on the ad with the most leads: what a lead-based commission would reward
        const payments = await listPayments(env);
        const guide = commissionOrders(payments, { ad: "free_guide", rate: CREATOR.rate }, heldDuplicates(payments), {}, disputeState).filter((o) => o.eligible).length;
        const guideLeads = leadsOf("free_guide");
        return json({ program: { ad: CREATOR.ad, ad_name: adName(CREATOR.ad), creator: CREATOR.creator, rate: CREATOR.rate, leads, per_lead_would_be: (leads * Number(CREATOR.rate)).toFixed(2),
          contrast: { ad_name: adName("free_guide"), leads: guideLeads, paid_orders: guide, per_lead: (guideLeads * Number(CREATOR.rate)).toFixed(2), per_paid_order: (guide * Number(CREATOR.rate)).toFixed(2) } },
          ...st, checked_at: new Date().toISOString() });
      }

      // Cross-check the webhook ledger against PayPal's own transaction history.
      if (url.pathname === "/api/paypal-check") {
        const end = new Date(), start = new Date(end - 30 * 86400000);
        const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
        let tx;
        try { tx = await pp.searchTransactions(iso(start), iso(end)); }
        catch (e) { return json({ status: "unavailable", reason: e.status === 403 ? "Transaction Search is not enabled on this PayPal app yet." : e.message }); }
        let disputes; try { disputes = await syncDisputes(env); } catch (e) { disputes = { status: "unavailable", reason: String(e?.message || e).slice(0, 200) }; }
        const ledger = await listPayments(env);
        const ids = new Set(ledger.map((p) => p.capture_id));
        // T00xx are payments received; other codes (T1900 sandbox funding, fees, transfers) are not customer payments
        const items = (tx.transaction_details || []).map((t) => t.transaction_info)
          .filter((t) => String(t.transaction_event_code || "").startsWith("T00") && Number(t.transaction_amount?.value) > 0);
        const seen = new Set(items.map((t) => t.transaction_id));
        const cutoff = Date.parse(tx.last_refreshed_datetime || "") || Date.now();
        const newer = (p) => Date.parse(p.captured_at) > cutoff || p.via === "invoice"; // invoice payments carry PayPal's local-day time
        return json({
          status: "ok", checked_at: new Date().toISOString(), paypal_count: items.length, ledger_count: ledger.length, disputes,
          // PayPal states how current its report is; a payment newer than that is pending, not missing
          report_current_to: tx.last_refreshed_datetime || null,
          matched: ledger.filter((p) => seen.has(p.capture_id)).map((p) => p.capture_id),
          after_report_refresh: ledger.filter((p) => !seen.has(p.capture_id) && newer(p)).map((p) => p.capture_id),
          missing_from_paypal_report: ledger.filter((p) => !seen.has(p.capture_id) && !newer(p)).map((p) => p.capture_id),
          in_paypal_not_in_ledger: items.filter((t) => !ids.has(t.transaction_id)).map((t) => ({ id: t.transaction_id, amount: t.transaction_amount?.value, custom: t.custom_field || null })),
        });
      }

      // Approve / Dismiss on an agent recommendation is kept server-side with its evidence, so a decision is auditable
      if (url.pathname === "/api/decisions" && request.method === "POST") {
        const stop = await guard(env, request, "decisions", 40, 400); if (stop) return json({ error: stop }, 429);
        const b = await request.json();
        if (!["approved", "dismissed"].includes(b.verdict) || !AD_KEYS.has(b.ad)) return json({ error: "A verdict on one of the demo's ads is required." }, 400);
        // a decision is only ever on a recommendation the evidence gate passed: the server copies the move from it, so the
        // public log cannot hold a move the gate never saw
        const vid = visitorId(request);
        const [live, own, syn] = await Promise.all([env.LEDGER.get("rec:latest", "json"), env.LEDGER.get(`rec:v:${vid}`, "json"), env.LEDGER.get("rec:synthetic", "json")]);
        const base = [live, own, syn].find((r) => r && r.id === b.rec_id);
        const act = base && Number.isInteger(b.index) ? base.recommendation?.actions?.[b.index] : null;
        if (!act || act.ad !== b.ad) return json({ error: "That recommendation is no longer the latest checked one. Ask the agent again." }, 409);
        const at = new Date().toISOString(), id = `D-${Date.now().toString(36).toUpperCase()}`;
        const rec = { id, at, ad: act.ad, change: act.change, verdict: b.verdict, reason: String(act.reason || "").slice(0, 600), evidence: (act.evidence || []).slice(0, 8).map((e) => String(e).slice(0, 40)),
          rec_id: base.id, index: b.index, ...(base === syn ? { week: "synthetic scenario week" } : {}) };
        await env.LEDGER.put(`dec:v:${vid}:${at}:${id}`, JSON.stringify(rec), { expirationTtl: 2592000 });
        await Promise.all([forget("dec:"), forget(`dec:v:${vid}:`)]);
        return json(rec);
      }
      // Decisions are private to this browser; the total lets visitors see how much the demo has been used.
      if (url.pathname === "/api/decisions") {
        const vid = visitorId(request);
        const [decisions, all] = await Promise.all([cachedList(env, `dec:v:${vid}:`), cachedList(env, "dec:")]);
        return json({ total: all.length, mine_total: decisions.length, decisions: decisions.reverse().slice(0, 50)
        .map((d) => ({ ...d, week: d.week || ((d.evidence || []).some((e) => String(e).startsWith("SYN")) ? "synthetic scenario week" : "live ledger"),
          // the budget rule in force today dates from 31 Oct; earlier approvals stay as history, not as moves it would allow
          ...(d.at < RULE_SINCE ? { rule: "made under an earlier rule (before 31 Oct 2026, 12:00 UTC); kept as history" } : {}) })) });
      }

      // A recorded live run of the budget agent on an owner's request (replayed on /judge; "Run it live" calls /api/agent)
      if (url.pathname === "/api/runs/owner") return json({ run: await env.LEDGER.get("run:owner", "json") });
      if (url.pathname === "/api/runs/week") return json({ run: await env.LEDGER.get("run:week", "json") });
      // The move the owner asked for, sent straight to the evidence gate on the live ledger (no Claude turn): what code says
      if (url.pathname === "/api/judge/counterfactual") {
        const payments = await listPayments(env);
        const rec = reconcile(parseAdCsv(await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text()).rows, payments);
        const target = [...rec.ads].sort((a, b) => b.leads - a.leads)[0];
        const proposal = { headline: `Raise ${adName(target.ad)}: it brings the most leads.`, actions: [{ ad: target.ad, change: "increase", reason: `Raise ${adName(target.ad)}: it brings the most leads.`, evidence: [`row:${target.ad}`] }] };
        return json({ checked_at: new Date().toISOString(), ad: target.ad, leads: target.leads, paid: target.paid, proposal, refused: checkRecommendation(rec, payments, proposal) });
      }

      // One lead's invoice loop for the judge path: what the lead wrote, the agent's draft through the Agent Toolkit, the
      // person's approval and the send agent, the chase agent's reminder, PayPal's paid status, and Meta's receipt.
      // Picks the furthest an agent-drafted invoice has got (paid first), so it shows what really happened, nothing staged.
      if (url.pathname === "/api/judge/invoice-loop") {
        const [invoices, leads, payments, meta, run] = await Promise.all([listPrefix(env, "inv:"), demoLeads(env, url), listPayments(env), cachedList(env, "meta:"), env.LEDGER.get("run:revenue", "json")]);
        const stage = (i) => (i.status === "PAID" ? 4 : i.reminded_at ? 3 : i.sent_at ? 2 : 1);
        const pick = invoices.filter((i) => i.drafted_by && i.status !== "CANCELLED").sort((a, b) => stage(b) - stage(a) || String(b.sent_at || "").localeCompare(String(a.sent_at || "")))[0] || null;
        const lead = pick && leads.find((l) => l.lead === pick.lead);
        const pay = pick && payments.find((p) => p.order_id === pick.id);
        const sent = pay && meta.find((m) => m.capture_id === pay.capture_id && m.ok);
        const injection = leads.find((l) => /ignore (all |your )?previous instructions/i.test(l.message || ""));
        const skip = injection && run?.skips?.find((k) => k.lead === injection.lead);
        return json({
          invoice: pick && { id: pick.id, lead: pick.lead, ad: pick.ad, ad_name: adName(pick.ad), channel: pick.channel || "web", amount: pick.amount, lines: pick.lines || null, note: pick.note || null, reason: pick.reason || null,
            drafted_by: pick.drafted_by, created_at: pick.created_at, sent_by: pick.sent_by || null, sent_at: pick.sent_at || null, approved_at: pick.approved_at || null,
            reminder: pick.reminder ? { note: pick.reminder.note, by: pick.reminder.by } : null, reminded_at: pick.reminded_at || null, status: pick.status, paid_at: pick.paid_at || null, pay_url: pick.pay_url || null },
          lead: lead && { lead: lead.lead, message: lead.message, asked_for: lead.asked_for, source: lead.source === "fb" ? "Meta" : "Google" },
          // the Meta send happens the moment the Worker learns the invoice is paid, so "paid" here is the earlier of the two times
          payment: pay ? { capture_id: pay.capture_id, amount: pay.amount, captured_at: sent && Date.parse(sent.at) < Date.parse(pay.captured_at) ? utc(sent.at) : utc(pay.captured_at), paypal_payment_date: pay.paypal_payment_date || null, meta: sent ? { at: sent.at, events_received: sent.events_received ?? null } : null } : null,
          injection: injection && { lead: injection.lead, message: injection.message, skipped: skip ? { reason: skip.reason, flag: skip.flag || null, at: run.at } : null },
          checked_at: new Date().toISOString() });
      }

      // The latest recommendation that passed the evidence gate, with the owner's decisions on it, so Approvals survives a reload.
      if (url.pathname === "/api/recommendation") {
        const vid = visitorId(request);
        const [own, shared, decisions, all] = await Promise.all([
          env.LEDGER.get(`rec:v:${vid}`, "json"), env.LEDGER.get("rec:latest", "json"),
          cachedList(env, `dec:v:${vid}:`), cachedList(env, "dec:")]);
        const mine = own ? { ...own, mine: true } : null;
        return json({ latest: mine || shared, mine, shared, decisions: decisions.slice(-50), decision_count: all.length, my_decision_count: decisions.length });
      }

      // The browser-side Studio agent framework talks to Claude through this proxy; the key never leaves the Worker.
      if (url.pathname === "/api/ai/turn" && request.method === "POST") {
        const raw = await request.text();
        if (raw.length > 250000) return json({ error: "Request too large." }, 413);
        const b = JSON.parse(raw);
        // only AG Studio agent turns: Studio's own and Paid Signal's tools, a bounded conversation; anything else is refused
        const names = Array.isArray(b.tools) ? b.tools.map((t) => t?.name) : [];
        const unknown = names.filter((n) => !STUDIO_TOOLS.has(n));
        if (!names.length || unknown.length || !Array.isArray(b.messages) || b.messages.length > 80 || String(b.system || "").length > 60000) {
          console.warn("ai turn refused", { unknown, messages: b.messages?.length, system: String(b.system || "").length });
          return json({ error: "Only AG Studio agent turns are accepted." }, 400);
        }
        const stop = await guard(env, request, "assistant turns", 80, Number(env.AI_TURNS_DAILY || 400)); if (stop) return json({ error: stop }, 429);
        const model = "claude-sonnet-5-5"; // one model, whatever the page asks for
        const body = JSON.stringify({ model, max_tokens: Math.min(Number(b.max_tokens) || 3000, 4000), system: b.system, messages: cleanTurns(b.messages), tools: b.tools, ...(b.tool_choice ? { tool_choice: b.tool_choice } : {}) });
        const ask = () => fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", body,
          headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : {}) },
        });
        let res = await ask();
        // several Studio agents run at once; an overloaded or rate-limited moment is retried once instead of breaking the run
        if ([429, 500, 529].includes(res.status)) { await new Promise((r) => setTimeout(r, 1500)); res = await ask(); }
        const text = await res.text();
        if (!res.ok) console.warn("anthropic turn failed", res.status, text.slice(0, 300));
        return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
      }

      if (url.pathname === "/api/reconcile" && request.method === "POST") {
        const { csv } = await request.json();
        const parsed = parseAdCsv(csv);
        const payments = await listPayments(env);
        const rec = reconcile(parsed.rows, payments);
        // Redact person-level IDs here; Meta gets the original payload, while public pages show its shape.
        const meta = await metaFromLedger(payments, `${url.origin}/shop.html`);
        const safeMeta = publicMeta(meta);
        return json({ reconciliation: rec, odds: paybackOdds(rec), csv_errors: parsed.errors, meta: safeMeta, google: googleRows(payments, undefined, { hold: heldDuplicates(payments) }) });
      }

      // The same gate for the budget agent that runs inside AG Studio: its recommendation is accepted only if every
      // number and evidence id comes from the reconciliation; otherwise the problems go back to it for one repair.
      if (url.pathname === "/api/agent/check" && request.method === "POST") {
        const { csv, recommendation } = await request.json();
        const payments = await listPayments(env);
        const rec = reconcile(parseAdCsv(csv).rows, payments);
        const out = { headline: String(recommendation?.headline || ""), caveats: String(recommendation?.caveats || ""), actions: (recommendation?.actions || []).slice(0, 4) };
        const problems = checkRecommendation(rec, payments, out);
        const saved = problems.length ? null : await saveRecommendation(env, out, "AG Studio budget agent", visitorId(request));
        return json({ grounded: problems.length === 0, problems, recommendation: out, rec_id: saved?.id || null, mine: Boolean(saved), saved });
      }

      if (url.pathname === "/api/agent" && request.method === "POST") {
        const body = await request.json();
        const stop = await claudeGuard(env, request, "agent runs", 4, Number(env.AGENT_DAILY || 40));
        if (stop) return budgetUnavailable(await budgetFallback(env), 429);
        // a synthetic week (src/scenarios.js) has enough paid orders for a real decision; it never touches the PayPal ledger
        const week = body.scenario ? scenario(String(body.scenario)) : null;
        if (body.scenario && !week) return json({ error: "Unknown scenario." }, 400);
        const payments = week ? week.payments : await listPayments(env);
        const rec = reconcile(week ? week.ads : parseAdCsv(body.csv).rows, payments);
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined });
        const started = Date.now();
        let out;
        try { out = await runAgent({ llm, rec, payments, instruction: typeof body.instruction === "string" ? body.instruction : "" }); }
        catch { console.warn("budget agent failed"); return budgetUnavailable(await budgetFallback(env), 502); }
        const source = week ? `budget agent · SYNTHETIC: ${week.name}` : "budget agent";
        const demoCsv = !week && body.instruction === OWNER_ASK ? await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text() : null;
        const plain = (t) => String(t || "").split(String.fromCharCode(13)).join("").trim(); // Windows line endings aside
        const sharedRun = demoCsv !== null && plain(body.csv) === plain(demoCsv);
        const vid = visitorId(request);
        const saved = out.recommendation && out.grounded ? await saveRecommendation(env, out.recommendation, source, vid, sharedRun) : null;
        // the latest owner request on the live ledger is kept whole, so /judge can replay it without spending a Claude turn
        // only the dashboard's own request on the bundled ad export, and only an answer the gate passed: a visitor's edited
        // CSV or free text never replaces what /judge shows every judge
        // the latest gate-passed run on a labelled synthetic week, replayed on /judge as "when the payments do support a move"
        if (week && out.recommendation && out.grounded) await env.LEDGER.put("run:week", JSON.stringify({ at: new Date().toISOString(), week: { id: week.id, name: week.name, story: week.story },
          recommendation: out.recommendation, trace: out.trace, ms: Date.now() - started, grade: grade(week, out.recommendation.actions || []) }));
        if (sharedRun && out.recommendation && out.grounded) await env.LEDGER.put("run:owner", JSON.stringify({ at: new Date().toISOString(), instruction: String(body.instruction).slice(0, 300),
          recommendation: out.recommendation, grounded: out.grounded, trace: out.trace, ms: Date.now() - started, rec_id: saved?.id || null,
          ads: rec.ads.map((r) => ({ ad: r.ad, leads: r.leads, paid: r.paid, revenue_cents: r.revenue_cents, spend_cents: r.spend_cents })), moves: supportedMoves(rec) }));
        return json({ ...out, rec_id: saved?.id || null, source, ms: Date.now() - started, ...(saved ? { saved, mine: !sharedRun } : {}),
          ...(week ? { synthetic: { id: week.id, name: week.name, story: week.story, right_answer: week.right }, grade: grade(week, out.recommendation?.actions || []) } : {}) });
      }

      if (url.pathname === "/mcp") {
        if (request.method !== "POST") return new Response("Paid Signal MCP server: POST JSON-RPC here (streamable HTTP, JSON responses).", { status: 405, headers: { allow: "POST" } });
        const body = await request.json();
        if (Array.isArray(body) && body.length > 5) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "At most 5 requests per batch." } }, 400);
        const call = (name, args) => mcpTool(env, url, name, args);
        const out = Array.isArray(body) ? (await Promise.all(body.map((m) => handleMcp(m, call)))).filter(Boolean) : await handleMcp(body, call);
        return out === null || (Array.isArray(out) && !out.length) ? new Response(null, { status: 202 }) : json(out);
      }

      if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      if (url.pathname === "/" && request.method === "GET") return withPageHeaders(await firstPaint(env, url, await env.ASSETS.fetch(request)));
      return env.ASSETS.fetch(request);
    } catch (e) {
      // a client error says what PayPal objected to; a server error says only that it failed (details stay in the logs)
      console.error(e);
      // our own credentials or quota failing (401, 403, 429) is not the caller's mistake: it is a 502 like any PayPal outage
      if (e.status && e.status < 500 && ![401, 403, 429].includes(e.status)) return json({ error: e.message, paypal: e.paypal?.name ? { name: e.paypal.name } : null }, 400);
      return json({ error: "Something went wrong talking to PayPal or Claude. Please try again." }, 502);
    }
  },
};
// Every five minutes: recover paid invoices even when PayPal does not send INVOICING.INVOICE.PAID.
// Every night: keep a few drafts for visitors to approve and refresh disputes.
app.scheduled = async (event, env) => {
  const pp = paypal({ clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET });
  const url = new URL("https://paid-signal.thelongmarketing.workers.dev/");
  if (event.cron === "*/5 * * * *") {
    try { await syncInvoices(env, pp, url, true); } catch { console.warn("scheduled invoice sync failed"); }
    return;
  }
  if (event.cron !== "17 2 * * *") return;
  let invoices = await listPrefix(env, "inv:");
  // drafts nobody approved within a day are cleared, so judges find fresh ones
  for (const i of invoices.filter((x) => x.status === "DRAFT" && Date.now() - Date.parse(x.created_at || 0) > 20 * 3600000)) {
    try { await pp.deleteDraftInvoice(i.id); } catch {}
    await env.LEDGER.delete(`inv:${i.id}`);
  }
  invoices = await listPrefix(env, "inv:");
  await forget("inv:");
  // no draft waiting: the revenue agent reads the leads again and drafts only for the ones ready to pay, priced by code
  if (!invoices.some((i) => i.status === "DRAFT") && await quota(env, "Claude runs", CLAUDE_DAILY)) await revenueDrafts(env, url);
  try { await syncDisputes(env); } catch (e) { console.warn("dispute sync failed", e?.message); }
};
const worker = {
  async fetch(request, env, ctx) {
    const current = visitorId(request);
    const id = current || crypto.randomUUID();
    const incoming = current ? request : addVisitorCookie(request, id);
    const response = await app.fetch(incoming, env, ctx);
    return withVisitorCookie(request, response, id, !current);
  },
  scheduled: app.scheduled,
};
export default worker;
