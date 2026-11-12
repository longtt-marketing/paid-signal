// The budget agent, the evidence gate, reconciliation of an uploaded export, and the AG Studio Claude proxy.
// Each block answers one path and returns a Response; a request no block matches returns undefined and goes on to the next group.
import { OWNER_ASK, STUDIO_TOOLS, json, visitorId, publicMeta, saveRecommendation, listPayments, cleanTurns, heldDuplicates, metaFromLedger, guard, claudeGuard, budgetFallback, budgetUnavailable, parseAdCsv, reconcile, googleRows, paybackOdds, supportedMoves, runAgent, anthropicLLM, checkRecommendation, scenario, grade, listPrefix, CREATOR, SEEDED_BEFORE, isEvidence, applyRefund, ordersSdk } from "../core.js";

/** @param {{ request: Request, env: any, url: URL, pp: any, orders: any, ip: string }} c */
export async function route({ request, env, url, pp, orders, ip }) {
    if (url.pathname === "/api/agent-requests" && request.method === "GET") return json({ requests: (await listPrefix(env, "agentreq:")).sort((a,b) => String(b.at).localeCompare(String(a.at))) });
    if (url.pathname === "/api/agent-requests/decide" && request.method === "POST") {
      const { id, decision } = await request.json();
      if (typeof id !== "string" || !/^AR-[0-9a-f-]{36}$/i.test(id) || !["approve", "decline"].includes(decision)) return json({ error: "Invalid request decision." }, 400);
      const key = `agentreq:${id}`, rec = await env.LEDGER.get(key, "json"); if (!rec) return json({ error: "Unknown request." }, 404);
      if (rec.status !== "pending") return json({ request: rec, idempotent: true });
      const stop = await guard(env, request, "agent request decisions", 10, 100); if (stop) return json({ error: stop }, 429);
      const mark = crypto.randomUUID(); await env.LEDGER.put(key, JSON.stringify({ ...rec, deciding: mark }));
      const locked = await env.LEDGER.get(key, "json"); if (locked?.deciding !== mark) return json({ error: "This request is already being decided." }, 409);
      if (decision === "decline") { const done = { ...rec, status: "declined", decided_at: new Date().toISOString() }; await env.LEDGER.put(key, JSON.stringify(done)); return json({ request: done }); }
      if (rec.kind === "refund") {
        const stopRefund = await guard(env, request, "refunds", 3, 30); if (stopRefund) { await env.LEDGER.put(key, JSON.stringify(rec)); return json({ error: stopRefund }, 429); }
        const agent = await env.LEDGER.get(`agentpay:${rec.capture_id}`, "json"), pay = agent || await env.LEDGER.get(`pay:${rec.capture_id}`, "json");
        if (!pay) { await env.LEDGER.put(key, JSON.stringify(rec)); return json({ error: "Unknown capture." }, 404); }
        if (!agent && (isEvidence(pay) || String(pay.captured_at) < SEEDED_BEFORE)) { const done = { ...rec, status: "approved", paypal: { preview: true, message: "Frozen demo evidence is previewed; no refund was sent." }, decided_at: new Date().toISOString() }; await env.LEDGER.put(key, JSON.stringify(done)); return json({ request: done }); }
        const rem = Math.max(0, Number(pay.amount) - Number(pay.refunded_amount || 0)); if (!rem) { const done = { ...rec, status: "approved", paypal: { status: "already_refunded" }, decided_at: new Date().toISOString() }; await env.LEDGER.put(key, JSON.stringify(done)); return json({ request: done }); }
        const refunder = pay.try_invoice && env.TRY_PAYPAL_CLIENT_ID && env.TRY_PAYPAL_CLIENT_SECRET ? ordersSdk({ clientId: env.TRY_PAYPAL_CLIENT_ID, secret: env.TRY_PAYPAL_CLIENT_SECRET }) : orders;
        const refundRequestId = `ar-ref-${id.slice(3).replace(/-/g, "").slice(0, 24)}`;
        const refund = await refunder.refundCapture(rec.capture_id, { amount: rem.toFixed(2), requestId: refundRequestId });
        if (agent) { agent.refunded_amount = Math.min(Number(pay.amount), Number(pay.refunded_amount || 0) + Number(refund.amount?.value || rem)).toFixed(2); agent.refund_id = refund.id; agent.refund_status = refund.status; agent.status = Number(agent.refunded_amount) >= Number(agent.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED"; await env.LEDGER.put(`agentpay:${rec.capture_id}`, JSON.stringify(agent)); }
        else { await env.LEDGER.put(`seen:${refund.id}`, "1"); await applyRefund(env, rec.capture_id, refund.amount?.value || rem, refund.create_time); }
        const done = { ...rec, status: "approved", decided_at: new Date().toISOString(), paypal: { refund_id: refund.id, status: refund.status, amount: refund.amount?.value || rem.toFixed(2) } }; await env.LEDGER.put(key, JSON.stringify(done)); return json({ request: done });
      }
      if (rec.kind === "commission") {
        const stopPay = await guard(env, request, "agent commission payouts", 3, 15); if (stopPay) { await env.LEDGER.put(key, JSON.stringify(rec)); return json({ error: stopPay }, 429); }
        const current = await Promise.all((rec.capture_ids || []).map((cid) => env.LEDGER.get(`agentpay:${cid}`, "json")));
        if (!current.length || current.some((p) => !p || p.agent_name !== rec.agent_name || p.status !== "COMPLETED" || Number(p.refunded_amount || 0) >= Number(p.amount || 0) || p.commission_paid)) { await env.LEDGER.put(key, JSON.stringify(rec)); return json({ error: "Commission eligibility changed; request was not paid." }, 409); }
        const batchId = `agent-${id.slice(3).replace(/-/g, "").slice(0, 20)}`;
        const payout = await pp.createPayout({ batchId, receiver: CREATOR.receiver, recipientType: "PAYPAL_ID", value: rec.amount, note: `Agent commission for ${current.length} confirmed orders`, subject: "Paid Signal agent commission", itemId: id });
        const batch = payout.batch_header?.payout_batch_id || batchId; const read = await pp.getPayout(batch);
        current.forEach((p) => { p.commission_paid = batch; }); await Promise.all(current.map((p) => env.LEDGER.put(`agentpay:${p.capture_id}`, JSON.stringify(p))));
        const done = { ...rec, status: "approved", decided_at: new Date().toISOString(), paypal: { batch_id: batch, status: read.batch_header?.batch_status || payout.batch_header?.batch_status || null } }; await env.LEDGER.put(key, JSON.stringify(done)); return json({ request: done });
      }
      await env.LEDGER.put(key, JSON.stringify(rec)); return json({ error: "Unknown request kind." }, 400);
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
      // Studio resends the same long instructions and tool list every turn: cache them so later turns start sooner
      const sys = String(b.system || "");
      const tools = b.tools.map((t, i) => (i === b.tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
      const body = JSON.stringify({ model, max_tokens: Math.min(Number(b.max_tokens) || 3000, 4000), ...(sys ? { system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }] } : {}),
        // this model refuses a forced tool_choice ("tool" or "any"); Studio asks for one on some steps, so those run as auto
        messages: cleanTurns(b.messages), tools, ...(b.tool_choice && !["tool", "any"].includes(b.tool_choice.type) ? { tool_choice: b.tool_choice } : {}) });
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
      const payments = await listPayments(env, visitorId(request));
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
      const payments = await listPayments(env, visitorId(request));
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
      const payments = week ? week.payments : await listPayments(env, visitorId(request));
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

}
