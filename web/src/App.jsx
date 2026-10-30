import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { adName } from "./names.js";
import FlowChart from "./FlowChart.jsx";

// AG Studio is the heaviest part of the page: it loads as its own chunk when scrolled near, or when asked for.
const StudioPanel = lazy(() => import("./StudioPanel.jsx"));

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const usd = (c) => "$" + (c / 100).toFixed(2);
const signed = (c) => (c < 0 ? "−" : c > 0 ? "+" : "") + usd(Math.abs(c));
const money = (v) => "$" + Number(v || 0).toFixed(2);
const CHANGE = { pause: "Pause", reduce: "Reduce budget", increase: "Increase budget", keep: "Keep and watch", fix_tracking: "Fix tracking" };
const short = (name) => adName(name).split(" · ")[0];
const clock = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
const AD_LINKS = [["trial_video", "fb"], ["free_guide", "fb"], ["parent_carousel", "fb"], ["holiday_static", "g"]];
const adLink = (k, s) => `/shop.html?ad=${k}&${s === "fb" ? "fbclid=IwAR" : "gclid=Cj0K"}${Date.now().toString(36)}`;
const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export default function App() {
  const studio = useRef(null);
  const studioBox = useRef(null);
  const [csv, setCsv] = useState("");
  const [state, setState] = useState(null); // { reconciliation, meta, google, payments, duplicates }
  const [agent, setAgent] = useState({ status: "idle" });
  const [decisions, setDecisions] = useState({});
  const [error, setError] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [license, setLicense] = useState(undefined);
  const [syncNote, setSyncNote] = useState("");
  const [sending, setSending] = useState({});
  const [studioOn, setStudioOn] = useState(() => /[?&](film|studio)=1/.test(location.search));
  const [toast, setToast] = useState("");
  const [view, setView] = useState(() => (location.hash === "#report" ? "report" : "desk"));
  useEffect(() => {
    const on = () => setView(location.hash === "#report" ? "report" : "desk");
    addEventListener("hashchange", on); return () => removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { if (view === "report") { setStudioOn(true); scrollTo(0, 0); requestAnimationFrame(() => dispatchEvent(new Event("resize"))); } }, [view]);
  const goDesk = (id) => { if (location.hash === "#report") history.pushState(null, "", location.pathname + location.search); setView("desk"); if (id) setTimeout(() => scrollToId(id), 60); };
  const csvRef = useRef("");
  csvRef.current = csv;

  useEffect(() => { api("/api/config").then((c) => setLicense(c.ag_studio_license || null)).catch(() => setLicense(null)); }, []);
  // when approvals grow while someone works in AG Studio, the page must not jump: keep the Studio where it was on screen
  const studioTop = useRef(null);
  const pinStudio = useCallback(() => {
    const r = studioBox.current?.getBoundingClientRect();
    if (r && r.top < innerHeight && r.bottom > 0) studioTop.current = r.top;
  }, []);
  const loadInvoices = useCallback(() => api("/api/invoices").then((d) => { pinStudio(); setInvoices((cur) => {
    // KV listings can lag a write by seconds: keep drafts this page just made until the listing has them
    const recent = (c) => Date.now() - Date.parse(c.sent_at || c.created_at) < 120000;
    const fresh = cur.filter((c) => !d.invoices.some((x) => x.id === c.id) && recent(c));
    // a send this page just made beats a listing that still says DRAFT
    const merged = d.invoices.map((x) => {
      const c = cur.find((y) => y.id === x.id);
      if (c && c.sent_at && !x.sent_at && recent(c)) return c;
      // the same for a reminder this page just saw the agent send
      if (c && c.reminded_at && !x.reminded_at && Date.now() - Date.parse(c.reminded_at) < 120000) return { ...x, reminded_at: c.reminded_at, reminder: c.reminder };
      return x;
    });
    return [...fresh, ...merged].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }); }).catch(() => {}), [pinStudio]);
  useEffect(() => { loadInvoices(); }, [loadInvoices]);
  const load = useCallback(async (text) => {
    setError("");
    try {
      const [rec, ledger] = await Promise.all([api("/api/reconcile", { csv: text }), api("/api/ledger")]);
      setState({ ...rec, payments: ledger.payments, duplicates: ledger.duplicates, metaSends: ledger.meta || [], metaLive: ledger.meta_live });
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { fetch("/data/demo-ads.csv").then((r) => r.text()).then((t) => { setCsv(t); load(t); }); }, [load]);
  // the last checked recommendation and the decisions on it come back after a reload
  useEffect(() => {
    fetch("/api/recommendation").then((r) => r.json()).then(({ latest, decisions: ds }) => {
      if (!latest) return;
      setAgent((a) => (a.status === "idle" ? { status: "done", grounded: true, recommendation: latest.recommendation, source: latest.source, rec_id: latest.id, at: latest.at } : a));
      setDecisions((s) => (Object.keys(s).length ? s : Object.fromEntries(ds.filter((d) => d.index != null).map((d) => [d.index, { verdict: d.verdict, id: d.id, at: d.at }]))));
    }).catch(() => {});
  }, []);
  // webhooks first; this asks PayPal about sent invoices too, since the sandbox does not always emit INVOICING.INVOICE.PAID
  const syncInvoices = useCallback(async () => { setSyncNote(""); try { const d = await api("/api/invoices/sync", {}); if (d.paid && csvRef.current) load(csvRef.current); } catch (e) { setSyncNote(e.message); } loadInvoices(); }, [load, loadInvoices]);
  useEffect(() => { syncInvoices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (studioTop.current == null || !studioBox.current) return;
    const d = studioBox.current.getBoundingClientRect().top - studioTop.current;
    studioTop.current = null;
    if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: "instant" });
  }, [agent, invoices]);

  useEffect(() => {
    if (/[?&]film=1/.test(location.search)) return; // the film records a still ledger
    const tick = () => { if (document.visibilityState === "visible" && csvRef.current) load(csvRef.current); };
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const prefetch = () => import("./StudioPanel.jsx");
    const id = window.requestIdleCallback ? requestIdleCallback(prefetch, { timeout: 6000 }) : setTimeout(prefetch, 4000);
    return () => (window.cancelIdleCallback ? cancelIdleCallback(id) : clearTimeout(id));
  }, []);

  const toastTimer = useRef(0);
  const flash = useCallback((msg, go) => { clearTimeout(toastTimer.current); setToast({ msg, go }); toastTimer.current = setTimeout(() => setToast(""), go ? 9000 : 4200); }, []);

  // the budget agent inside AG Studio lands its gated recommendation in the same approvals inbox, and says so
  const onRecommendation = useCallback((r) => { pinStudio(); setAgent({ status: "done", ...r }); setDecisions({}); flash("The budget agent's change is waiting for your approval.", "approvals"); }, [flash, pinStudio]);

  // the revenue agent decides who is ready to pay; code prices it; the Agent Toolkit drafts it; nothing is sent here
  const [revenue, setRevenue] = useState({ status: "idle" });
  const [chase, setChase] = useState({ status: "idle" });
  // the chase agent's answer says whom it reminded; show that at once, before the KV listing catches up
  const markReminded = useCallback((d) => {
    const at = new Date().toISOString(), by = Object.fromEntries((d?.reminded || []).map((r) => [r.id, r]));
    if (Object.keys(by).length) setInvoices((cur) => cur.map((i) => (by[i.id] ? { ...i, reminded_at: at, reminder: { subject: by[i.id].subject, note: by[i.id].note } } : i)));
  }, []);
  const [studioPage, setStudioPage] = useState("overview");
  // sent but unpaid: the chase agent reads each with PayPal's Agent Toolkit, picks whom to remind and writes the note
  const askChase = async () => {
    setChase({ status: "running" });
    try { const d = await api("/api/agent/chase", {}); setChase({ status: "done", ...d }); markReminded(d); setTimeout(loadInvoices, 4000); }
    catch (e) { setChase({ status: "error", error: e.message }); }
  };
  const addDrafts = (drafts = []) => setInvoices((cur) => [...drafts.filter((d) => d.id && !cur.some((c) => c.id === d.id)), ...cur]);
  const askRevenue = async () => {
    setRevenue({ status: "running" }); scrollToId("approvals");
    try { const d = await api("/api/agent/revenue", {}); setRevenue({ status: "done", ...d }); addDrafts(d.drafts); loadInvoices(); }
    catch (e) { setRevenue({ status: "error", error: e.message }); }
  };
  // the Studio assistant runs the same revenue agent; its decisions land in Approvals, and a notice says so
  // the Studio nudge agent ran the chase agent: show its result under Invoices and refresh the list
  const onNudge = useCallback((d) => { pinStudio(); if (d) setChase({ status: "done", ...d }); markReminded(d); setTimeout(loadInvoices, 4000); flash(`The nudge agent sent ${d?.reminded?.length || 0} friendly reminder(s).`); }, [flash, pinStudio, loadInvoices, markReminded]);
  const onStudioInvoices = useCallback((d) => { pinStudio(); if (d) { setRevenue({ status: "done", ...d }); addDrafts(d.drafts); } loadInvoices(); flash("The revenue agent's drafts are waiting for your approval.", "approvals"); }, [loadInvoices, flash, pinStudio]);
  // a synthetic week with enough paid orders, so the agent has a real budget decision to make (labelled everywhere)
  const askWeek = async (id) => {
    setAgent({ status: "running" }); scrollToId("approvals");
    try { const out = await api("/api/agent", { scenario: id }); setAgent({ status: "done", ...out }); setDecisions({}); }
    catch (e) { setAgent({ status: "error", error: e.message }); }
  };
  const ask = async () => {
    setAgent({ status: "running" }); scrollToId("approvals");
    try { const out = await api("/api/agent", { csv }); setAgent({ status: "done", ...out }); setDecisions({}); }
    catch (e) { setAgent({ status: "error", error: e.message }); }
  };
  const openAssistant = () => {
    setStudioOn(true); if (location.hash !== "#report") location.hash = "report";
    const tryOpen = (n) => { if (!studio.current?.openAssistant() && n > 0) setTimeout(() => tryOpen(n - 1), 400); };
    tryOpen(30);
  };
  // the person approves; the send agent (Claude + PayPal Agent Toolkit) checks that draft and sends it, nothing else
  const send = async (id) => {
    setSending((s) => ({ ...s, [id]: "Agent checking and sending…" }));
    try {
      const d = await api("/api/invoices/approve", { id });
      setSending((s) => ({ ...s, [id]: d.agent.summary || (d.agent.sent ? "Sent." : "Not sent.") }));
      if (d.invoice) setInvoices((cur) => cur.map((i) => (i.id === id ? { ...i, ...d.invoice } : i)));
    }
    catch (e) { setSending((s) => ({ ...s, [id]: e.message })); }
    loadInvoices();
  };
  // full by default; a smaller amount is a partial refund (Google gets a restatement instead of a retraction)
  const refund = async (p) => {
    const left = (Number(p.amount) - Number(p.refunded_amount || 0)).toFixed(2);
    const v = window.prompt(`Refund how much of capture ${p.capture_id}? (sandbox)`, left); if (v === null) return;
    try { const d = await api("/api/refund", { capture_id: p.capture_id, amount: v }); flash(d.preview ? d.message : `Refunded ${money(d.refund?.amount)}. The ad's numbers and its conversion are updated.`); }
    catch (e) { flash(e.message); }
    load(csvRef.current);
  };
  // a decision is recorded on the server (what and when is kept with its evidence)
  const actions = agent.recommendation?.actions || [];
  const decide = async (i, verdict) => {
    const a = actions[i];
    try { const d = await api("/api/decisions", { ad: a.ad, change: a.change, verdict, reason: a.reason, evidence: a.evidence, rec_id: agent.rec_id, index: i }); setDecisions((s) => ({ ...s, [i]: { verdict, id: d.id, at: d.at } })); }
    catch (e) { flash(e.message); }
  };

  const t = state?.reconciliation?.totals;
  const ads = state?.reconciliation?.ads || [];
  const dup = Object.fromEntries((state?.duplicates || []).map((d) => [d.capture_id, d.first]));
  const metaSent = Object.fromEntries((state?.metaSends || []).map((m) => [m.capture_id, m]));
  const lastMeta = [...(state?.metaSends || [])].filter((m) => m.ok && !m.backfill).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  const drafts = invoices.filter((i) => i.status === "DRAFT");
  const waiting = actions.filter((_, i) => !decisions[i]).length + drafts.length;
  const costPerPaid = t && t.paid ? usd(Math.round(t.spend_cents / t.paid)) : "none";
  const byCost = [...ads].sort((a, b) => b.spend_cents - a.spend_cents);
  const best = ads.filter((a) => a.cost_per_paid_cents != null).sort((a, b) => a.cost_per_paid_cents - b.cost_per_paid_cents)[0]?.ad;
  const worst = ads.filter((a) => a.cost_per_paid_cents != null).sort((a, b) => b.cost_per_paid_cents - a.cost_per_paid_cents)[0]?.ad;

  const activity = useMemo(() => {
    const out = [];
    for (const p of state?.payments || []) {
      out.push({ at: p.captured_at, kind: "paid", text: `${p.ad && p.ad !== "direct" ? short(p.ad) : "No ad click"} paid ${money(p.amount)}${p.via === "invoice" ? " · invoice" : p.source === "g" ? " · Google click" : p.source === "fb" ? " · Meta click" : ""}` });
      if (Number(p.refunded_amount) > 0) out.push({ at: p.refunded_at || p.captured_at, kind: "refund", text: `${short(p.ad)} refunded ${money(p.refunded_amount)}${p.source === "g" ? " · Google " + (Number(p.refunded_amount) >= Number(p.amount) ? "retraction" : "restatement") : " · Meta event held"}` });
    }
    for (const i of invoices) {
      if (i.sent_at) out.push({ at: i.sent_at, kind: "agent", text: `${i.sent_by ? "Agent sent" : "Sent"} invoice · ${i.lead.replace(" (fictional)", "")}` });
      if (i.paid_at) out.push({ at: i.paid_at, kind: "paid", text: `Invoice paid · ${i.lead.replace(" (fictional)", "")}` });
    }
    return out.filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 7);
  }, [state, invoices]);

  return (
    <div className={`app ${view === "report" ? "report" : ""}`}>
      <a className="skip" href="#main">Skip to the dashboard</a>
      <header className="top">
        <div className="top-in">
          <a className="brand" href="/"><span className="mark"><i /></span>Paid Signal</a>
          <nav className="tabs" aria-label="Sections">
            <a href="#overview" className={view === "desk" ? "on" : ""} onClick={(e) => { e.preventDefault(); goDesk("overview"); }}>Overview</a>
            <a href="#report" className={view === "report" ? "on" : ""}>Report · AG Studio</a>
            <a href="#approvals" onClick={(e) => { e.preventDefault(); goDesk("approvals"); }}>Approvals {waiting > 0 && <span className="count">{waiting}</span>}</a>
            <a href="#payments" onClick={(e) => { e.preventDefault(); goDesk("payments"); }}>Payments</a>
            <a href="#signal" onClick={(e) => { e.preventDefault(); goDesk("signal"); }}>Ad signal</a>
            <a href="/scenarios.html">Scenarios</a>
            <a href="/proof.html">Proof</a>
          </nav>
          <div className="top-end">
            <span className="live"><i />PayPal sandbox · live</span>
            <a className="cta" href={adLink("trial_video", "fb")}>Pay in the demo shop</a>
          </div>
        </div>
      </header>

      <main id="main" className="desk">
        <section id="overview" className="hero" aria-label="Claimed vs paid">
          <div className="hero-copy">
            {t && <h1 className="sr">Ads report {t.leads} leads. PayPal confirms {t.paid} paid {t.paid === 1 ? "order" : "orders"}.</h1>}
            <p className="kicker">Kite Robotics Club · demo ad export · PayPal sandbox</p>
            <div className="duo">
              <div><b className="n claimed">{t ? t.leads : "…"}</b><span>leads the ads report</span></div>
              <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden="true"><path d="M2 20h46M38 8l12 12-12 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <div><b className="n paid">{t ? t.paid : "…"}</b><span>paid {t?.paid === 1 ? "order" : "orders"} PayPal confirms</span></div>
            </div>
            <p className="pitch">Ad platforms learn from the {t ? t.leads : "leads"}. Paid Signal teaches them the {t ? t.paid : "paid orders"}, straight from PayPal.</p>
            {t && <div className="chips-row">
              <span><b>{usd(t.revenue_cents)}</b> paid revenue</span>
              {t.held > 0 && <span title="Same payer, same ad, minutes apart: not counted as a paid order, and kept from the ad platforms"><b>{t.held}</b> possible duplicate held</span>}
              <span><b>{usd(t.spend_cents)}</b> ad spend</span>
              <span><b>{costPerPaid}</b> per paid order</span>
            </div>}
          </div>
          <div className="hero-bars">
            <div className="hb-head"><b>From the ad report, through PayPal, back to Meta</b></div>
            {state ? <FlowChart ads={ads} payments={state.payments} sends={state.metaSends} held={(state.duplicates || []).map((d) => d.capture_id)} worst={worst} /> : <p className="ghost">Loading the ledger…</p>}
            <div className="legend"><span><i className="l" />what the ads report</span><span><i className="p" />what PayPal confirms</span><span><i className="m" />what Meta learns</span></div>
          </div>
        </section>
        {error && <p className="err" role="alert">{error}</p>}

        <section className="loop" aria-label="Try the loop">
          <article><span className="step">1</span><b>Pay from an ad click</b><p>Open an ad link and pay in the PayPal sandbox. The click rides in the order.</p><a className="btn" href={adLink("trial_video", "fb")}>Open an ad link</a></article>
          <article><span className="step">2</span><b>Invoice the warm leads</b><p>Claude reads what each lead wrote and drafts PayPal invoices; code sets the price. You approve, the agent sends.</p><button className="btn" disabled={revenue.status === "running"} onClick={askRevenue}>{revenue.status === "running" ? "Reading the leads…" : "Ask the revenue agent"}</button></article>
          <article><span className="step">3</span><b>Ask the budget agent</b><p>Claude proposes changes. Every number is checked in code before you see it.</p><button className="btn dark" disabled={agent.status === "running"} onClick={ask}>{agent.status === "running" ? "Reading the ledger…" : "Ask the agent"}</button><button className="link-btn" disabled={agent.status === "running"} onClick={() => askWeek("week4")}>Or try a synthetic week with more orders</button></article>
          <article><span className="step">4</span><b>Teach the ad platform</b><p>Paid orders become Meta and Google conversions. Refunds pull them back.</p><button className="btn" onClick={() => scrollToId("signal")}>See the ad signal</button></article>
        </section>

        <div className="cols">
          <div className="col-main">
            <section className="card" aria-label="Per ad">
              <div className="card-head"><h2>Per ad</h2><span className="muted">Sorted by spend</span></div>
              <div className="scroll-x">
                <table className="grid">
                  <thead><tr><th>Ad</th><th>Spend</th><th>Leads</th><th>Paid</th><th>Revenue</th><th title="Paid revenue after refunds, minus this ad's spend. Product cost is not included.">After ad spend</th><th>Per paid order</th></tr></thead>
                  <tbody>
                    {byCost.map((a) => (
                      <tr key={a.ad}><td>{adName(a.ad)}</td><td>{usd(a.spend_cents)}</td><td>{a.leads}</td><td>{a.paid}{a.held > 0 && <small className="held"> +{a.held} held</small>}</td><td>{usd(a.revenue_cents)}</td><td className={a.net_cents < 0 ? "neg" : a.net_cents > 0 ? "pos" : ""}>{signed(a.net_cents)}</td>
                        <td>{a.cost_per_paid_cents == null ? <span className="pill warn">no paid order</span> : <span className={`pill ${a.ad === best ? "good" : a.ad === worst ? "warn" : ""}`}>{usd(a.cost_per_paid_cents)}</span>}</td></tr>
                    ))}
                    {t && <tr className="total"><td>Total</td><td>{usd(t.spend_cents)}</td><td>{t.leads}</td><td>{t.paid}</td><td>{usd(t.revenue_cents)}</td><td className={t.net_cents < 0 ? "neg" : t.net_cents > 0 ? "pos" : ""}>{signed(t.net_cents)}</td><td>{costPerPaid}</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="payments" className="card">
              <div className="card-head"><h2>Payments</h2>{state && <span className="ok">{state.payments.length} in the ledger · checked against PayPal</span>}</div>
              <p className="muted">Refund one and its ad drops: a Google click becomes a retraction, a Meta event is held back. The seeded demo payments preview a refund; pay in the shop to refund one of your own.</p>
              <div id="captures" className="list">
                {(state?.payments || []).slice().reverse().map((p) => (
                  <div key={p.capture_id} className="cap">
                    <span><b>{p.ad && p.ad !== "direct" ? adName(p.ad) : "No ad click"}{metaSent[p.capture_id]?.ok && <i className="meta-ok" title={`Meta received this Purchase (test events) ${clock(metaSent[p.capture_id].at)}`}>Meta ✓</i>}</b>{dup[p.capture_id] && <em className="dup">Possible duplicate of {dup[p.capture_id]}</em>}<small className="mono">{p.capture_id} · {money(p.amount)}{Number(p.refunded_amount) > 0 ? ` · refunded ${money(p.refunded_amount)}` : ""}{p.via === "invoice" ? " · invoice" : ""}</small></span>
                    {p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED" ? <button className="mini" onClick={() => refund(p)}>Refund</button> : <span className="tag">Refunded</span>}
                  </div>
                ))}
              </div>
            </section>

            <section id="signal" className="card">
              <div className="card-head"><h2>Ad platform signal</h2>{state && <span className="ok">{state.meta.events.length} Meta Purchase events · {state.google.conversions.length} Google rows</span>}</div>
              <p className="muted">Paid orders as Meta Conversions API events and Google offline conversions, deduplicated by capture. Sent to a real Meta test dataset: Meta processed them and dropped a resent copy by event id.</p>
              {state?.metaLive && <div className="live-meta" role="status">
                <span className="pulse" aria-hidden="true" />
                {lastMeta ? <span><b>Live to Meta:</b> the last paid order (${lastMeta.value}) reached the shop's Meta dataset as a Purchase test event {clock(lastMeta.at)}; Meta answered events_received {lastMeta.events_received}.</span>
                  : <span><b>Live to Meta:</b> pay in the demo shop and its Purchase event is sent to the shop's Meta dataset (test events) the moment PayPal confirms it.</span>}
              </div>}
              <div className="sig">
                {state && (() => {
                  // the same payment the line above talks about: the last one sent live, else the latest event
                  const ev = (lastMeta && state.meta.events.find((e) => e.event_id === `paypal:${lastMeta.capture_id}`)) || state.meta.events[state.meta.events.length - 1];
                  if (!ev) return <p className="muted">No paid capture with an ad click yet.</p>;
                  const sent = metaSent[ev.event_id.replace("paypal:", "")];
                  return <div className="sig-event">
                    <dl>
                      <div><dt>Payment</dt><dd>capture {ev.event_id.replace("paypal:", "")} · ${ev.custom_data.value.toFixed(2)}</dd></div>
                      <div><dt>Event</dt><dd>Purchase · {ev.action_source === "chat" ? "paid by invoice after a chat" : "paid at checkout"}</dd></div>
                      <div><dt>Matched on</dt><dd>{[ev.user_data.fbc && "the ad click (fbc)", ev.user_data.em && "the payer's hashed email", ev.user_data.client_user_agent && "browser"].filter(Boolean).join(", ")}</dd></div>
                      <div><dt>Meta</dt><dd>{sent?.ok ? `received ${sent.events_received} event ${clock(sent.at)}${sent.backfill ? " (sent later, before the live link)" : ""}` : "not sent yet"}</dd></div>
                    </dl>
                    <details><summary>Event as sent (JSON)</summary><pre tabIndex={0} aria-label="Meta Purchase event">{JSON.stringify(ev, null, 2)}</pre></details>
                  </div>;
                })()}
                <div className="sig-side">
                  {state?.meta.held.length > 0 && <div><b>Held back from Meta</b>{state.meta.held.map((h) => <small key={h.capture_id}>{h.capture_id} · {h.reason}</small>)}</div>}
                  {state && <div><b>Google adjustments</b>{state.google.adjustments.map((a) => <small key={a.order_id + a.adjustment_type}>{a.adjustment_type === "RETRACTION" ? "Retraction" : "Restatement"} · {a.order_id}{a.adjusted_value ? ` → $${a.adjusted_value}` : ""}</small>)}</div>}
                </div>
              </div>
            </section>
          </div>

          <aside className="col-side" aria-label="Approvals and activity">
            <section id="approvals" className="card">
              <div className="card-head"><h2>Approvals</h2>{agent.status === "done" && <span className={agent.grounded ? "ok" : "warn"}>{agent.grounded ? "Numbers checked in code" : "Number check flagged"}</span>}</div>
              <div id="actions">
                {agent.status === "idle" && <p className="muted">Ask the agent for budget changes. The agent never changes a budget: you approve, and the decision is logged.</p>}
                {/SYNTHETIC/.test(agent.source || "") && <p className="synthetic"><b>Synthetic week</b> {agent.synthetic?.story || agent.source.split("SYNTHETIC: ")[1]} Not PayPal payments: made up to show a real budget decision.{agent.grade ? (agent.grade.ok ? " Matches the known right answer." : " Differs from the known right answer.") : ""}</p>}
                {agent.status === "running" && <div className="skel" aria-live="polite"><i /><i /><i /><span>Claude is reading the ledger…</span></div>}
                {agent.status === "error" && <p className="err">{agent.error}</p>}
                {agent.recommendation && <p className="headline">{agent.recommendation.headline}</p>}
                {actions.map((a, i) => (
                  <article key={i} className={`action ${decisions[i]?.verdict || ""}`}>
                    <span className={`tag ${a.change}`}>Budget · {CHANGE[a.change] || a.change}</span>
                    <b>{adName(a.ad)}</b>
                    <p>{a.reason}</p>
                    <div className="chips">{a.evidence.map((e) => <span key={e} className="chip">{e.startsWith("row:") ? `${short(e.slice(4))} row` : `capture ${e}`}</span>)}</div>
                    {decisions[i] ? <p className="decided">{decisions[i].verdict === "approved" ? "Approved" : "Dismissed"} · logged {new Date(decisions[i].at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {decisions[i].id}</p>
                      : <div className="row"><button className="primary" onClick={() => decide(i, "approved")}>Approve</button><button onClick={() => decide(i, "dismissed")}>Dismiss</button></div>}
                  </article>
                ))}
                {agent.source && <p className="trace">From the {agent.source}</p>}
                {agent.trace && <p className="trace">{agent.trace.map((s) => s.tool + (s.ad ? `(${s.ad})` : "")).join(" → ")} · {(agent.ms / 1000).toFixed(1)} s</p>}
              </div>
              <div id="revenue">
                {revenue.status === "running" && <div className="skel" aria-live="polite"><i /><i /><i /><span>The revenue agent is reading what the leads wrote…</span></div>}
                {revenue.status === "error" && <p className="err">{revenue.error}</p>}
                {revenue.status === "done" && <>
                  {(() => {
                    const name = (l) => l.replace(" (fictional)", "");
                    const flagged = revenue.skips.filter((s) => s.flag === "injection"), waiting = revenue.skips.filter((s) => s.flag === "not_ready"), done = revenue.skips.filter((s) => s.flag === "already_invoiced");
                    const drafted = revenue.drafts.filter((d) => d.id);
                    return <>
                      <p className="headline">Revenue agent: {drafted.length} drafted · {flagged.length} flagged · {waiting.length} not ready{done.length ? ` · ${done.length} already invoiced` : ""}</p>
                      {flagged.map((s, k) => <div key={`f${k}`} className="dec bad"><b>Flagged · {name(s.lead)} · not invoiced</b><small>{s.reason}</small></div>)}
                      {revenue.refusals.map((r, k) => <div key={`r${k}`} className="dec bad"><b>Refused by code · {name(r.lead)}</b><small>{r.problems.join(" ")}</small></div>)}
                      {drafted.map((d) => <div key={d.id} className="dec ok"><b>Drafted · {name(d.lead)} · ${d.amount}</b><small>{(d.lines || []).map((l) => l.name).join(" + ")}</small><small>{d.reason}</small></div>)}
                      {waiting.map((s, k) => <div key={`w${k}`} className="dec"><b>Not ready · {name(s.lead)}</b><small>{s.reason}</small></div>)}
                    </>;
                  })()}
                  <p className="trace">{revenue.trace.length} tool calls · {(revenue.ms / 1000).toFixed(1)} s · prices set by code · drafts created with PayPal's Agent Toolkit</p>
                </>}
              </div>
              <div id="invoices">
                <div className="sub-head"><b>Invoices</b><span className="row">{invoices.some((i) => i.status === "SENT" || i.status === "UNPAID") && <button className="mini" disabled={chase.status === "running"} onClick={askChase}>{chase.status === "running" ? "Chasing…" : "Chase unpaid"}</button>}<button className="mini" onClick={syncInvoices}>Refresh</button></span></div>
                {invoices.some((i) => i.status === "SENT" || i.status === "UNPAID") && <p className="muted small">Demo clock: a reminder may go an hour after an invoice is sent (three days in a real shop), at most once a day.</p>}
                {chase.status === "error" && <p className="err">{chase.error}</p>}
                {chase.status === "done" && <div className="dec ok"><b>Chase agent: {chase.reminded.length} reminded{chase.eligible != null ? ` of ${chase.eligible} waiting` : ""}</b><small>{chase.summary}</small>
                  <small className="trace">{chase.trace.map((s) => s.refused ? `${s.tool} refused` : s.tool).join(" → ")}{chase.ms ? ` · ${(chase.ms / 1000).toFixed(1)} s` : ""} · reminders sent with PayPal's Agent Toolkit</small></div>}
                {syncNote && <p className="note" role="status">Could not re-check sent invoices with PayPal: {syncNote}</p>}
                {invoices.length === 0 && <p className="muted">No drafts yet. Open the Studio assistant and choose "Invoice warm leads".</p>}
                {invoices.map((i) => (
                  <div key={i.id} className={`cap inv ${i.sent_by ? "agent" : ""}`}>
                    <span><b>{i.lead.replace(" (fictional)", "")}</b><small>{short(i.ad)} · {money(i.amount)}{i.lines?.length > 1 ? ` · ${i.lines.length} children, sibling 20% off` : ""}{i.sent_by ? " · sent by the agent" : i.status === "DRAFT" ? (i.drafted_by ? " · drafted by the agent" : " · draft") : ""}{i.reminded_at && i.status !== "PAID" ? ` · reminded ${clock(i.reminded_at)}` : ""}</small>{i.reminder && i.status !== "PAID" && <small className="agent-say" title={i.reminder.subject}>“{i.reminder.note}”</small>}{sending[i.id] && <small className="agent-say" role="status">{sending[i.id]}</small>}</span>
                    {i.status === "DRAFT" ? <button className="mini go" disabled={sending[i.id] === "Agent checking and sending…"} onClick={() => send(i.id)}>Approve</button>
                      : i.status === "PAID" ? <span className="ok">Paid</span>
                      : i.pay_url ? <a href={i.pay_url} target="_blank" rel="noopener noreferrer">Sent ↗</a> : <span className="muted">{i.status}</span>}
                  </div>
                ))}
              </div>
              <button className="btn wide" onClick={openAssistant}>Open the Studio assistant</button>
            </section>

            <section className="card" aria-label="Activity">
              <div className="card-head"><h2>Activity</h2></div>
              <ol className="feed">
                {activity.map((e, k) => <li key={k} className={e.kind}><i /><span>{e.text}</span><time dateTime={e.at}>{clock(e.at)}</time></li>)}
                {!activity.length && <li className="muted">No payments yet.</li>}
              </ol>
            </section>

            <section id="links" className="card">
              <div className="card-head"><h2>Ad links</h2></div>
              <p className="muted">Each opens the demo shop with an ad click attached.</p>
              <div className="links">
                {AD_LINKS.map(([k, s]) => <a key={k} className="adlink" href={adLink(k, s)}>{adName(k)}<small>{s === "fb" ? "Meta" : "Google"} click</small></a>)}
              </div>
              <details className="csv">
                <summary>Use your own ad export</summary>
                <textarea value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} aria-label="Ad export CSV (ad, spend, leads)" />
                <button className="primary" onClick={() => load(csv)}>Reconcile again</button>
                {state?.csv_errors?.length ? <p className="note">{state.csv_errors.join(" ")}</p> : null}
              </details>
            </section>
          </aside>
        </div>

        <section id="studio" className="card studio-card" ref={studioBox} aria-label="AG Studio">
          <div className="card-head">
            <div><h2>{view === "report" ? "Report · AG Studio" : "The full report, in AG Studio"}</h2><p className="muted">Three custom widgets, a custom budget agent and Studio's own agents, running on Claude.</p></div>
            <div className="row">
              {view === "report" ? <button className="btn" onClick={() => goDesk("approvals")}>Approvals {waiting > 0 && <span className="count">{waiting}</span>}</button> : <a className="btn" href="#report">Open the report</a>}
              <button className="btn dark" onClick={openAssistant}>Open the Studio assistant</button>
            </div>
          </div>
          <div className="studio-pages" role="tablist" aria-label="Report pages">
            {[["overview", "Ads vs PayPal"], ["captures", "PayPal captures"], ["ledger", "Ad → PayPal → Meta"], ["owes", "Who still owes"]].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={studioPage === id} className={studioPage === id ? "on" : ""} onClick={() => { setStudioPage(id); studio.current?.selectPage(id); }}>{label}</button>
            ))}
          </div>
          <div className="studio">
            {studioOn && license !== undefined
              ? <Suspense fallback={<div className="studio-wait">Loading AG Studio…</div>}><StudioPanel ref={studio} state={state} invoices={invoices} license={license} csvRef={csvRef} onInvoices={onStudioInvoices} onNudge={onNudge} onRecommendation={onRecommendation} /></Suspense>
              : <a className="studio-wait" href="#report">Open the AG Studio report</a>}
          </div>
        </section>

        <footer className="foot">Fictional shop and ad data · real PayPal sandbox calls · Claude agents · <a href="https://github.com/longtt-marketing/paid-signal">Code</a> · <a href="/scenarios.html">Test scenarios</a></footer>
      </main>
      {toast && <div className="toast" role="status"><span>{toast.msg}</span>{toast.go && <button className="mini go" onClick={() => { goDesk(toast.go); setToast(""); }}>Review</button>}</div>}
    </div>
  );
}
