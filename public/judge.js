// Judge path: a recorded live owner request (GET /api/runs/owner), replayed without a Claude turn, and the PayPal capture
// behind its answer read through /api/trail. Text only through textContent; no HTML from the API.
const $ = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) if (k != null) e.append(k); return e; };
const money = (c) => `$${(c / 100).toFixed(2)}`;
const CHANGE = { increase: "Raise the budget", reduce: "Cut the budget", pause: "Pause the ad", keep: "Keep the budget, no raise" };
const NAMES = { free_guide: "Free guide · lead form", trial_video: "Trial class · video", parent_carousel: "Testimonial · carousel", holiday_static: "Holiday camp · static" };
const name = (ad) => NAMES[ad] || ad;
const box = (id) => document.getElementById(id);
const head = (id) => { const s = box(id); const h = s.querySelector("h2"); s.replaceChildren(h); return s; };

async function getJSON(url, init) { const r = await fetch(url, init); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; }

function render(run) {
  // the ad the request is about: the one with the most leads in the ad report
  const target = [...(run.ads || [])].sort((a, b) => b.leads - a.leads)[0];
  if (!target) { head("ask").append($("p", { className: "note", textContent: "The recorded run has no ads to show." })); return; }
  const vs = box("vs").querySelectorAll("b");
  vs[0].textContent = String(target.leads); vs[1].textContent = String(target.paid);
  box("vs").querySelectorAll("span")[0].textContent = `leads the ad report gives ${name(target.ad)}`;

  const ask = head("ask");
  ask.append($("p", { className: "quote", textContent: `“${run.instruction}”` }),
    $("p", { className: "note" }, [$("span", { className: "tag", textContent: "Replay of a recorded live run" }),
      ` Claude ran it on the live PayPal ledger on ${new Date(run.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} in ${(run.ms / 1000).toFixed(1)} s. Replaying spends no Claude turn.`]));
  box("c-live").textContent = `${name(target.ad)}: ${target.leads} leads, ${target.paid} paid order${target.paid === 1 ? "" : "s"} → no raise`;
  box("c-live-why").textContent = "Too few PayPal-confirmed orders for any move; Claude declined the owner's raise and the gate refuses it (step 2).";
  const live = $("button", { className: "btn", type: "button", textContent: "Run it live again (one Claude run)" });
  live.onclick = async () => {
    live.disabled = true; live.textContent = "Claude is reading the payments…";
    try {
      const csv = await (await fetch("/data/demo-ads.csv")).text();
      await getJSON("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv, instruction: run.instruction }) });
      render((await getJSON("/api/runs/owner")).run);
    } catch (e) { live.disabled = false; live.textContent = "Run it live again (one Claude run)"; ask.append($("p", { className: "note err", textContent: e.message })); }
  };
  ask.append($("div", { className: "row" }, [live]));

  const action = (run.recommendation.actions || []).find((a) => a.ad === target.ad);
  const ans = head("answer");
  if (!action) { ans.append($("p", { className: "reason", textContent: run.recommendation.headline })); head("capture"); return; }
  const raised = action.change === "increase";
  ans.append($("p", { className: `verdict ${raised ? "ok" : ""}`, textContent: `${raised ? "Raised" : "Declined"}: ${CHANGE[action.change] || action.change} for ${name(action.ad)}` }),
    $("p", { className: "reason", textContent: action.reason }));
  const move = run.moves?.[target.ad];
  ans.append($("p", { className: "rule" }, move
    ? [$("b", { textContent: "The rule in code: " }), `raise ${move.increase ? "allowed" : "not allowed"}, cut ${move.reduce ? "allowed" : "not allowed"}: ${move.why}.`]
    : [$("b", { textContent: "The rule in code: " }), `no budget moves either way on fewer than 3 PayPal-confirmed paid orders. This ad has ${target.paid}, from ${target.leads} leads (${money(target.revenue_cents)} paid on ${money(target.spend_cents)} of ads). Had Claude agreed to raise it, the gate would have refused the move.`]));
  const cf = $("p", { className: "rule", textContent: "Sending the owner's raise straight to the gate…" });
  ans.append(cf);
  getJSON("/api/judge/counterfactual").then((c) => {
    cf.replaceChildren($("b", { textContent: c.refused.length ? "The raise itself, sent to the gate just now: refused. " : "The raise itself, sent to the gate just now: accepted. " }),
      c.refused.join(" "), $("span", { className: "note", textContent: ` (checked ${new Date(c.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, no Claude turn: the same code that checks every proposal)` }));
  }).catch((e) => { cf.textContent = e.message; });
  const gates = (run.trace || []).filter((s) => s.tool === "submit_recommendation");
  const first = gates[0];
  ans.append($("p", { className: "note", textContent: !run.grounded ? "The evidence gate did not pass this answer." : first && first.problems ? `The evidence gate refused Claude's first answer (${first.why?.join(" ") || "see trace"}); the repaired answer passed.` : "The evidence gate checked every number, capture id and the direction of every move: passed on the first submission." }),
    $("p", { className: "chain", textContent: (run.trace || []).map((s) => s.tool + (s.ad ? `(${s.ad})` : "")).join(" → ") }));

  const ids = (action.evidence || []).filter((e) => !e.startsWith("row:"));
  const cap = head("capture");
  if (!ids.length) { cap.append($("p", { className: "note", textContent: "This answer cites no single payment; the money trail shows any of them." })); return; }
  cap.append($("p", { className: "note", textContent: `Claude cited ${ids.length === 1 ? "this capture" : "these captures"}. PayPal's record is retrieved from PayPal, not from our ledger (cached for up to 10 minutes). Meta's reply only acknowledges the test event; it does not show that Meta matched it or that ads improved.` }));
  for (const id of ids) {
    const card = $("div", {}, [$("p", { className: "note", textContent: `Reading capture ${id} from PayPal…` })]);
    cap.append(card);
    getJSON(`/api/trail?capture=${encodeURIComponent(id)}`).then((t) => {
      const pp = t.paypal || {}, m = t.meta;
      card.replaceChildren($("dl", {}, [
        $("dt", { textContent: "PayPal capture" }), $("dd", {}, [$("code", { textContent: id })]),
        $("dt", { textContent: "PayPal says" }), $("dd", { textContent: pp.error ? `could not read: ${pp.error}` : `${pp.status}, $${pp.amount}${pp.fee ? `, fee $${pp.fee}, net $${pp.net}` : ""}${pp.refunded ? `, refunded $${pp.refunded}` : ""}` }),
        $("dt", { textContent: "Ad click inside it" }), $("dd", {}, pp.custom_id ? [$("code", { textContent: pp.custom_id })] : [t.click?.ad_name || "–"]),
        $("dt", { textContent: "Meta's reply" }), $("dd", { textContent: m?.ok ? `events_received: ${m.events_received}, fbtrace_id ${m.fbtrace_id}${m.test_event ? " (test event)" : ""}` : m?.held ? `not sent: ${m.held}` : "not sent" }),
      ]), $("div", { className: "row" }, [$("a", { className: "btn primary", href: `/trail?capture=${encodeURIComponent(id)}`, textContent: "Follow this payment on the money trail" })]));
    }).catch((e) => card.replaceChildren($("p", { className: "note err", textContent: e.message })));
  }
}

getJSON("/api/runs/owner").then(({ run }) => {
  if (run) return render(run);
  head("ask").append($("p", { className: "note", textContent: "No recorded owner request yet. Open the dashboard and use “Tell it to raise the ad with the most leads”." }));
}).catch((e) => head("ask").append($("p", { className: "note err", textContent: e.message })));

// 4: the same agent and gate on a labelled synthetic week with enough paid orders, replayed from its last live run
getJSON("/api/runs/week").then(({ run }) => {
  const sec = box("week");
  if (!run) { sec.append($("p", { className: "note", textContent: "No synthetic week has been run yet; the dashboard's “Or try a synthetic week” runs one." })); return; }
  sec.append($("p", { className: "reason" }, [$("span", { className: "tag", textContent: `SYNTHETIC: ${run.week.name}` }), ` ${run.week.story}`]));
  const up = (run.recommendation.actions || []).find((a) => a.change === "increase");
  if (up) { box("c-syn").textContent = `${name(up.ad)} → raise`; box("c-syn-why").textContent = "Enough paid orders, and it covers its spend after costs and PayPal fees: the same agent and gate allow the raise (step 4)."; }
  for (const a of run.recommendation.actions || []) {
    const up = a.change === "increase", down = a.change === "reduce" || a.change === "pause";
    sec.append($("p", { className: `verdict ${up ? "ok" : ""}`, style: down || up ? "" : "background:var(--grey-bg);color:var(--grey)", textContent: `${CHANGE[a.change] || a.change}: ${name(a.ad)}` }),
      $("p", { className: "reason", textContent: a.reason }));
  }
  const g = run.grade;
  sec.append($("p", { className: "note", textContent: `Recorded live run, ${new Date(run.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. ${g ? (g.ok ? "Every move matches the week's written answer." : `Against the week's written answer: ${g.wrong?.join(", ") || "a move missing"}.`) : ""} The same evidence gate checked every number and the direction of every move.` }));
}).catch(() => {});
