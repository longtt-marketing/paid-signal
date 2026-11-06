// Invoices (draft, approve, send, sync), the judge path's try-it flow, the revenue and chase agents, double-payment refunds.
// Each block answers one path and returns a Response; a request no block matches returns undefined and goes on to the next group.
import { CLICK_ID, createDraftInvoice, isEvidence, sendToMeta, guard, toolkitTools, utc, json, visitorId, sha, publicInvoice, cachedList, forget, revenueDrafts, listPayments, applyRefund, listPrefix, demoLeads, recordInvoicePayment, tryPaid, publicTry, syncInvoices, CLAUDE_DAILY, claudeGuard, revenueFallback, revenueUnavailable, paypal, possibleDuplicates, anthropicLLM, runSendAgent, SEND_SYSTEM, SEND_TOOLS, runRefundAgent, REFUND_SYSTEM, REFUND_TOOLS, runRevenueAgent, REVENUE_SYSTEM, REVENUE_TOOLS, runChaseAgent, eligibleForReminder, CHASE_SYSTEM, CHASE_TOOLS, CREATOR, heldDuplicates, disputeState, commissionOrders, runPayoutAgent, PAYOUT_SYSTEM, PAYOUT_TOOLS, quota, adName, parseAdCsv } from "../core.js";
import { tryImpact } from "../tryImpact.js";

/** @param {{ request: Request, env: any, url: URL, pp: any, orders: any, ip: string }} c */
export async function route({ request, env, url, pp, orders, ip }) {
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
    // The judge's own invoices ("Be the customer") can run on a second sandbox app, a US business account that accepts
    // PayPal's test cards, so a judge pays without a sandbox login. Off until TRY_PAYPAL_CLIENT_ID/SECRET are set.
    const tryApp = Boolean(env.TRY_PAYPAL_CLIENT_ID && env.TRY_PAYPAL_CLIENT_SECRET);
    const tryEnv = tryApp ? { ...env, PAYPAL_CLIENT_ID: env.TRY_PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET: env.TRY_PAYPAL_CLIENT_SECRET } : env;
    const tpp = tryApp ? paypal({ clientId: env.TRY_PAYPAL_CLIENT_ID, secret: env.TRY_PAYPAL_CLIENT_SECRET }) : pp;

    if (url.pathname === "/api/judge/try/send" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({ error: "Send the invoice id as JSON." }, 400); }
      const rec = /^INV2-[A-Z0-9-]+$/.test(String(body.invoice_id || "")) ? await env.LEDGER.get(`try:${body.invoice_id}`, "json") : null;
      if (!rec || !rec.vid || rec.vid !== visitorId(request)) return json({ error: "Only an invoice Claude drafted for you in this browser can be sent." }, 404);
      if (rec.status !== "DRAFT") return json({ invoice: publicTry(rec) });
      if (!(Number(rec.amount) > 0 && Number(rec.amount) <= 200)) return json({ error: "Only small demo invoices are sent." }, 400);
      const stop = await claudeGuard(env, request, "judge sends", 10, 60); if (stop) return json({ error: stop }, 429);
      const tools = toolkitTools(tryEnv, { invoices: { get: true, send: true } });
      const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: SEND_SYSTEM, tools: SEND_TOOLS });
      let agent;
      try { agent = await runSendAgent({ llm, tools, approved: { id: rec.id, lead: "the judge (as a customer)", ad: rec.ad, amount: String(rec.amount) } }); }
      catch (e) { return json({ error: `The send agent could not run: ${String(e?.message || e).slice(0, 200)}` }, 502); }
      const fresh = await tpp.getInvoice(rec.id);
      Object.assign(rec, { status: fresh.status, invoice_number: fresh.detail?.invoice_number || null, pay_url: fresh.detail?.metadata?.recipient_view_url || null,
        ...(agent.sent && fresh.status && fresh.status !== "DRAFT" ? { sent_at: new Date().toISOString(), sent_by: "send agent (Claude + PayPal Agent Toolkit)" } : {}) });
      await env.LEDGER.put(`try:${rec.id}`, JSON.stringify(rec), { expirationTtl: 60 * 86400 });
      return json({ invoice: publicTry(rec), agent: { summary: agent.summary, trace: agent.trace } });
    }

    // The judge's invoice as PayPal reports it now: read live until it is paid.
    if (url.pathname === "/api/judge/try/status" && request.method === "GET") {
      const id = url.searchParams.get("id") || "";
      let rec = /^INV2-[A-Z0-9-]+$/.test(id) ? await env.LEDGER.get(`try:${id}`, "json") : null;
      if (!rec || rec.vid !== visitorId(request)) return json({ error: "Unknown invoice for this browser." }, 404);
      if (rec.status !== "PAID" && rec.status !== "DRAFT") { try { rec = (await tryPaid(env, await tpp.getInvoice(id), url)) || rec; } catch {} }
      return json({ invoice: publicTry(rec), checked_at: new Date().toISOString() });
    }

    if (url.pathname === "/api/judge/try/impact" && request.method === "GET") {
      const id = url.searchParams.get("id") || "";
      const rec = /^INV2-[A-Z0-9-]+$/.test(id) ? await env.LEDGER.get(`try:${id}`, "json") : null;
      if (!rec || rec.vid !== visitorId(request) || rec.status !== "PAID" || !rec.paid?.payment_id) return json({ error: "Unknown paid invoice for this browser." }, 404);
      const payment = await env.LEDGER.get(`pay:${rec.paid.payment_id}`, "json");
      if (!payment || payment.visitor !== rec.vid || payment.try_invoice !== id) return json({ error: "Payment is not in this browser's ledger." }, 404);
      const [before, after, meta, csv] = await Promise.all([
        listPayments(env), listPayments(env, rec.vid), env.LEDGER.get(`meta:${payment.capture_id}`, "json"),
        env.ASSETS.fetch(new Request(`${url.origin}/data/demo-ads.csv`)).then((r) => r.text()),
      ]);
      const once = await env.LEDGER.get(`commission:v:${rec.vid}:once`, "json");
      let payout = once?.batch_id ? await env.LEDGER.get(`commission:v:${rec.vid}:${once.batch_id}`, "json") : once ? { status: once.state } : null;
      const settled = (b) => ["SUCCESS", "DENIED", "CANCELED", "FAILED", "UNCLAIMED", "RETURNED", "REFUNDED", "BLOCKED"].includes(b?.read_back?.item_status || "");
      if (payout?.batch_id && !settled(payout)) {
        try {
          const out = await tpp.getPayout(payout.batch_id);
          payout.status = out?.batch_header?.batch_status || payout.status;
          payout.read_back = { status: out?.batch_header?.batch_status || null, item_status: out?.items?.[0]?.transaction_status || null,
            time_completed: out?.batch_header?.time_completed || null, transaction_id: out?.items?.[0]?.transaction_id || null, read_at: new Date().toISOString() };
          await env.LEDGER.put(`commission:v:${rec.vid}:${payout.batch_id}`, JSON.stringify(payout));
        } catch {}
      }
      const refund = payment.refund_id ? { id: payment.refund_id, status: payment.status } : null;
      return json(tryImpact({ before, after, adRows: parseAdCsv(csv).rows, payment, meta, payout, refund }));
    }

    if (url.pathname === "/api/judge/try/commission" && request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({ error: "Send the invoice id as JSON." }, 400); }
      const id = String(body.invoice_id || ""), vid = visitorId(request);
      const rec = /^INV2-[A-Z0-9-]+$/.test(id) ? await env.LEDGER.get(`try:${id}`, "json") : null;
      if (!vid || !rec || rec.vid !== vid) return json({ error: "Unknown invoice for this browser." }, 404);
      if (rec.status !== "PAID" || !rec.paid?.payment_id) return json({ error: "PayPal has not confirmed this invoice as paid." }, 400);
      const payment = await env.LEDGER.get(`pay:${rec.paid.payment_id}`, "json");
      if (!payment || payment.visitor !== vid || payment.try_invoice !== id || payment.ad !== CREATOR.ad || payment.status !== "COMPLETED") return json({ error: "The paid order is not in this browser's ledger." }, 400);
      if (Number(payment.refunded_amount || 0) >= Number(payment.amount)) return json({ error: "A refunded order cannot earn commission." }, 400);
      const onceKey = `commission:v:${vid}:once`, lockKey = `commission-lock:v:${vid}`;
      if (await env.LEDGER.get(onceKey)) return json({ error: "This browser has already used its one creator payout." }, 409);
      if (await env.LEDGER.get(lockKey)) return json({ error: "A creator payout for this payment is already running." }, 409);
      const payments = await listPayments(env, vid);
      if (heldDuplicates(payments).has(payment.capture_id)) return json({ error: "A held duplicate payment cannot earn commission." }, 400);
      const orders = commissionOrders(payments, CREATOR, heldDuplicates(payments), {}, disputeState).filter((o) => o.capture_id === payment.capture_id);
      if (!orders[0]?.eligible) return json({ error: orders[0]?.why_not || "This order is not eligible for commission." }, 400);
      if (!(await quota(env, "judge try commission payouts", 15))) return json({ error: "The shared daily limit of 15 judge creator payouts has been reached." }, 429);
      await env.LEDGER.put(lockKey, "1", { expirationTtl: 180 });
      // This permanent marker prevents a second attempt from paying again if PayPal accepted a payout but the reply was lost.
      await env.LEDGER.put(onceKey, JSON.stringify({ state: "running", invoice_id: id, payment_id: payment.capture_id, at: new Date().toISOString() }));
      const program = { ad: CREATOR.ad, ad_name: adName(CREATOR.ad), creator: CREATOR.creator, rate: CREATOR.rate };
      const pay = {
        create: async ({ capture_ids, total, note }) => tpp.createPayout({ batchId: `judge-try-${vid}-${(await sha(payment.capture_id)).slice(0, 12)}`,
          receiver: CREATOR.receiver, value: CREATOR.rate, note: `Commission for one paid judge-path order. ${String(note || "").slice(0, 180)}`,
          subject: "Your Kite Robotics creator commission (demo)", itemId: payment.capture_id.slice(0, 120) }),
        get: (batchId) => tpp.getPayout(batchId),
      };
      const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: PAYOUT_SYSTEM, tools: PAYOUT_TOOLS });
      let agent;
      try { agent = await runPayoutAgent({ llm, pay, program, orders }); }
      catch (e) { await env.LEDGER.delete(lockKey); return json({ error: `The commission agent could not run: ${String(e?.message || e).slice(0, 200)}` }, 502); }
      if (agent.payout?.batch_id) {
        const record = { ...agent.payout, at: new Date().toISOString(), invoice_id: id, payment_id: payment.capture_id,
          paid_by: "commission agent (Claude + PayPal Payouts)" };
        await env.LEDGER.put(`commission:v:${vid}:${agent.payout.batch_id}`, JSON.stringify(record));
        await env.LEDGER.put(onceKey, JSON.stringify({ state: "paid", invoice_id: id, payment_id: payment.capture_id, batch_id: agent.payout.batch_id }));
      } else await env.LEDGER.put(onceKey, JSON.stringify({ state: "unknown", invoice_id: id, payment_id: payment.capture_id, at: new Date().toISOString() }));
      await env.LEDGER.delete(lockKey);
      return json({ payout: agent.payout, summary: agent.summary, trace: agent.trace });
    }

    if (url.pathname === "/api/judge/try" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Send a message as JSON." }, 400); }
      if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 500) return json({ error: "Enter a message of 1 to 500 characters." }, 400);
      const stop = await claudeGuard(env, request, "judge try runs", 12, CLAUDE_DAILY);
      // a judge who used up today's live runs gets a plain answer, not an unrelated saved batch summary
      if (stop) return json({ error: "Today's live Claude runs for this network are used up. The recorded runs on /proof show the same agent; try again tomorrow.", limited: true }, 429);
      // the judge arrives as if from the testimonial ad: a test Meta click made in the browser, so the paid invoice reaches
      // Meta as a Purchase test event and the whole loop (ad click, PayPal, Meta) runs on the judge's own payment
      const ck = body.click && CLICK_ID.test(String(body.click.click_id || "")) ? { source: "fb", click_id: String(body.click.click_id), clicked_at: Math.min(Date.now(), Number(body.click.clicked_at) || Date.now()) } : null;
      const t0 = Date.now(), lead = { lead: "Judge lead", ad: "parent_carousel", source: ck ? "fb" : "other", click_id: ck ? ck.click_id : "", channel: "web", email: "judge-lead@example.com", message: body.message.trim() };
      try {
        const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: REVENUE_SYSTEM, tools: REVENUE_TOOLS });
        const toolkit = toolkitTools(tryEnv, { invoices: { create: true } });
        const createDraft = async (p) => {
          const id = await createDraftInvoice(toolkit, lead, p);
          if (!id) return { error: "PayPal returned no invoice id" };
          await env.LEDGER.put(`try:${id}`, JSON.stringify({ id, vid: visitorId(request), lead: lead.lead, ad: lead.ad, email: lead.email, channel: lead.channel,
            amount: p.total, lines: p.lines, note: p.note, reason: p.reason, ...(ck ? { click: ck } : {}), status: "DRAFT", drafted_by: "revenue agent (Claude) via PayPal Agent Toolkit", created_at: new Date().toISOString() }));
          return { id };
        };
        const run = await runRevenueAgent({ llm, leads: [lead], invoices: [], createDraft });
        const draft = run.proposals[0], skipped = run.skips[0];
        const trace = run.trace.map((s) => ({ ...s, called_by: s.tool === "read_leads" || s.tool === "create_invoice" || s.tool === "skip_lead" ? "Claude" : "code",
          ...(s.tool === "create_invoice" ? { price_set_by: "code" } : {}) }));
        let paypalRecord = null;
        if (draft?.id) {
          try {
            const invoice = await tpp.getInvoice(draft.id);
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
      const tools = toolkitTools(env, { invoices: { get: true, sendReminder: true } });
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
      const tools = toolkitTools(env, { invoices: { get: true, send: true } });
      const llm = anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: SEND_SYSTEM, tools: SEND_TOOLS });
      const approvedAt = new Date().toISOString();
      const agent = await runSendAgent({ llm, tools, approved: { id, lead: rec.lead, ad: rec.ad, amount: String(rec.amount || "49.00") } });
      const fresh = await pp.getInvoice(id);
      Object.assign(rec, { approved_visitor: visitorId(request), status: fresh.status, approved_at: approvedAt, pay_url: fresh.detail?.metadata?.recipient_view_url || rec.pay_url || null,
        // "sent by the agent" only when PayPal itself no longer shows a draft
        ...(agent.sent && fresh.status && fresh.status !== "DRAFT" ? { sent_at: new Date().toISOString(), sent_by: "send agent (Claude + PayPal Agent Toolkit)" } : {}) });
      await env.LEDGER.put(`inv:${id}`, JSON.stringify(rec)); await forget("inv:");
      return json({ invoice: publicInvoice(rec), agent });
    }

    // A person says a flagged pair is two real orders (say, a parent paying for a second child): the second payment counts
    // again as a paid order, for the ad, Meta and the commission. Recorded on the payment with the reason and time.
    if (url.pathname === "/api/duplicates/distinct" && request.method === "POST") {
      const { capture_id, reason } = await request.json();
      const payments = await listPayments(env, visitorId(request));
      if (isEvidence(payments.find((p) => p.capture_id === capture_id))) return json({ error: "That payment is part of the frozen evidence ledger the judge path quotes; try this on a payment you made in the demo shop." }, 403);
      if (!possibleDuplicates(payments).some((d) => d.capture_id === capture_id)) return json({ error: "That capture is not flagged as a likely double payment." }, 400);
      const stop = await guard(env, request, "duplicate reviews", 5, 50); if (stop) return json({ error: stop }, 429);
      const p = await env.LEDGER.get(`pay:${capture_id}`, "json");
      if (!p) return json({ error: "Payment not found." }, 404);
      p.confirmed_distinct = { at: new Date().toISOString(), by: "a person, on the dashboard", reason: String(reason || "a separate order").slice(0, 200) };
      await env.LEDGER.put(`pay:${capture_id}`, JSON.stringify(p)); await forget("pay:");
      // the payment now counts, so Meta hears about it once (still inside Meta's window; same event_id, so never twice)
      const meta = await sendToMeta(env, url, p, { recheckHeld: true });
      return json({ ok: true, capture_id, confirmed_distinct: p.confirmed_distinct, meta });
    }

    // A person approves resolving a likely double payment; the refund agent (Claude + PayPal Agent Toolkit) decides and,
    // if it is one, refunds the second capture in full with create_refund and reads the refund back with get_refund.
    if (url.pathname === "/api/duplicates/refund" && request.method === "POST") {
      const { capture_id } = await request.json();
      const payments = await listPayments(env, visitorId(request));
      if (isEvidence(payments.find((p) => p.capture_id === capture_id))) return json({ error: "That payment is part of the frozen evidence ledger the judge path quotes (its real refund is shown on the judge path); try this on a double payment you made in the demo shop." }, 403);
      const flag = possibleDuplicates(payments).find((d) => d.capture_id === capture_id);
      if (!flag) return json({ error: "That capture is not flagged as a likely double payment (or it is already refunded)." }, 400);
      // one approval at a time per capture, so two clicks cannot refund twice (the toolkit call carries no request id)
      if (await env.LEDGER.get(`refund-lock:${capture_id}`)) return json({ error: "A refund for this capture is already running or done." }, 409);
      const stop = await claudeGuard(env, request, "refund agent", 2, 10); if (stop) return json({ error: stop }, 429);
      await env.LEDGER.put(`refund-lock:${capture_id}`, new Date().toISOString(), { expirationTtl: 3600 });
      const key = async (p) => (p.payer_email_sha256 ? (await sha(`${env.PAYPAL_CLIENT_SECRET}:${p.payer_email_sha256}`)).slice(0, 12) : "unknown");
      const view = async (p) => ({ capture_id: p.capture_id, payer_key: await key(p), ad: p.ad, amount: p.amount, currency: p.currency || "USD", captured_at: utc(p.captured_at) });
      const p1 = payments.find((p) => p.capture_id === flag.first), p2 = payments.find((p) => p.capture_id === capture_id);
      // what the buyer wrote before paying (kept with invoice payments); none stored means the agent is told so and decides on the pair
      const context = [p1?.buyer_message, p2?.buyer_message].filter(Boolean).map(String);
      const pair = { first: await view(p1), second: await view(p2), seconds: flag.seconds, context };
      const tools = toolkitTools(env, { payments: { createRefund: true, getRefunds: true } });
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
      const tools = { create_refund: { execute: async () => JSON.stringify({ id: "SIMULATED", status: "SIMULATED", note: "simulated on the judge path: no refund was sent to PayPal and no money moved" }) },
        get_refund: { execute: async (a) => JSON.stringify({ id: a.refund_id, status: "SIMULATED", amount: { value: "49.00", currency_code: "USD" }, note: "simulated: not a PayPal refund" }) } };
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

}
