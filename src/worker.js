// Paid Signal Worker. Secrets: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID),
// PAYPAL_WEBHOOK_ID once the webhook is registered. KV LEDGER holds sandbox captures (no raw email, only its hash).
// This file only wires things together: shared pieces are in src/core.js, routes in src/routes/*.js.
import { json, visitorId, addVisitorCookie, withVisitorCookie, forget, indexedKV, revenueDrafts, syncDisputes, firstPaint, cleanTurns, withPageHeaders, mcpTool, listPrefix, syncInvoices, CLAUDE_DAILY, quota, paypal, ordersSdk, handleMcp } from "./core.js";
import { route as payments } from "./routes/payments.js";
import { route as invoices } from "./routes/invoices.js";
import { route as judge } from "./routes/judge.js";
import { route as agents } from "./routes/agents.js";
export { cleanTurns } from "./core.js";

// routes that spend Claude turns or move sandbox money answer only this site's own pages, which always send their Origin
const SAME_SITE_ONLY = new Set([
  "/api/ai/turn",
  "/api/judge/try",
  "/api/invoices/approve",
  "/api/refund",
  "/api/duplicates/refund",
  "/api/commissions/pay",
  "/api/agent-requests/decide",
  "/api/judge/try/send",
  "/api/judge/try/commission",
  "/api/judge/refund-try",
  "/api/decisions",
  "/api/duplicates/distinct",
]);

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
      if ((SAME_SITE_ONLY.has(url.pathname) || url.pathname.startsWith("/api/agent")) && origin !== url.origin)
        return json({ error: "Only the Paid Signal page can call this." }, 403);
      if (env.BURST && !(await env.BURST.limit({ key: ip })).success) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
    }
    try {
      const c = { request, env, url, pp, orders, ip };
      for (const group of [payments, invoices, judge, agents]) { const res = await group(c); if (res) return res; }

      if (url.pathname === "/mcp") {
        if (request.method !== "POST") return new Response("Paid Signal MCP server: POST JSON-RPC here (streamable HTTP, JSON responses).", { status: 405, headers: { allow: "POST" } });
        const body = await request.json();
        if (Array.isArray(body) && body.length > 5) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "At most 5 requests per batch." } }, 400);
        const call = (name, args) => mcpTool(env, url, name, args, (req, e) => app.fetch(req, e), request);
        const out = Array.isArray(body) ? (await Promise.all(body.map((m) => handleMcp(m, call)))).filter(Boolean) : await handleMcp(body, call);
        return out === null || (Array.isArray(out) && !out.length) ? new Response(null, { status: 202 }) : json(out);
      }

      if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      if (url.pathname === "/" && request.method === "GET") return withPageHeaders(await firstPaint(env, url, await env.ASSETS.fetch(request)));
      // /studio: the same app opened straight on the AG Studio report, for judges; it reads only (no invoice sync on open)
      if (url.pathname === "/studio" && request.method === "GET") return withPageHeaders(await firstPaint(env, url, await env.ASSETS.fetch(new Request(new URL("/", url), request))));
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
  async fetch(request, env0) {
    const env = { ...env0, LEDGER: indexedKV(env0.LEDGER) }; // KV listings come from an index (src/core.js)
    const current = visitorId(request);
    const id = current || crypto.randomUUID();
    const incoming = current ? request : addVisitorCookie(request, id);
    const response = await app.fetch(incoming, env);
    return withVisitorCookie(request, response, id, !current);
  },
  scheduled: (event, env0, ctx) => app.scheduled(event, { ...env0, LEDGER: indexedKV(env0.LEDGER) }, ctx),
};
export default worker;
