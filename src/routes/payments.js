// Checkout, capture, refunds, PayPal webhooks, the money trail and the ledger.
// Each block answers one path and returns a Response; a request no block matches returns undefined and goes on to the next group.
import { ordersSdk, isEvidence, visitorId, utc, PRODUCT, AD_KEYS, CLICK_ID, json, sha, publicLead, cachedList, applyDispute, listPayments, recordCapture, sendToMeta, applyRefund, heldDuplicates, SEEDED_BEFORE, demoLeads, recordInvoicePayment, tryPaid, guard, paypal, packClick, parseAdCsv, reconcile, possibleDuplicates, paybackOdds, disputeState, supportedMoves, adName } from "../core.js";

/** @param {{ request: Request, env: any, url: URL, pp: any, orders: any, ip: string }} c */
export async function route({ request, env, url, pp, orders, ip }) {
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
      let record = await recordCapture(env, order, request.headers.get("user-agent"), visitorId(request));
      // a 2xx whose body lacked the capture (the SDK's schema check failed on it) is read back from PayPal before recording
      if (!record) { order = await orders.getOrder(order_id); record = await recordCapture(env, order, request.headers.get("user-agent"), visitorId(request)); }
      const meta = await sendToMeta(env, url, record);
      return json({ status: order.status, payment: record, meta });
    }

    if (url.pathname === "/api/refund" && request.method === "POST") {
      const { capture_id, amount } = await request.json();
      const cur = await env.LEDGER.get(`pay:${capture_id}`, "json");
      // a visitor sees and refunds only the evidence ledger (previewed below) and their own payments, never another visitor's
      if (!cur || !(isEvidence(cur) || cur.visitor === visitorId(request))) return json({ error: "Unknown capture." }, 404);
      const left = (Math.round(Number(cur.amount) * 100) - Math.round(Number(cur.refunded_amount || 0) * 100)) / 100;
      if (amount !== undefined && !(Number(amount) > 0 && Number(amount) <= left)) return json({ error: `Refund between $0.01 and $${left.toFixed(2)}.` }, 400);
      // the seeded demo payments carry the scenarios page and the dashboard story through judging: preview, don't send
      const partial = amount !== undefined && Number(amount) < left;
      if (isEvidence(cur) && cur.visitor !== visitorId(request)) return json({ preview: true, message: `Capture ${capture_id} is part of the frozen evidence ledger the judge path quotes, so a refund here is only previewed. Pay in the demo shop and refund your own payment to see a real sandbox refund.` });
      if (String(cur.captured_at) < SEEDED_BEFORE) return json({ preview: true, message: `Capture ${capture_id} is one of the demo's seeded sandbox payments, so this refund is only previewed: its ad would lose $${amount ?? left} of paid revenue, and ${partial ? (cur.source === "g" ? "its Google row would become a restatement" : "its paid revenue would drop here; a Meta event already sent keeps its value, as Meta's Conversions API has no retraction") : (cur.source === "g" ? "its Google row would become a retraction" : "its Meta event would be held back if not yet sent; one already sent stays, as Meta's Conversions API has no retraction")}. To run a real sandbox refund, pay in the demo shop and refund that payment.` });
      const stop = await guard(env, request, "refunds", 3, 30); if (stop) return json({ error: stop }, 429);
      // the same refund retried (double click, network retry) carries the same request id, so PayPal applies it once
      const refundKey = `refund-${capture_id}-${amount === undefined ? "full" : Number(amount).toFixed(2)}-${cur.refunded_amount || "0.00"}`;
      // a judge's own try payment was taken by the try app when one is set; refund it through the same app
      const refunder = cur.try_invoice && env.TRY_PAYPAL_CLIENT_ID && env.TRY_PAYPAL_CLIENT_SECRET ? ordersSdk({ clientId: env.TRY_PAYPAL_CLIENT_ID, secret: env.TRY_PAYPAL_CLIENT_SECRET }) : orders;
      const r = await refunder.refundCapture(capture_id, { amount: amount === undefined ? undefined : Number(amount).toFixed(2), requestId: refundKey });
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
    // Verify with PayPal: every payment in the evidence ledger read back from PayPal now (invoice payments through
    // Invoicing v2, checkout captures through the server SDK), compared on amount and refund state. Cached 10 minutes.
    if (url.pathname === "/api/verify") {
      const cached = await env.LEDGER.get("verify:last", "json");
      if (cached && Date.now() - Date.parse(cached.checked_at) < 600000) return json({ ...cached, cached: true });
      const stop = await guard(env, request, "PayPal readbacks", 20, 300); if (stop) return json({ error: stop }, 429);
      const payments = (await listPayments(env)).filter(isEvidence);
      const items = await Promise.all(payments.map(async (p) => {
        const ledgerRefunded = Number(p.refunded_amount || 0) >= Number(p.amount);
        try {
          let status, amount, read;
          if (p.via === "invoice") { const inv = await pp.getInvoice(p.order_id); status = inv.status; amount = inv.amount?.value; read = "Invoicing v2"; }
          else { const c = await orders.getCapture(p.capture_id); status = c.status; amount = c.amount?.value; read = "Payments v2 (server SDK)"; }
          const paypalRefunded = /REFUNDED/.test(String(status)) && !/PARTIALLY/.test(String(status));
          const match = Number(amount) === Number(p.amount) && (paypalRefunded === ledgerRefunded || (p.via === "invoice" && !ledgerRefunded && status === "PAID"));
          return { id: p.capture_id, kind: p.via === "invoice" ? "invoice payment" : "checkout capture", ad: p.ad || null, amount: p.amount, ledger: ledgerRefunded ? "refunded" : Number(p.refunded_amount || 0) > 0 ? "partly refunded" : "paid", paypal: status, read, match };
        } catch (e) { return { id: p.capture_id, kind: p.via === "invoice" ? "invoice payment" : "checkout capture", amount: p.amount, ledger: ledgerRefunded ? "refunded" : "paid", paypal: null, error: String(e?.message || e).slice(0, 120), match: false }; }
      }));
      const out = { checked_at: new Date().toISOString(), total: items.length, matched: items.filter((i) => i.match).length, items };
      await env.LEDGER.put("verify:last", JSON.stringify(out), { expirationTtl: 3600 });
      return json(out);
    }

    if (url.pathname === "/api/trail") {
      const [payments, metas] = await Promise.all([listPayments(env, visitorId(request)), cachedList(env, "meta:")]);
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
        payments: payments.map((x) => ({ capture_id: x.capture_id, ad_name: x.ad ? adName(x.ad) : "No ad click", amount: x.amount, captured_at: x.captured_at, via: x.via || "checkout", status: x.status, refunded_amount: x.refunded_amount || "0.00",
          meta: metaBy[x.capture_id]?.ok ? (x.source === "g" ? "Google click, sent in backfill before the Google-only rule; not counted" : metaBy[x.capture_id].backfill ? "sent in backfill" : "sent at capture") : metaBy[x.capture_id]?.held ? `held (${metaBy[x.capture_id].held})` : "not sent" })),
      });
    }

    if (url.pathname === "/api/ledger") {
      const [payments, meta] = await Promise.all([listPayments(env, visitorId(request)), cachedList(env, "meta:")]);
      // the payer's email hash stays on the server (duplicate check, Meta match); the public ledger gets a salted key that
      // only says "same payer" and cannot be checked against a guessed email
      const keyed = await Promise.all(payments.map(async ({ payer_email_sha256, user_agent, psid, lead_id, ...p }) => ({ ...p, ...(p.refunded_at ? { refunded_at: utc(p.refunded_at) } : {}), clicked_at: p.clicked_at || null, payer_key: payer_email_sha256 ? (await sha(`${env.PAYPAL_CLIENT_SECRET}:${payer_email_sha256}`)).slice(0, 12) : null })));
      // a Google-click buyer sent to Meta before Google buyers were routed to Google only: still a fact, no longer counted
      const source = Object.fromEntries(payments.map((p) => [p.capture_id, p.source]));
      // Meta's answers only for the payments this visitor can see, so no other visitor's capture id leaks through them
      const sends = meta.filter((m) => m.capture_id in source).map((m) => (m.ok && source[m.capture_id] === "g" ? { ...m, superseded: "Google click, sent before Google buyers went to Google only" } : m));
      return json({ payments: keyed,
        duplicates: possibleDuplicates(payments), meta: sends, meta_live: Boolean(env.META_CAPI_TOKEN && env.META_DATASET_ID) });
    }

    // Leads the ad export counted but PayPal never saw pay. The agent may draft invoices for them; a person sends.
    // the email stays on the server (the invoice goes to it); the public list shows who wrote what, not where
    if (url.pathname === "/api/leads") return json({ leads: (await demoLeads(env, url)).map(publicLead) });
    if (url.pathname === "/data/demo-leads.csv") return json({ error: "Not found" }, 404); // read only through ASSETS, above

}
