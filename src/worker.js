// Paid Signal Worker. Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID),
// PAYPAL_WEBHOOK_ID once the webhook is registered. KV LEDGER holds sandbox captures (no raw email, only its hash).
import { paypal } from "./paypal.js";
import { ordersSdk } from "./paypalSdk.js";
import { handleMcp } from "./mcp.js";
import { packClick, unpackClick, parseAdCsv, reconcile, metaEvents, googleRows, possibleDuplicates } from "./ledger.js";
import { runAgent, anthropicLLM, checkRecommendation } from "./agent.js";
import { runSendAgent, SEND_SYSTEM, SEND_TOOLS } from "./sendAgent.js";
import { parseCsv, runRevenueAgent, REVENUE_SYSTEM, REVENUE_TOOLS } from "./revenue.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

// The demo shop sells one thing; the price is fixed server-side so a page cannot choose what it pays.
const PRODUCT = { sku: "trial-class", name: "Robotics trial class (demo shop)", amount: "49.00", currency: "USD" };
// the demo's ad export: a click for any other ad is kept as "direct", so the ledger cannot be filled with made-up ads
const AD_KEYS = new Set(["trial_video", "free_guide", "parent_carousel", "holiday_static"]);
const CLICK_ID = /^[A-Za-z0-9_-]{1,64}$/;
// tools AG Studio's built-in agents and Paid Signal's own Studio tools send; the Claude proxy serves nothing else
const STUDIO_TOOLS = new Set(["add_page_filter", "add_widget", "add_widget_filter", "clear_plan", "configure_widget", "create_expression", "create_plan",
  "delete_expression", "execute_query", "position_widget", "remove_page_filter", "remove_widget", "remove_widget_filter", "rename_thread", "update_expression",
  "update_plan", "view_page", "view_plan", "view_report", "view_schema", "view_widget", "delegate_to", "complete_task", "read_paid_signal", "list_unpaid_leads",
  "draft_paypal_invoices", "check_paypal_ledger", "submit_budget_recommendation"]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

// KV list calls are the scarce resource: the ledger is read through a 20-second edge cache, cleared on every write here
const cacheKey = (prefix) => new Request(`https://ledger.paid-signal.internal/${prefix}`);
async function cachedList(env, prefix) {
  const cache = globalThis.caches?.default;
  const hit = cache && (await cache.match(cacheKey(prefix)));
  if (hit) return hit.json();
  const out = await listPrefix(env, prefix);
  if (cache) await cache.put(cacheKey(prefix), new Response(JSON.stringify(out), { headers: { "cache-control": "max-age=20" } }));
  return out;
}
const forget = async (prefix) => { await globalThis.caches?.default?.delete(cacheKey(prefix)); };

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
    ad: click.ad, source: click.source, click_id: click.clickId, clicked_at: click.clickedAt,
    captured_at: cap.create_time || new Date().toISOString(), refunded_amount: "0.00",
    payer_email_sha256: email ? await sha(email.trim().toLowerCase()) : null,
  };
  if (userAgent) record.user_agent = userAgent.slice(0, 300); // the buyer's browser, for Meta's website events
  // a replayed capture must not wipe refunds already recorded against it
  const prev = await env.LEDGER.get(`pay:${cap.id}`, "json");
  if (prev) { record.user_agent ??= prev.user_agent; record.refunded_amount = prev.refunded_amount; record.status = prev.status; if (prev.refunded_at) record.refunded_at = prev.refunded_at; }
  await env.LEDGER.put(`pay:${cap.id}`, JSON.stringify(record)); await forget("pay:");
  return record;
}

/**
 * The moment PayPal confirms a payment, its Purchase event goes to the shop's Meta dataset. In this demo the dataset is a
 * test one (test_event_code), so Events Manager shows the event live and it never counts toward real ads. Meta's answer
 * is kept with the payment so the dashboard and the receipt can show it. A held capture (duplicate, no click) is not sent.
 */
async function sendToMeta(env, url, record) {
  if (!record || !env.META_CAPI_TOKEN || !env.META_DATASET_ID || !env.META_TEST_CODE) return null;
  const sent = await env.LEDGER.get(`meta:${record.capture_id}`, "json");
  if (sent) return sent;
  const payments = await listPayments(env);
  const { events, held } = await metaEvents([record], { sourceUrl: `${url.origin}/shop.html`, hold: heldDuplicates(payments) });
  let out;
  if (!events.length) out = { capture_id: record.capture_id, held: held[0]?.reason || "held", at: new Date().toISOString() };
  else {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${env.META_DATASET_ID}/events`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ data: events, test_event_code: env.META_TEST_CODE, access_token: env.META_CAPI_TOKEN }),
      });
      const j = await res.json().catch(() => ({}));
      out = { capture_id: record.capture_id, event_id: events[0].event_id, value: events[0].custom_data.value, ok: res.ok, events_received: j.events_received ?? 0,
        fbtrace_id: j.fbtrace_id || null, error: j.error ? String(j.error.message || "error").slice(0, 160) : null, test_event: true, at: new Date().toISOString() };
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
  rec.refunded_at = when || new Date().toISOString();
  await env.LEDGER.put(`pay:${captureId}`, JSON.stringify(rec)); await forget("pay:");
  return rec;
}

// The dashboard's answer is in the HTML itself, so a phone or a slow connection sees it before the app loads.
async function firstPaint(env, url, page) {
  try {
    const csv = await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`))).text();
    const t = reconcile(parseAdCsv(csv).rows, await listPayments(env)).totals;
    // the same markup and classes the app renders, so the page reads at once and nothing jumps when React takes over
    const html = `<div class="app"><header class="top"><div class="top-in"><a class="brand" href="/"><span class="mark"><i></i></span>Paid Signal</a></div></header>`
      + `<main class="desk"><section class="hero"><div class="hero-copy"><h1 class="sr">Ads report ${t.leads} leads. PayPal confirms ${t.paid} paid ${t.paid === 1 ? "order" : "orders"}.</h1><p class="kicker">Kite Robotics Club · demo ad export · PayPal sandbox</p>`
      + `<div class="duo"><div><b class="n claimed">${t.leads}</b><span>leads the ads report</span></div><div><b class="n paid">${t.paid}</b><span>paid ${t.paid === 1 ? "order" : "orders"} PayPal confirms</span></div></div>`
      + `<p class="pitch">Ad platforms learn from the ${t.leads}. Paid Signal teaches them the ${t.paid}, straight from PayPal.</p></div>`
      + `<div class="hero-bars"><p class="ghost">Loading the ledger…</p></div></section></main></div>`;
    return new HTMLRewriter().on("#root", { element(e) { e.setInnerContent(html, { html: true }); } }).transform(page);
  } catch { return page; }
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
  if (name === "check_paypal_ledger") return get("/api/paypal-check");
  throw new Error(`Unknown tool ${name}`);
}

// a possible duplicate is held: not a paid order in the reconciliation and not reported to ad platforms until it is refunded
const heldDuplicates = (payments) => new Set(possibleDuplicates(payments).map((d) => d.capture_id));
// payments captured before this are the seeded demo ledger; refunds on them are previewed, not sent
const SEEDED_BEFORE = "2026-10-29T09:00:00Z";

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

/** A PayPal draft invoice for one demo lead, at the fixed price, with the lead's ad click in the private memo. */
async function draftInvoiceFor(env, pp, l) {
  const reference = packClick({ ad: l.ad, source: l.source, clickId: l.click_id, clickedAt: 0 }); // the demo leads carry no click time
  const inv = await pp.createDraftInvoice({ email: l.email, name: l.lead, item: PRODUCT.name, amount: PRODUCT.amount, reference, business: "Kite Robotics Club (demo)",
    note: `You asked about: ${l.asked_for}. Pay with PayPal to book the trial class.` });
  const rec = { id: inv.id, lead: l.lead, ad: l.ad, email: l.email, amount: PRODUCT.amount, status: inv.status || "DRAFT", reference, created_at: new Date().toISOString() };
  await env.LEDGER.put(`inv:${inv.id}`, JSON.stringify(rec));
  return rec;
}

/** An invoice paid through PayPal becomes a capture in the ledger, attributed by the click packed in its reference. */
async function recordInvoicePayment(env, invoice) {
  const kept = await env.LEDGER.get(`inv:${invoice.id}`, "json");
  const click = unpackClick(invoice.detail?.memo || kept?.reference || invoice.detail?.reference);
  const txs = invoice.payments?.transactions || [];
  for (const t of txs) {
    const id = t.payment_id; if (!id || (await env.LEDGER.get(`pay:${id}`))) continue;
    await env.LEDGER.put(`pay:${id}`, JSON.stringify({
      capture_id: id, order_id: invoice.id, status: "COMPLETED", amount: t.amount?.value, currency: t.amount?.currency_code || "USD",
      ad: click.ad, source: click.source, click_id: click.clickId, clicked_at: click.clickedAt, captured_at: t.payment_date_time || (t.payment_date ? `${t.payment_date}T00:00:00Z` : new Date().toISOString()),
      refunded_amount: "0.00", payer_email_sha256: null, via: "invoice",
    }));
  }
  const rec = await env.LEDGER.get(`inv:${invoice.id}`, "json");
  if (rec) { rec.status = invoice.status || "PAID"; rec.paid_at = new Date().toISOString(); await env.LEDGER.put(`inv:${invoice.id}`, JSON.stringify(rec)); }
  await forget("pay:"); await forget("inv:");
}

/** Shared daily limit plus a per-visitor one, so a single visitor cannot use up the demo for judges. */
async function guard(env, request, key, perIp, total) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await quota(env, `${key}:ip:${ip}`, perIp))) return `You reached this demo's limit for ${key} today.`;
  if (!(await quota(env, key, total))) return `The shared daily ${key} limit is reached.`;
  return null;
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
      if ((url.pathname === "/api/ai/turn" || url.pathname.startsWith("/api/agent") || url.pathname === "/api/invoices/approve") && origin !== url.origin)
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
        const order = await orders.captureOrder(order_id, `cap-${order_id}`);
        const record = await recordCapture(env, order, request.headers.get("user-agent"));
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
        if (String(cur.captured_at) < SEEDED_BEFORE) return json({ preview: true, message: `Capture ${capture_id} is one of the demo's seeded sandbox payments, so this refund is only previewed: its ad would lose $${amount ?? left} of paid revenue, and ${partial ? (cur.source === "g" ? "its Google row would become a restatement" : "its Meta event value would drop") : (cur.source === "g" ? "its Google row would become a retraction" : "its Meta event would be held back")}. To run a real sandbox refund, pay in the demo shop and refund that payment.` });
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
        if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && !(await env.LEDGER.get(`pay:${res.id}`))) {
          const orderId = res.supplementary_data?.related_ids?.order_id;
          if (orderId) await sendToMeta(env, url, await recordCapture(env, await orders.getOrder(orderId)));
        }
        if (event.event_type === "INVOICING.INVOICE.PAID" && res.id) await recordInvoicePayment(env, await pp.getInvoice(res.id));
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

      if (url.pathname === "/api/ledger") {
        const [payments, meta] = await Promise.all([listPayments(env), cachedList(env, "meta:")]);
        return json({ payments, duplicates: possibleDuplicates(payments), meta, meta_live: Boolean(env.META_CAPI_TOKEN && env.META_DATASET_ID) });
      }

      // Leads the ad export counted but PayPal never saw pay. The agent may draft invoices for them; a person sends.
      if (url.pathname === "/api/leads") return json({ leads: await demoLeads(env, url) });

      if (url.pathname === "/api/invoices" && request.method === "GET") return json({ invoices: await cachedList(env, "inv:") });

      // Webhooks are the main path, but the sandbox does not always emit INVOICING.INVOICE.PAID: ask PayPal about every
      // sent invoice and record the ones it says are paid (recordInvoicePayment is idempotent per payment id).
      if (url.pathname === "/api/invoices/sync" && request.method === "POST") {
        const all = await cachedList(env, "inv:");
        const open = all.filter((i) => i.status === "SENT" || i.status === "PARTIALLY_PAID");
        if (!open.length) return json({ checked: 0, paid: 0, invoices: all });
        // one PayPal re-check per 5 minutes for everyone; page loads in between just read the ledger
        const last = Number(await env.LEDGER.get("sync:last")) || 0;
        if (Date.now() - last < 300000) return json({ checked: 0, paid: 0, recent: true, invoices: all });
        await env.LEDGER.put("sync:last", String(Date.now()));
        let paid = 0;
        for (const i of open) { const inv = await pp.getInvoice(i.id); if (inv.status === "PAID" || inv.status === "PARTIALLY_PAID") { await recordInvoicePayment(env, inv); paid++; } }
        if (paid) await forget("inv:");
        return json({ checked: open.length, paid, invoices: await cachedList(env, "inv:") });
      }

      // The revenue agent reads what each unpaid lead wrote and proposes invoices; code prices and checks every proposal,
      // and PayPal's Agent Toolkit creates the drafts. Nothing is sent: each draft waits in Approvals.
      if (url.pathname === "/api/agent/revenue" && request.method === "POST") {
        const stop = await guard(env, request, "revenue agent runs", 4, 40); if (stop) return json({ error: stop }, 429);
        const t0 = Date.now();
        const invoices = await listPrefix(env, "inv:");
        const leads = (await demoLeads(env, url)).filter((l) => !invoices.some((i) => i.lead === l.lead && i.status === "PAID"));
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: REVENUE_SYSTEM, tools: REVENUE_TOOLS });
        const run = await runRevenueAgent({ llm, leads, invoices });
        const toolkit = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
          configuration: { actions: { invoices: { create: true } }, context: { sandbox: true } } }).getTools();
        const drafts = [];
        for (const p of run.proposals) {
          const lead = leads.find((l) => l.lead === p.lead);
          const params = { currency_code: "USD", reference: "Kite Robotics booking", note: p.note, invoicer_business_name: "Kite Robotics Club (demo)",
            primary_recipients: [{ billing_info: { email_address: lead.email, name: { given_name: lead.lead.replace(/ \(.*\)$/, "") } } }],
            items: p.lines.map((l) => ({ name: l.name, quantity: "1", unit_amount: { currency_code: "USD", value: l.unit } })) };
          let out = {}; try { out = JSON.parse(String(await toolkit.create_invoice.execute(params))); } catch {}
          const id = out.id || String(out.href || out.links?.[0]?.href || "").split("/").pop();
          if (!/^INV2-[A-Z0-9-]+$/.test(id)) { drafts.push({ lead: p.lead, error: "PayPal did not create the draft." }); continue; }
          const rec = { id, lead: lead.lead, ad: lead.ad, email: lead.email, amount: p.total, lines: p.lines, status: "DRAFT",
            reference: packClick({ ad: lead.ad, source: lead.source, clickId: lead.click_id, clickedAt: 0 }), note: p.note, reason: p.reason,
            drafted_by: "revenue agent (Claude) via PayPal Agent Toolkit", created_at: new Date().toISOString() };
          await env.LEDGER.put(`inv:${id}`, JSON.stringify(rec)); drafts.push(rec);
        }
        await forget("inv:");
        return json({ drafts, skips: run.skips, refusals: run.refusals, summary: run.summary, trace: run.trace, ms: Date.now() - t0 });
      }

      // A person approves a drafted invoice; the send agent (Claude with PayPal's Agent Toolkit) checks and sends that one.
      if (url.pathname === "/api/invoices/approve" && request.method === "POST") {
        const { id } = await request.json();
        const rec = await env.LEDGER.get(`inv:${id}`, "json");
        if (!rec) return json({ error: "Unknown invoice." }, 404);
        if (rec.status !== "DRAFT") return json({ error: `Invoice is ${rec.status}, not a draft.` }, 400);
        // per visitor first, then a shared budget, so one visitor cannot send every draft before the judges arrive
        const stop = await guard(env, request, "invoice sends", 3, 30); if (stop) return json({ error: stop }, 429);
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
        return json({ invoice: rec, agent });
      }

      // Cross-check the webhook ledger against PayPal's own transaction history.
      if (url.pathname === "/api/paypal-check") {
        const end = new Date(), start = new Date(end - 30 * 86400000);
        const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
        let tx;
        try { tx = await pp.searchTransactions(iso(start), iso(end)); }
        catch (e) { return json({ status: "unavailable", reason: e.status === 403 ? "Transaction Search is not enabled on this PayPal app yet." : e.message }); }
        const ledger = await listPayments(env);
        const ids = new Set(ledger.map((p) => p.capture_id));
        // T00xx are payments received; other codes (T1900 sandbox funding, fees, transfers) are not customer payments
        const items = (tx.transaction_details || []).map((t) => t.transaction_info)
          .filter((t) => String(t.transaction_event_code || "").startsWith("T00") && Number(t.transaction_amount?.value) > 0);
        const seen = new Set(items.map((t) => t.transaction_id));
        const cutoff = Date.parse(tx.last_refreshed_datetime || "") || Date.now();
        const newer = (p) => Date.parse(p.captured_at) > cutoff || p.via === "invoice"; // invoice payments carry PayPal's local-day time
        return json({
          status: "ok", checked_at: new Date().toISOString(), paypal_count: items.length, ledger_count: ledger.length,
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
        const at = new Date().toISOString(), id = `D-${Date.now().toString(36).toUpperCase()}`;
        const rec = { id, at, ad: String(b.ad).slice(0, 60), change: String(b.change || "").slice(0, 20), verdict: b.verdict, reason: String(b.reason || "").slice(0, 600), evidence: (b.evidence || []).slice(0, 8).map((e) => String(e).slice(0, 40)) };
        await env.LEDGER.put(`dec:${at}:${id}`, JSON.stringify(rec), { expirationTtl: 2592000 }); await forget("dec:");
        return json(rec);
      }
      if (url.pathname === "/api/decisions") return json({ decisions: (await cachedList(env, "dec:")).reverse().slice(0, 50) });

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
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : {}) },
          body: JSON.stringify({ model, max_tokens: Math.min(Number(b.max_tokens) || 3000, 4000), system: b.system, messages: b.messages, tools: b.tools, ...(b.tool_choice ? { tool_choice: b.tool_choice } : {}) }),
        });
        return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
      }

      if (url.pathname === "/api/reconcile" && request.method === "POST") {
        const { csv } = await request.json();
        const parsed = parseAdCsv(csv);
        const payments = await listPayments(env);
        const rec = reconcile(parsed.rows, payments);
        return json({ reconciliation: rec, csv_errors: parsed.errors, meta: await metaFromLedger(payments, `${url.origin}/shop.html`), google: googleRows(payments, undefined, { hold: heldDuplicates(payments) }) });
      }

      // The same gate for the budget agent that runs inside AG Studio: its recommendation is accepted only if every
      // number and evidence id comes from the reconciliation; otherwise the problems go back to it for one repair.
      if (url.pathname === "/api/agent/check" && request.method === "POST") {
        const { csv, recommendation } = await request.json();
        const payments = await listPayments(env);
        const rec = reconcile(parseAdCsv(csv).rows, payments);
        const out = { headline: String(recommendation?.headline || ""), caveats: String(recommendation?.caveats || ""), actions: (recommendation?.actions || []).slice(0, 4) };
        const problems = checkRecommendation(rec, payments, out);
        return json({ grounded: problems.length === 0, problems, recommendation: out });
      }

      if (url.pathname === "/api/agent" && request.method === "POST") {
        const { csv } = await request.json();
        const stop = await guard(env, request, "agent runs", 4, Number(env.AGENT_DAILY || 40)); if (stop) return json({ error: `${stop} The reconciliation still works.` }, 429);
        const payments = await listPayments(env);
        const rec = reconcile(parseAdCsv(csv).rows, payments);
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined });
        const started = Date.now();
        const out = await runAgent({ llm, rec, payments });
        return json({ ...out, ms: Date.now() - started });
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
      if (e.status && e.status < 500) return json({ error: e.message, paypal: e.paypal?.name ? { name: e.paypal.name } : null }, 400);
      return json({ error: "Something went wrong talking to PayPal or Claude. Please try again." }, 502);
    }
  },
};
// Every night: keep a few drafts for visitors to approve. A warm lead whose invoice was sent but never paid gets a fresh draft.
app.scheduled = async (_event, env) => {
  const pp = paypal({ clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET });
  let invoices = await listPrefix(env, "inv:");
  for (const i of invoices.filter((x) => x.status === "DRAFT" && x.drafted_by && Date.now() - Date.parse(x.created_at) > 20 * 3600000)) {
    try { await pp.deleteDraftInvoice(i.id); } catch {}
    await env.LEDGER.delete(`inv:${i.id}`);
  }
  invoices = await listPrefix(env, "inv:");
  let drafts = invoices.filter((i) => i.status === "DRAFT").length;
  if (drafts >= 3) return;
  const leads = await demoLeads(env, new URL("https://paid-signal.thelongmarketing.workers.dev/"));
  for (const l of leads) {
    if (drafts >= 3) break;
    const mine = invoices.filter((i) => i.lead === l.lead);
    if (!mine.length || mine.some((i) => i.status === "DRAFT" || i.status === "PAID")) continue;
    await draftInvoiceFor(env, pp, l); drafts++;
  }
  await forget("inv:");
};
export default app;
