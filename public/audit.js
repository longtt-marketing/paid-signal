// No-login audit: a shop's own Ads Manager export and PayPal activity download, read in this browser with the same ledger
// code the Worker runs (/lib/ledger.js, a copy of src/ledger.js that a test keeps identical). Nothing is uploaded.
import { parseAdCsv, parsePayPalCsv, reconcile, supportedMoves, paybackOdds, SHOP_COSTS, packClick } from "/lib/ledger.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) if (k != null) e.append(k); return e; };
const usd = (c) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const files = { ads: null, pp: null, sample: false };
let report = "";

const ready = () => { $("run").disabled = !(files.ads && files.pp); };
for (const id of ["ads", "pp"]) {
  $(id).addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { $("msg").textContent = `${f.name} is larger than 20 MB; export a shorter date range.`; return; }
    files[id] = await f.text(); files.sample = false; $(`${id}-ok`).textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`; $("msg").textContent = ""; ready();
  });
}
$("run").onclick = () => audit();
$("cost").onchange = () => { if (files.ads && files.pp) audit(); };

// the demo shop as sample files: its ad export, and its PayPal sandbox payments written out as a PayPal activity download
$("sample").onclick = async () => {
  $("sample").disabled = true;
  try {
    const [ads, ledger] = await Promise.all([fetch("/data/demo-ads.csv").then((r) => r.text()), fetch("/api/ledger").then((r) => r.json())]);
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ['"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","Transaction ID","Reference Txn ID","Custom Number"'];
    for (const p of ledger.payments) {
      const d = new Date(p.captured_at), date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`, time = d.toISOString().slice(11, 19);
      const custom = p.ad && p.ad !== "direct" ? packClick({ ad: p.ad, source: p.source, clickId: p.click_id, clickedAt: p.clicked_at }) : "";
      lines.push([date, time, "UTC", "Sandbox buyer", p.via === "invoice" ? "Invoice Payment" : "Express Checkout Payment", "Completed", "USD", p.amount, p.fee ? `-${p.fee}` : "", "", p.payer_key ? `buyer-${p.payer_key}@sample.invalid` : "", p.capture_id, "", custom].map(q).join(","));
      if (Number(p.refunded_amount) > 0) lines.push([date, time, "UTC", "Sandbox buyer", "Payment Refund", "Completed", "USD", `-${p.refunded_amount}`, "", "", "", `${p.capture_id}-R`, p.capture_id, ""].map(q).join(","));
    }
    files.ads = ads; files.pp = lines.join("\n"); files.sample = true;
    $("ads-ok").textContent = "Sample: demo-ads.csv (fictional shop)"; $("pp-ok").textContent = `Sample: ${ledger.payments.length} PayPal sandbox payments, read live`;
    ready(); audit();
  } catch (e) { $("msg").textContent = `Could not load the sample files: ${e.message}`; }
  $("sample").disabled = false;
};

function audit() {
  $("msg").textContent = "";
  const a = parseAdCsv(files.ads);
  if (!a.rows.length) { $("msg").textContent = a.errors[0] || "No ads found in the export."; return; }
  const keys = a.rows.map((r) => r.ad);
  const p = parsePayPalCsv(files.pp, keys);
  if (!p.summary) { $("msg").textContent = p.errors[0]; return; }
  const share = Math.min(95, Math.max(0, Number($("cost").value) || 0)) / 100;
  const costs = { ...SHOP_COSTS, cost_share: share };
  const rec = reconcile(a.rows, p.payments), moves = supportedMoves(rec, 3, costs), odds = paybackOdds(rec);
  const s = p.summary, t = rec.totals;
  const matchedCents = t.revenue_cents + t.held_cents + t.disputed_cents;

  $("out").hidden = false;
  $("out-tag").textContent = files.sample ? "SAMPLE: the demo shop's fictional ads and PayPal sandbox payments" : "Your files, read in this browser";
  const byLeads = [...rec.ads].sort((x, y) => y.leads - x.leads)[0], byPaid = [...rec.ads].sort((x, y) => y.revenue_cents - x.revenue_cents)[0];
  $("headline").textContent = !s.tagged
    ? `PayPal confirms ${plural(s.payments, "payment")}, but none says which ad it came from, so no ad can be credited yet. Below is what to add so the next export can.`
    : byLeads && byPaid && byLeads.ad !== byPaid.ad && byPaid.revenue_cents > 0
      ? `Your ad report's best ad by leads is ${byLeads.ad} (${plural(byLeads.leads, "lead")}, ${plural(byLeads.paid, "paid order")}). By PayPal-confirmed payments it is ${byPaid.ad} (${plural(byPaid.paid, "paid order")}, ${usd(byPaid.revenue_cents)}).`
      : `${plural(t.paid, "paid order")} PayPal confirms against ${plural(t.leads, "lead")} the ad report counts; paid revenue ${usd(t.revenue_cents)} on ${usd(t.spend_cents)} of ads.`;

  const stat = (b, span, cls = "") => el("div", { className: `stat ${cls}` }, [el("b", { textContent: b }), el("span", { textContent: span })]);
  $("stats").replaceChildren(
    stat(`${s.tagged} / ${s.payments}`, "PayPal payments that carry an ad", s.tagged / Math.max(1, s.payments) < 0.5 ? "bad" : "good"),
    stat(usd(s.untagged_net_cents), "paid revenue no ad can claim", s.untagged_net_cents > 0 ? "bad" : ""),
    stat(`${t.leads} → ${t.paid}`, "leads the ads report → paid orders PayPal confirms for them"),
    stat(usd(t.net_cents), "paid revenue minus ad spend (before product cost)", t.net_cents < 0 ? "bad" : "good"),
  );

  $("rows").replaceChildren(...rec.ads.map((r) => {
    const m = moves[r.ad], o = odds.ads?.[r.ad];
    const allow = m ? (m.increase ? ["Raise allowed", "up"] : m.reduce ? ["Cut", "down"] : ["Keep", ""]) : ["Keep: fewer than 3 paid orders", ""];
    const why = m ? m.why : o?.more_spend_to_decide_cents != null ? `Cut if the next ${usd(o.more_spend_to_decide_cents)} of spend brings no paid order.` : r.paid === 0 && r.spend_cents > 0 ? "No paid order yet." : "";
    const per = r.spend_cents ? r.revenue_cents / r.spend_cents : 0, after = r.spend_cents ? (r.revenue_cents * (1 - share) - r.fee_cents) / r.spend_cents : 0;
    return el("tr", {}, [el("td", { textContent: r.ad }), el("td", { textContent: usd(r.spend_cents) }), el("td", { textContent: String(r.leads) }),
      el("td", { textContent: `${r.paid}${r.held ? ` (+${r.held} held)` : ""}` }), el("td", { textContent: String(r.refunded) }), el("td", { textContent: usd(r.revenue_cents) }),
      el("td", { textContent: `$${per.toFixed(2)}` }), el("td", { textContent: `$${after.toFixed(2)}` }),
      el("td", {}, [el("span", { className: `pill ${allow[1]}`, textContent: allow[0] }), why ? el("small", { textContent: why }) : null])]);
  }));

  const todo = [];
  if (s.tagged < s.payments) todo.push(`${plural(s.payments - s.tagged, "PayPal payment")} (${usd(s.untagged_net_cents)}) carry no ad. Put the ad in each PayPal order's custom_id at checkout, as the demo shop does (see Connect a shop), or add ad={{ad.name}} to your Meta ad's URL parameters and pass it through.`);
  if (s.tags_not_in_export.length) todo.push(`These ad tags are in PayPal but not in the ad export: ${s.tags_not_in_export.join(", ")}. Export the same dates, at ad level, or use the same ad names in both.`);
  if (s.refunds_not_found) todo.push(`${plural(s.refunds_not_found, "refund")} refer to a payment outside this PayPal file; download a wider date range so refunds meet their payment.`);
  if (rec.ads.every((r) => r.paid < 3)) todo.push("No ad has 3 PayPal-confirmed paid orders yet, so the rule keeps every budget. The cut points in the table say how much more spend would settle each ad.");
  const up = rec.ads.filter((r) => moves[r.ad]?.increase).map((r) => r.ad), down = rec.ads.filter((r) => moves[r.ad]?.reduce).map((r) => r.ad);
  if (up.length) todo.push(`Raising is supported for ${up.join(", ")}: each covers its spend after your costs and PayPal fees and is at or above the average.`);
  if (down.length) todo.push(`Cutting is supported for ${down.join(", ")}: paid revenue does not cover ad spend after your costs and PayPal fees.`);
  if (byLeads && byLeads.paid < 3 && byLeads.leads >= 2 * Math.max(1, byLeads.paid) * 3) todo.push(`Do not raise ${byLeads.ad} for its leads: ${plural(byLeads.leads, "lead")} and ${plural(byLeads.paid, "paid order")}.`);
  if (a.errors.length || p.errors.length) todo.push(`Skipped rows: ${[...a.errors, ...p.errors].slice(0, 4).join(" ")}${a.errors.length + p.errors.length > 4 ? " …" : ""}`);
  $("todo").replaceChildren(...todo.map((x) => el("li", { textContent: x })));

  report = [`Paid Signal audit${files.sample ? " (SAMPLE: demo shop, fictional ads, PayPal sandbox payments)" : ""}`, `PayPal payments ${s.from ? s.from.slice(0, 10) : "?"} to ${s.to ? s.to.slice(0, 10) : "?"}`, "",
    $("headline").textContent, "",
    `${s.tagged} of ${s.payments} PayPal payments carry an ad; ${usd(s.untagged_net_cents)} of paid revenue has none. Matched to the export: ${usd(matchedCents)}.`,
    `Leads ${t.leads}, paid orders ${t.paid}, paid revenue ${usd(t.revenue_cents)}, ad spend ${usd(t.spend_cents)}, difference ${usd(t.net_cents)} (before product cost).`, "",
    "Ad | spend | leads | paid | refunded | paid revenue | budget rule",
    ...rec.ads.map((r) => `${r.ad} | ${usd(r.spend_cents)} | ${r.leads} | ${r.paid} | ${r.refunded} | ${usd(r.revenue_cents)} | ${moves[r.ad] ? (moves[r.ad].increase ? "raise allowed" : moves[r.ad].reduce ? "cut" : "keep") : "keep: fewer than 3 paid orders"}`),
    "", "What to do next:", ...todo.map((x) => `- ${x}`), "", `Costs used: ${Math.round(share * 100)}% product and delivery, PayPal fees as charged (or 2.99% + $0.49 when the file has none).`].join("\n");
}

$("dl").onclick = () => {
  const a = el("a", { href: URL.createObjectURL(new Blob([report], { type: "text/plain" })), download: "paid-signal-audit.txt" });
  document.body.append(a); a.click(); a.remove();
};
