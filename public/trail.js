// Money trail: one payment, step by step, from /api/trail. Text only through textContent; no HTML from the API.
const $ = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) if (k != null) e.append(k); return e; };
const when = (v) => (v ? new Date(typeof v === "number" ? v : Date.parse(v)).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" }) : "–");
const money = (v, c = "USD") => (v == null ? "–" : `$${Number(v).toFixed(2)}${c && c !== "USD" ? ` ${c}` : ""}`);
const code = (v) => (v ? $("code", { textContent: String(v) }) : "–");
const dl = (rows) => $("dl", {}, rows.filter(Boolean).flatMap(([k, v]) => [$("dt", { textContent: k }), $("dd", {}, v ?? "–")]));
const gap = (text, cls = "") => $("span", { className: `gap ${cls}`, textContent: text });
const step = (n, cls, title, who, body, tag) => $("li", { className: `step ${cls}` }, [$("div", { className: "dot", textContent: n }),
  $("div", { className: "card" }, [$("h2", {}, [title, tag]), $("p", { className: "who", textContent: who }), ...[].concat(body)])]);

async function show(id) {
  const box = document.getElementById("trail");
  box.replaceChildren($("li", { className: "skel", textContent: "Reading PayPal, Meta and the ledger…" }));
  let d;
  try { const r = await fetch(`/api/trail${id ? `?capture=${encodeURIComponent(id)}` : ""}`); d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); }
  catch (e) { box.replaceChildren($("li", { className: "err", textContent: `Could not load the trail: ${e.message}` })); return; }
  picker(d);
  const { payment: p, click: c, paypal: pp, meta: m, timings: t, ad_row: a } = d;
  const steps = [];

  const inv = p.via === "invoice";
  steps.push(step("1", "", "Ad click", !c.ad ? "No ad click on this payment" : inv ? `${c.source === "g" ? "Google" : "Meta"} ad · the lead came from it; the click is kept with the invoice in the shop's ledger` : `${c.source === "g" ? "Google" : "Meta"} ad · carried into PayPal inside the order's custom_id`,
    dl([["Ad", c.ad_name || "–"], ["Click id", code(c.click_id)], ["Clicked", when(c.clicked_at)], c.ad && [inv ? "Kept with the invoice" : "Packed as", code(`a=${c.ad};s=${c.source};c=${c.click_id};t=${c.clicked_at || 0}`)]]),
    t.click_to_capture_s != null ? gap(`paid ${fmtSecs(t.click_to_capture_s)} later`, "grey") : null));

  const ppBody = pp?.error ? [$("p", { className: "err", textContent: `PayPal could not be read just now: ${pp.error}` })]
    : [dl([["Status (PayPal)", pp?.status || "–"], ["Amount", money(pp?.amount, pp?.currency)],
      p.via === "invoice" ? ["Invoice", code(pp?.invoice_id)] : ["Capture id", code(p.capture_id)],
      p.via === "invoice" ? ["Paid on (PayPal)", pp?.paid_at || "–"] : ["Captured (PayPal)", when(pp?.create_time)],
      p.via !== "invoice" && ["custom_id (PayPal)", code(pp?.custom_id)],
      pp?.fee && ["PayPal fee / net", `${money(pp.fee)} / ${money(pp.net)}`],
      Number(p.refunded_amount) > 0 && ["Refunded", `${money(p.refunded_amount)}${p.refunded_at ? ` · ${when(p.refunded_at)}` : ""}`],
      p.dispute && ["Dispute", `${p.dispute.status}${p.dispute.outcome ? ` · ${p.dispute.outcome}` : ""} (${p.dispute_state})`],
      p.held_as_duplicate && ["Held", "possible duplicate: same payer, same ad, minutes apart"]]),
      $("p", { className: "note", textContent: `Read from PayPal ${pp?.read_at ? when(pp.read_at) : ""} with ${pp?.read || "the PayPal API"} (PayPal is asked again at most every 10 minutes). ${inv ? `The ledger recorded it ${when(p.captured_at)}, when PayPal's invoice record showed it paid.` : `The ledger recorded it ${when(p.captured_at)} from the capture response and a signature-verified webhook.`}` })];
  steps.push(step("2", "paid", "PayPal confirms the money", p.via === "invoice" ? "PayPal invoice, paid after a chat" : "PayPal Checkout, captured by the server SDK", ppBody,
    gap(p.status === "COMPLETED" && !(Number(p.refunded_amount) >= Number(p.amount)) && p.dispute_state !== "open" && p.dispute_state !== "lost" ? "paid" : "not counted", p.status === "COMPLETED" ? "" : "bad")));

  let metaBody, metaTag, metaCls = "meta";
  if (!m) { metaBody = $("p", { textContent: "Nothing sent to Meta for this payment." }); metaTag = gap("not sent", "grey"); metaCls = ""; }
  else if (m.ok) {
    metaBody = [dl([["Event", "Purchase"], ["event_id", code(m.event_id)], ["Value", money(m.value)], ["Meta answered", `events_received: ${m.events_received ?? "–"}`], ["fbtrace_id", code(m.fbtrace_id)], ["Sent", when(m.at)], ["Mode", m.test_event ? "test event (this demo)" : "live"]]),
      $("p", { className: "note", textContent: m.superseded ? "A Google click, sent to Meta in the backfill before Google buyers were routed to Google only: still a fact, not counted as a Meta purchase." : m.backfill ? "Sent later, in a backfill, when the live link to Meta was switched on; not counted as a live delivery time." : "Sent the moment PayPal confirmed the payment. Meta's Conversions API has no retraction: if this payment were refunded now, it would come off the ledger here, not at Meta." })];
    metaTag = t.capture_to_meta_s != null ? gap(`${fmtSecs(t.capture_to_meta_s)} after capture`, "blue") : gap(m.backfill ? "backfill" : "sent", "blue");
  } else { metaBody = $("p", { textContent: m.held ? `Held back: ${m.held}.` : `Meta did not accept it: ${m.error || "no answer"}.` }); metaTag = gap("held", "bad"); metaCls = "warn"; }
  steps.push(step("3", metaCls, "Meta receives the purchase", "Conversions API, the shop's own dataset", metaBody, metaTag));

  if (a) steps.push(step("4", "", "What it changes for the ad", `${c.ad_name}: the budget decision reads paid orders, not leads`,
    [dl([["Leads (ad report)", String(a.leads)], ["Paid orders (PayPal)", String(a.paid_orders)], ["Spend / paid revenue", `${money(a.spend)} / ${money(a.paid_revenue)}`], ["Paid revenue per $1", a.per_dollar ? money(a.per_dollar) : "–"],
      a.chance_covers_spend != null && ["Chance it covers its spend", `${a.chance_covers_spend}%`], a.cut_after && ["Cut point", `if the next ${money(a.cut_after)} brings no paid order`],
      ["Budget move allowed", a.move ? [a.move.increase && "raise", a.move.reduce && "cut"].filter(Boolean).join(" or ") || "keep only" : "keep only: fewer than 3 paid orders"]]),
    $("p", { className: "note" }, ["The budget agent may only quote these numbers, and code refuses a move they do not support. ", $("a", { href: "/#approvals", textContent: "Ask it on the dashboard" }), "."])]));
  box.replaceChildren(...steps);
  history.replaceState(null, "", `/trail?capture=${encodeURIComponent(p.capture_id)}`);
}

function fmtSecs(s) { return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`; }

let drawn = false;
function picker(d) {
  const box = document.getElementById("picker");
  const cur = d.payment.capture_id;
  const focus = () => [...box.children].find((b) => b.dataset.id === cur)?.scrollIntoView({ block: "nearest", inline: "center" });
  if (drawn) { for (const b of box.children) b.setAttribute("aria-pressed", String(b.dataset.id === cur)); focus(); return; }
  drawn = true;
  box.replaceChildren(...d.payments.slice().reverse().map((x) => {
    const b = $("button", { type: "button" }, [`${x.ad_name} · ${money(x.amount)}`, $("small", { textContent: `${x.via === "invoice" ? "invoice" : "checkout"} · Meta: ${x.meta}` })]);
    b.dataset.id = x.capture_id; b.setAttribute("aria-pressed", String(x.capture_id === cur)); b.onclick = () => show(x.capture_id); return b;
  }));
  focus();
}

show(new URLSearchParams(location.search).get("capture"));
