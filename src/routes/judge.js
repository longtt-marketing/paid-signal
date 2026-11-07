// Commission payouts, PayPal cross-checks, decisions and the judge path's read-only replays.
// Each block answers one path and returns a Response; a request no block matches returns undefined and goes on to the next group.
import { RULE_SINCE, utc, AD_KEYS, json, visitorId, sha, cachedList, forget, syncDisputes, listPayments, heldDuplicates, CREATOR, commissionState, listPrefix, demoLeads, guard, claudeGuard, paypal, parseAdCsv, reconcile, disputeState, anthropicLLM, checkRecommendation, runPayoutAgent, commissionOrders, PAYOUT_SYSTEM, PAYOUT_TOOLS, scenario, adName } from "../core.js";
import { agentActions, readBackStatus } from "../agentActions.js";

/** @param {{ request: Request, env: any, url: URL, pp: any, orders: any, ip: string }} c */
export async function route({ request, env, url, pp, orders, ip }) {
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

    // Every thing an agent wrote to PayPal, each read back from PayPal now (cached ten minutes): the Studio page
    // "Agents → PayPal" shows PayPal's own status next to what the agent did.
    if (url.pathname === "/api/agent-actions") {
      const cached = await env.LEDGER.get("actions:v3", "json");
      // ?fresh=1 after an agent acted (the Nudge button): read PayPal again now, within the same rate limit
      if (cached && !url.searchParams.has("fresh") && Date.now() - Date.parse(cached.checked_at) < 600000) return json({ ...cached, cached: true });
      const stop = await guard(env, request, "PayPal readbacks", 20, 300); if (stop) return json(cached ? { ...cached, cached: true, stale: true, note: stop } : { error: stop }, cached ? 200 : 429);
      const startedAt = new Date().toISOString();
      const [invoices, payments, payouts] = await Promise.all([cachedList(env, "inv:"), listPayments(env), cachedList(env, "commission:")]);
      const list = agentActions({ invoices, payments, payouts }).slice(0, 40);
      const reads = new Map();
      const read = (a) => {
        const k = `${a.kind}:${a.id}`;
        // one more try when PayPal answers with an empty or failed response; a second failure is shown as not read
        const get = () => (a.kind === "invoice" ? pp.getInvoice(a.id) : a.kind === "refund" ? pp.getRefund(a.id) : pp.getPayout(a.id));
        if (!reads.has(k)) reads.set(k, get().catch(get).then((b) => readBackStatus(a.kind, b)).catch((e) => ({ status: null, error: String(e?.message || e).slice(0, 120) })));
        return reads.get(k);
      };
      const items = await Promise.all(list.map(async (a) => ({ ...a, paypal: await read(a) })));
      const out = { checked_at: new Date().toISOString(), total: items.length, read_back: items.filter((i) => i.paypal.status).length,
        moved: Math.round(items.filter((i) => i.kind !== "invoice").reduce((n, i) => n + i.amount, 0) * 100) / 100, items };
      // two reads at once: the one that started later wins, so an older list never overwrites a newer one
      out.started_at = startedAt;
      const now = await env.LEDGER.get("actions:v3", "json");
      if (!now || !now.started_at || now.started_at <= startedAt) await env.LEDGER.put("actions:v3", JSON.stringify(out), { expirationTtl: 3600 });
      return json(out);
    }

    // Cross-check the webhook ledger against PayPal's own transaction history.
    if (url.pathname === "/api/paypal-check") {
      const end = new Date(), start = new Date(end.getTime() - 30 * 86400000);
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

}
