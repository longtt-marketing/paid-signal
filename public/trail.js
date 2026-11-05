// Money trail: one payment, step by step, from /api/trail. Each step is a card of rows; notes sit in a Details fold.
// Text only through textContent; no HTML from the API.
const $ = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) if (k != null && k !== false) e.append(k); return e; };
const when = (v) => (v ? new Date(typeof v === "number" ? v : Date.parse(v)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–");
const money = (v, c = "USD") => (v == null ? "–" : `$${Number(v).toFixed(2)}${c && c !== "USD" ? ` ${c}` : ""}`);
const chip = (text, tone = "neu") => $("span", { className: `chip ${tone}`, textContent: text });
const rows = (list) => $("div", { className: "rows" }, list.filter(Boolean).map(([l, v]) => $("div", { className: "row" }, [$("span", { className: "l", textContent: l }), typeof v === "string" ? $("span", { className: "v", textContent: v }) : $("span", { className: "v" }, v), $("span")])));
const code = (v) => (v ? $("code", { textContent: String(v) }) : "–");
const details = (title, text) => $("details", { className: "det" }, [$("summary", { textContent: title }), ...[].concat(text).map((t) => (typeof t === "string" ? $("p", { textContent: t }) : $("p", {}, t)))]);
const step = (n, title, sub, tag, body) => $("section", { className: "sec" }, [
  $("div", { className: "hd" }, [$("span", { className: "no", textContent: n }), $("h2", { textContent: title }), tag]),
  sub ? $("p", { className: "sub", textContent: sub }) : null,
  $("div", { className: "card" }, body)]);
function fmtSecs(s) { return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`; }

async function show(id) {
  const box = document.getElementById("trail");
  box.replaceChildren($("div", { className: "card" }, [$("span", { className: "ps-note", textContent: "Reading PayPal, Meta and the ledger…" })]));
  let d;
  try { const r = await fetch(`/api/trail${id ? `?capture=${encodeURIComponent(id)}` : ""}`); d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); }
  catch (e) { box.replaceChildren($("div", { className: "card" }, [$("span", { className: "ps-note", textContent: `Could not load the trail: ${e.message}` })])); return; }
  picker(d);
  const { payment: p, click: c, paypal: pp, meta: m, timings: t, ad_row: a } = d;
  const inv = p.via === "invoice", channel = p.channel || "web";
  const leadPath = channel === "messenger" ? "Messenger conversation" : channel === "lead_form" ? "Meta lead form" : "website click";
  const out = [];

  out.push(step("1", inv ? "The lead" : "The ad click", !c.ad ? "No ad on this payment." : inv ? `${c.source === "g" ? "Google" : "Meta"} lead from a ${leadPath}; the ad stays with the invoice.` : `${c.source === "g" ? "Google" : "Meta"} ad; the click rides inside the PayPal order.`,
    t.click_to_capture_s != null ? chip(`paid ${fmtSecs(t.click_to_capture_s)} later`) : null,
    [rows([["Ad", c.ad_name || "–"], inv ? ["Lead channel", leadPath] : ["Click id", code(c.click_id)], !inv && ["Clicked", when(c.clicked_at)]]),
      ...(c.ad && !inv ? [details("How the click travels", [["Packed into the order's custom_id as ", code(`a=${c.ad};s=${c.source};c=${c.click_id};t=${c.clicked_at || 0}`), "."]])] : [])]));

  const counted = p.status === "COMPLETED" && !(Number(p.refunded_amount) >= Number(p.amount)) && p.dispute_state !== "open" && p.dispute_state !== "lost";
  out.push(step("2", "PayPal confirms the money", inv ? `PayPal invoice, paid after a ${leadPath.toLowerCase()}.` : "PayPal Checkout, captured by the server SDK.",
    chip(pp?.status || (counted ? "Paid" : "Not counted"), counted ? "ok" : "no2"),
    pp?.error ? [rows([["PayPal", `Could not be read just now: ${pp.error}`]])] : [rows([
      ["Amount", money(pp?.amount, pp?.currency)],
      inv ? ["Invoice", code(pp?.invoice_id)] : ["Capture", code(p.capture_id)],
      inv ? ["Paid on", pp?.paid_at || "–"] : ["Captured", when(pp?.create_time)],
      pp?.fee && ["PayPal fee / net", `${money(pp.fee)} / ${money(pp.net)}`],
      Number(p.refunded_amount) > 0 && ["Refunded", `${money(p.refunded_amount)}${p.refunded_by ? ` by the ${p.refunded_by}` : ""}`],
      p.dispute && ["Dispute", `${p.dispute.status}${p.dispute.outcome ? ` · ${p.dispute.outcome}` : ""} (${p.dispute_state})`],
      p.held_as_duplicate && ["Held", "Possible duplicate: same payer, same ad, minutes apart"]]),
      details("Source", [`Read from PayPal ${pp?.read_at ? when(pp.read_at) : ""} with ${pp?.read || "the PayPal API"} (asked again at most every 10 minutes). ${inv ? `The ledger recorded it ${when(p.captured_at)}, when PayPal's invoice record showed it paid.` : `The ledger recorded it ${when(p.captured_at)} from the capture response and a signature-verified webhook.`}${pp?.custom_id ? ` custom_id: ${pp.custom_id}.` : ""}${p.refund_id ? ` Refund ${p.refund_id}.` : ""}`])]));

  let metaTag, metaBody;
  if (!m) { metaTag = chip("Not sent"); metaBody = [rows([["Meta", "Nothing sent for this payment"]])]; }
  else if (m.ok) {
    metaTag = chip(t.capture_to_meta_s != null && t.capture_to_meta_s >= 0 && !inv ? `${fmtSecs(t.capture_to_meta_s)} after capture` : m.backfill ? "Backfill" : "Received", "ok");
    metaBody = [rows([["Event", `Purchase, ${money(m.value)}`], ["Meta answered", `events_received: ${m.events_received ?? "–"}`], ["Sent", when(m.at)], ["Mode", m.test_event ? "Test event (this demo)" : "Live"]]),
      details("Ids and limits", [`event_id ${m.event_id}, fbtrace_id ${m.fbtrace_id}.`, m.superseded ? "A Google click, sent to Meta in the backfill before Google buyers were routed to Google only: not counted as a Meta purchase." : m.backfill ? "Sent later, in a backfill, when the live link to Meta was switched on." : "Sent the moment PayPal confirmed the payment.", "events_received proves receipt only, not that Meta matched the event to an ad. Meta has no retraction: a refund comes off the ledger here, not at Meta."])];
  } else { metaTag = chip("Held", "held"); metaBody = [rows([["Meta", m.held ? `Held back: ${m.held}` : `Not accepted: ${m.error || "no answer"}`]])]; }
  out.push(step("3", "Meta receives the purchase", "Conversions API, the shop's own dataset.", metaTag, metaBody));

  if (a) out.push(step("4", "What it changes for the ad", `${c.ad_name}: the budget reads paid orders, not leads.`,
    chip(a.move && (a.move.increase || a.move.reduce) ? [a.move.increase && "Raise allowed", a.move.reduce && "Cut allowed"].filter(Boolean).join(" · ") : "Keep only", a.move?.increase ? "ok" : "neu"),
    [rows([["Leads → paid orders", `${a.leads} → ${a.paid_orders}`], ["Spend / paid revenue", `${money(a.spend)} / ${money(a.paid_revenue)}`], ["Paid revenue per $1", a.per_dollar ? money(a.per_dollar) : "–"],
      a.chance_covers_spend != null && ["Covers its spend", `${a.chance_covers_spend}% chance`], a.cut_after && ["Cut point", `If the next ${money(a.cut_after)} brings no paid order`]]),
      details("How the rule reads it", ["The chance is computed in code from this ad's paid orders per dollar, with a prior worth one order, against the shop's average paid order. A raise needs 3 paid orders and paid revenue above spend; the cut point says when a raise is taken back. The budget agent may only quote these numbers, and code refuses a move they do not support."])]));
  box.replaceChildren(...out);
  history.replaceState(null, "", `/trail?capture=${encodeURIComponent(p.capture_id)}`);
}

let drawn = false;
function picker(d) {
  const sel = document.getElementById("picker");
  if (!drawn) {
    drawn = true;
    sel.replaceChildren(...d.payments.slice().reverse().map((x) => $("option", { value: x.capture_id, textContent: `${x.ad_name} · ${money(x.amount)} · ${x.via === "invoice" ? "invoice" : "checkout"}` })));
    sel.onchange = () => show(sel.value);
  }
  sel.value = d.payment.capture_id;
}

show(new URLSearchParams(location.search).get("capture"));
