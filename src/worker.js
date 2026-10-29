// Paid Signal Worker. Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID),
// PAYPAL_WEBHOOK_ID once the webhook is registered. KV LEDGER holds sandbox captures (no raw email, only its hash).
import { paypal } from "./paypal.js";
import { packClick, unpackClick, parseAdCsv, reconcile, metaEvents, googleRows, possibleDuplicates } from "./ledger.js";
import { runAgent, anthropicLLM, checkRecommendation } from "./agent.js";

// The demo shop sells one thing; the price is fixed server-side so a page cannot choose what it pays.
const PRODUCT = { sku: "trial-class", name: "Robotics trial class (demo shop)", amount: "49.00", currency: "USD" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

async function listPayments(env) {
  const out = []; let cursor;
  do {
    const page = await env.LEDGER.list({ prefix: "pay:", cursor });
    for (const k of page.keys) { const v = await env.LEDGER.get(k.name, "json"); if (v) out.push(v); }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
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
  await env.LEDGER.put(`pay:${cap.id}`, JSON.stringify(record));
  return record;
}

async function applyRefund(env, captureId, refundedValue, when) {
  const rec = await env.LEDGER.get(`pay:${captureId}`, "json");
  if (!rec) return null;
  const total = (Math.round(Number(rec.refunded_amount || 0) * 100) + Math.round(Number(refundedValue) * 100)) / 100;
  rec.refunded_amount = Math.min(total, Number(rec.amount)).toFixed(2);
  rec.status = Number(rec.refunded_amount) >= Number(rec.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  rec.refunded_at = when || new Date().toISOString();
  await env.LEDGER.put(`pay:${captureId}`, JSON.stringify(rec));
  return rec;
}

// a possible duplicate still counts as paid in the ledger, but is not reported to ad platforms until refunded or reviewed
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
  const text = await (await env.ASSETS.fetch(new Request(`${url.origin}/data/demo-leads.csv`))).text();
  const [head, ...rows] = text.replace(/\r/g, "").split("\n").filter(Boolean);
  const keys = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v.trim()])));
}

/** An invoice paid through PayPal becomes a capture in the ledger, attributed by the click packed in its reference. */
async function recordInvoicePayment(env, invoice) {
  const click = unpackClick(invoice.detail?.memo || invoice.detail?.reference);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pp = paypal({ clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET });
    try {
      if (url.pathname === "/api/config") return json({ paypal_client_id: env.PAYPAL_CLIENT_ID, product: PRODUCT, environment: "sandbox", ag_studio_license: env.AG_STUDIO_LICENSE || null });

      if (url.pathname === "/api/checkout" && request.method === "POST") {
        const b = await request.json();
        const source = ["fb", "g"].includes(b.source) ? b.source : "other";
        const customId = packClick({ ad: b.ad || "direct", source, clickId: b.click_id || "", clickedAt: b.clicked_at || 0 });
        // one checkout intent per visit: a second click on Pay gets the same PayPal order back, so it cannot be charged twice
        const intent = /^[a-z0-9-]{8,40}$/.test(String(b.intent)) ? b.intent : crypto.randomUUID();
        const order = await pp.createOrder({
          amount: PRODUCT.amount, currency: PRODUCT.currency, description: PRODUCT.name, customId,
          invoiceId: `PS-${intent.replace(/-/g, "").slice(0, 16)}`, returnUrl: `${url.origin}/shop.html?done=1`, cancelUrl: `${url.origin}/shop.html`,
          requestId: `chk-${intent}`,
        });
        return json({ id: order.id, custom_id: customId, approve_url: (order.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve")?.href });
      }

      if (url.pathname === "/api/capture" && request.method === "POST") {
        const { order_id } = await request.json();
        if (!/^[A-Z0-9]{10,24}$/.test(String(order_id))) return json({ error: "Bad order id." }, 400);
        const order = await pp.captureOrder(order_id, `cap-${order_id}`);
        const record = await recordCapture(env, order, request.headers.get("user-agent"));
        return json({ status: order.status, payment: record });
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
        const r = await pp.refundCapture(capture_id, { amount: amount === undefined ? undefined : Number(amount).toFixed(2), requestId: crypto.randomUUID() });
        // mark the refund as applied first, so PayPal's PAYMENT.CAPTURE.REFUNDED webhook for it is not counted again
        await env.LEDGER.put(`seen:${r.id}`, "1");
        const rec = await applyRefund(env, capture_id, r.amount?.value || amount, r.create_time);
        return json({ refund: { id: r.id, status: r.status, amount: r.amount?.value }, payment: rec });
      }

      // PayPal pushes capture and refund events here; nothing is trusted until PayPal verifies the signature.
      if (url.pathname === "/api/webhook" && request.method === "POST") {
        const event = await request.json();
        if (!env.PAYPAL_WEBHOOK_ID || !(await pp.verifyWebhook({ headers: request.headers, event, webhookId: env.PAYPAL_WEBHOOK_ID }))) return json({ error: "unverified" }, 401);
        const res = event.resource || {};
        if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && !(await env.LEDGER.get(`pay:${res.id}`))) {
          const orderId = res.supplementary_data?.related_ids?.order_id;
          if (orderId) await recordCapture(env, await pp.getOrder(orderId));
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

      if (url.pathname === "/api/ledger") { const payments = await listPayments(env); return json({ payments, duplicates: possibleDuplicates(payments) }); }

      // Leads the ad export counted but PayPal never saw pay. The agent may draft invoices for them; a person sends.
      if (url.pathname === "/api/leads") return json({ leads: await demoLeads(env, url) });

      if (url.pathname === "/api/invoices" && request.method === "GET") return json({ invoices: await listPrefix(env, "inv:") });

      // Webhooks are the main path, but the sandbox does not always emit INVOICING.INVOICE.PAID: ask PayPal about every
      // sent invoice and record the ones it says are paid (recordInvoicePayment is idempotent per payment id).
      if (url.pathname === "/api/invoices/sync" && request.method === "POST") {
        const open = (await listPrefix(env, "inv:")).filter((i) => i.status === "SENT" || i.status === "PARTIALLY_PAID");
        if (!open.length) return json({ checked: 0, paid: 0, invoices: await listPrefix(env, "inv:") });
        const stop = await guard(env, request, "sync", 30, 300); if (stop) return json({ error: stop }, 429);
        let paid = 0;
        for (const i of open) { const inv = await pp.getInvoice(i.id); if (inv.status === "PAID" || inv.status === "PARTIALLY_PAID") { await recordInvoicePayment(env, inv); paid++; } }
        return json({ checked: open.length, paid, invoices: await listPrefix(env, "inv:") });
      }

      if (url.pathname === "/api/invoices/draft" && request.method === "POST") {
        const { leads: ids = [] } = await request.json();
        const amount = PRODUCT.amount; // fixed server-side, like the checkout price
        const leads = (await demoLeads(env, url)).filter((l) => ids.includes(l.lead));
        if (!leads.length) return json({ error: "No matching leads. Use the exact lead names from the lead list." }, 400);
        const stop = await guard(env, request, "invoices", 10, 60); if (stop) return json({ error: stop }, 429);
        const existing = await listPrefix(env, "inv:");
        const out = [];
        for (const l of leads.slice(0, 6)) {
          const dup = existing.find((i) => i.lead === l.lead && i.status !== "CANCELLED");
          if (dup) { out.push({ ...dup, note: "already drafted" }); continue; }
          const reference = packClick({ ad: l.ad, source: l.source, clickId: l.click_id, clickedAt: 0 }); // the demo leads carry no click time
          const inv = await pp.createDraftInvoice({ email: l.email, name: l.lead, item: PRODUCT.name, amount: String(amount), reference, business: "Kite Robotics Club (demo)",
            note: `You asked about: ${l.asked_for}. Pay with PayPal to book the trial class.` });
          const rec = { id: inv.id, lead: l.lead, ad: l.ad, email: l.email, amount: String(amount), status: inv.status || "DRAFT", reference, created_at: new Date().toISOString() };
          await env.LEDGER.put(`inv:${inv.id}`, JSON.stringify(rec));
          out.push(rec);
        }
        return json({ invoices: out });
      }

      if (url.pathname === "/api/invoices/send" && request.method === "POST") {
        const { id } = await request.json();
        const rec = await env.LEDGER.get(`inv:${id}`, "json");
        if (!rec) return json({ error: "Unknown invoice." }, 404);
        const stop = await guard(env, request, "invoice sends", 6, 40); if (stop) return json({ error: stop }, 429);
        await pp.sendInvoice(id);
        const fresh = await pp.getInvoice(id);
        rec.status = fresh.status; rec.sent_at = new Date().toISOString(); rec.pay_url = (fresh.detail?.metadata?.recipient_view_url) || null;
        await env.LEDGER.put(`inv:${id}`, JSON.stringify(rec));
        return json({ invoice: rec });
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
        if (!["approved", "dismissed"].includes(b.verdict) || !b.ad) return json({ error: "verdict and ad are required" }, 400);
        const at = new Date().toISOString(), id = `D-${Date.now().toString(36).toUpperCase()}`;
        const rec = { id, at, ad: String(b.ad).slice(0, 60), change: String(b.change || "").slice(0, 20), verdict: b.verdict, reason: String(b.reason || "").slice(0, 600), evidence: (b.evidence || []).slice(0, 8).map((e) => String(e).slice(0, 40)) };
        await env.LEDGER.put(`dec:${at}:${id}`, JSON.stringify(rec), { expirationTtl: 2592000 });
        return json(rec);
      }
      if (url.pathname === "/api/decisions") return json({ decisions: (await listPrefix(env, "dec:")).reverse().slice(0, 50) });

      // The browser-side Studio agent framework talks to Claude through this proxy; the key never leaves the Worker.
      if (url.pathname === "/api/ai/turn" && request.method === "POST") {
        const raw = await request.text();
        if (raw.length > 400000) return json({ error: "Request too large." }, 413);
        const stop = await guard(env, request, "assistant turns", 80, Number(env.AI_TURNS_DAILY || 600)); if (stop) return json({ error: stop }, 429);
        const b = JSON.parse(raw);
        // only AG Studio agent turns: Studio always sends its tool definitions; a bare chat request is refused
        if (!Array.isArray(b.tools) || !b.tools.length || !Array.isArray(b.messages)) return json({ error: "Only AG Studio agent turns are accepted." }, 400);
        const model = "claude-sonnet-5-5"; // one model, whatever the page asks for
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : {}) },
          body: JSON.stringify({ model, max_tokens: Math.min(Number(b.max_tokens) || 4000, 6000), system: b.system, messages: b.messages, tools: b.tools, ...(b.tool_choice ? { tool_choice: b.tool_choice } : {}) }),
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
        if (!(await quota(env, "agent", Number(env.AGENT_DAILY || 40)))) return json({ error: "The shared daily agent limit is reached. The reconciliation still works." }, 429);
        const payments = await listPayments(env);
        const rec = reconcile(parseAdCsv(csv).rows, payments);
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined });
        const started = Date.now();
        const out = await runAgent({ llm, rec, payments });
        return json({ ...out, ms: Date.now() - started });
      }

      if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: e.message, paypal: e.paypal || null }, e.status && e.status < 500 ? 400 : 502);
    }
  },
};
