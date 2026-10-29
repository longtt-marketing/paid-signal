import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { AgStudioAiModule } from "ag-studio";
import { buildAi } from "./agentTools.js";
import { buildData, initialReport, theme, adName } from "./studio.js";
import { claimWidgetDefinition } from "./ClaimWidget.jsx";

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const PANELS = { view: { right: ["ai", "filters"] }, edit: { right: ["ai", "edit", "data", "filters"] } };
const usd = (c) => "$" + (c / 100).toFixed(2);
const CHANGE = { pause: "Pause", reduce: "Reduce budget", increase: "Increase budget", keep: "Keep and watch", fix_tracking: "Fix tracking" };

export default function App() {
  const studio = useRef(null);
  const [csv, setCsv] = useState("");
  const [state, setState] = useState(null); // { reconciliation, meta, google, payments }
  const [page, setPage] = useState("overview");
  const [agent, setAgent] = useState({ status: "idle" });
  const [decisions, setDecisions] = useState({});
  const [error, setError] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [license, setLicense] = useState(undefined);
  useEffect(() => { api("/api/config").then((c) => setLicense(c.ag_studio_license || null)).catch(() => setLicense(null)); }, []);
  const csvRef = useRef("");
  csvRef.current = csv;
  const loadInvoices = useCallback(() => api("/api/invoices").then((d) => setInvoices(d.invoices.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))))).catch(() => {}), []);
  useEffect(() => { loadInvoices(); }, [loadInvoices]);
  const ai = useMemo(() => buildAi({ getCsv: () => csvRef.current, onInvoices: loadInvoices }), [loadInvoices]);
  const send = async (id) => { try { await api("/api/invoices/send", { id }); } catch (e) { alert(e.message); } loadInvoices(); };

  const load = useCallback(async (text) => {
    setError("");
    try {
      const [rec, ledger] = await Promise.all([api("/api/reconcile", { csv: text }), api("/api/ledger")]);
      setState({ ...rec, payments: ledger.payments, duplicates: ledger.duplicates });
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { fetch("/data/demo-ads.csv").then((r) => r.text()).then((t) => { setCsv(t); load(t); }); }, [load]);

  const data = useMemo(() => (state ? buildData(state.reconciliation, state.payments) : undefined), [state]);
  const context = useMemo(() => ({ dataVersion: (state?.payments || []).map((p) => p.capture_id + p.refunded_amount).join() }), [state]);
  const widgets = useMemo(() => (defaults) => createWidgets({ additionalTypes: [claimWidgetDefinition], menu: [...defaults.menu, { label: "Paid Signal", widgetIds: ["claim-vs-confirmed"] }] }), []);

  const go = (id) => { setPage(id); const a = studio.current?.api; if (a) a.setState({ ...a.getState(), selectedPageId: id }); };

  const ask = async () => {
    setAgent({ status: "running" });
    try { const out = await api("/api/agent", { csv }); setAgent({ status: "done", ...out }); setDecisions({}); }
    catch (e) { setAgent({ status: "error", error: e.message }); }
  };
  const openAssistant = () => { const a = studio.current?.api; if (!a) return; const s = a.getState(); a.setState({ ...s, panels: { ...(s.panels || {}), ai: { collapsed: false } } }); };
  // webhooks first; this asks PayPal about sent invoices too, since the sandbox does not always emit INVOICING.INVOICE.PAID
  const syncInvoices = useCallback(async () => { try { const d = await api("/api/invoices/sync", {}); if (d.paid && csvRef.current) load(csvRef.current); } catch {} loadInvoices(); }, [load, loadInvoices]);
  useEffect(() => { syncInvoices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // full by default; a smaller amount is a partial refund (Google gets a restatement instead of a retraction)
  const refund = async (p) => {
    const left = (Number(p.amount) - Number(p.refunded_amount || 0)).toFixed(2);
    const v = window.prompt(`Refund how much of capture ${p.capture_id}? (sandbox)`, left); if (v === null) return;
    try { await api("/api/refund", { capture_id: p.capture_id, amount: v }); } catch (e) { alert(e.message); } load(csvRef.current);
  };
  // a decision is recorded on the server (who decided is the visitor; what and when is kept with the evidence)
  const decide = async (i, verdict) => {
    const a = actions[i];
    try { const d = await api("/api/decisions", { ad: a.ad, change: a.change, verdict, reason: a.reason, evidence: a.evidence }); setDecisions((s) => ({ ...s, [i]: { verdict, id: d.id, at: d.at } })); }
    catch (e) { alert(e.message); }
  };

  const dup = Object.fromEntries((state?.duplicates || []).map((d) => [d.capture_id, d.first]));
  const t = state?.reconciliation?.totals;
  const actions = agent.recommendation?.actions || [];
  const open = actions.filter((_, i) => !decisions[i]).length;

  return (
    <div className="shell">
      <nav className="side" aria-label="Paid Signal">
        <a className="brand" href="/"><span className="mark"><i /></span>Paid Signal</a>
        <button className={page === "overview" ? "nav on" : "nav"} onClick={() => go("overview")}>Overview</button>
        <button className={page === "captures" ? "nav on" : "nav"} onClick={() => go("captures")}>Payments</button>
        <a className="nav" href="#actions">Agent {open > 0 && <span className="count">{open}</span>}</a>
        <a className="nav" href="#invoices">Invoices {invoices.filter((i) => i.status === "DRAFT").length > 0 && <span className="count">{invoices.filter((i) => i.status === "DRAFT").length}</span>}</a>
        <a className="nav" href="#captures">Refunds</a>
        <a className="nav" href="#signal">Ad signal</a>
        <a className="nav" href="#links">Ad links</a>
        <a className="nav" href="/scenarios.html">Test scenarios</a>
        <div className="side-foot">PayPal sandbox · {state ? `${state.payments.length} payments` : "loading"}</div>
      </nav>

      <main className="main">
        <header className="head">
          <div>
            <p className="kicker">Kite Robotics Club · demo ads · PayPal sandbox</p>
            <h1>{t ? <>Ads report {t.leads} leads. <span className="paid">PayPal confirms {t.paid} paid {t.paid === 1 ? "order" : "orders"}.</span></> : "Loading the ledger…"}</h1>
          </div>
          <details className="csv">
            <summary>Your ad export</summary>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} aria-label="Ad export CSV (ad, spend, leads)" />
            <button className="primary" onClick={() => load(csv)}>Reconcile again</button>
            {state?.csv_errors?.length ? <p className="note">{state.csv_errors.join(" ")}</p> : null}
          </details>
        </header>
        {error && <p className="err">{error}</p>}
        <div className="studio">
          {license !== undefined && <AgStudioProvider modules={[AgStudioAiModule]} licenseKey={license || undefined}>
            <AgStudio ref={studio} data={data} context={context} initialState={initialReport} widgets={widgets} theme={theme} mode="view" ai={ai} panels={PANELS} onApiReady={(e) => { window.__studio = e.api; }} style={{ width: "100%", height: "100%" }} />
          </AgStudioProvider>}
        </div>
      </main>

      <aside className="aside">
        <section id="actions" className="card">
          <div className="row between"><h2>Agent</h2>{agent.status === "done" && <span className={agent.grounded ? "ok" : "warn"}>{agent.grounded ? "Numbers checked" : "Number check flagged"}</span>}</div>
          {agent.status === "idle" && <p className="muted">Claude proposes budget changes. Every number is checked in code; nothing changes until you approve.</p>}
          {agent.status === "running" && <p className="muted">Reading the ledger…</p>}
          {agent.status === "error" && <p className="err">{agent.error}</p>}
          {agent.recommendation && <p className="headline">{agent.recommendation.headline}</p>}
          {actions.map((a, i) => (
            <div key={i} className={`action ${decisions[i]?.verdict || ""}`}>
              <span className={`tag ${a.change}`}>{CHANGE[a.change] || a.change} · needs approval</span>
              <b>{adName(a.ad)}</b>
              <p>{a.reason}</p>
              <div className="chips">{a.evidence.map((e) => <span key={e} className="chip">{e.startsWith("row:") ? `${adName(e.slice(4))} row` : `capture ${e}`}</span>)}</div>
              {decisions[i] ? <p className="decided">{decisions[i].verdict === "approved" ? "Approved" : "Dismissed"} · logged {new Date(decisions[i].at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {decisions[i].id}</p>
                : <div className="row"><button className="primary" onClick={() => decide(i, "approved")}>Approve</button><button onClick={() => decide(i, "dismissed")}>Dismiss</button></div>}
            </div>
          ))}
          {agent.trace && <p className="trace">{agent.trace.map((s) => s.tool + (s.ad ? `(${s.ad})` : "")).join(" → ")} · {(agent.ms / 1000).toFixed(1)} s</p>}
          <button className="go" disabled={agent.status === "running"} onClick={ask}>{agent.status === "done" ? "Ask again" : "Ask the agent"}</button>
          <button onClick={openAssistant}>Open the Studio assistant</button>
        </section>

        <section id="invoices" className="card">
          <div className="row between"><h2>Invoices</h2><button className="mini" onClick={syncInvoices}>Refresh</button></div>
          <p className="muted">Drafted by the Studio assistant, with the ad click inside. Nothing is sent until you press Send.</p>
          {invoices.length === 0 && <p className="note">No drafts yet. Ask the Studio assistant: "Invoice warm leads".</p>}
          {invoices.map((i) => (
            <div key={i.id} className="cap inv">
              <span><b>{i.lead.replace(" (fictional)", "")}</b><small>{adName(i.ad)} · ${i.amount}</small></span>
              {i.status === "DRAFT" ? <button className="mini primary" onClick={() => send(i.id)}>Send</button>
                : i.status === "PAID" ? <span className="ok">Paid</span>
                : i.pay_url ? <a href={i.pay_url} target="_blank" rel="noopener">Sent ↗</a> : <span className="note">{i.status}</span>}
            </div>
          ))}
        </section>

        <section id="captures" className="card">
          <div className="row between"><h2>Payments</h2>{state && <span className="ok">{state.payments.length} in the ledger</span>}</div>
          <p className="muted">Refund one: its ad drops and Google gets a retraction.</p>
          {(state?.payments || []).slice().reverse().slice(0, 6).map((p) => (
            <div key={p.capture_id} className="cap">
              <span><b>{p.ad && p.ad !== "direct" ? adName(p.ad) : "No ad click"}</b>{dup[p.capture_id] && <em className="dup">Possible duplicate of {dup[p.capture_id]}</em>}<small className="mono">{p.capture_id} · ${p.amount}{Number(p.refunded_amount) > 0 ? ` · refunded $${p.refunded_amount}` : ""}{p.via === "invoice" ? " · invoice" : ""}</small></span>
              {p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED" ? <button className="mini" onClick={() => refund(p)}>Refund</button> : <span className="tag">Refunded</span>}
            </div>
          ))}
        </section>

        <section id="signal" className="card">
          <div className="row between"><h2>Ad platform signal</h2>{state && <span className="ok">{state.meta.events.length} Purchase events</span>}</div>
          <p className="muted">Meta Purchase events and Google offline conversions, deduplicated by capture. Preview only.</p>
          {state && <pre>{JSON.stringify(state.meta.events[0] || { note: "No paid capture with a click id yet." }, null, 2)}</pre>}
          {state?.meta.held.length > 0 && <p className="note">Held back from Meta: {state.meta.held.map((h) => `${h.capture_id} (${h.reason})`).join(", ")}</p>}
          {state && <div className="gsig">
            <b>Google offline conversions · {state.google.conversions.length}</b>
            {state.google.adjustments.map((a) => <div key={a.order_id + a.adjustment_type} className="cap"><span><b>{a.adjustment_type === "RETRACTION" ? "Retraction" : "Restatement"}</b><small>{a.order_id}{a.adjusted_value ? ` · new value $${a.adjusted_value}` : " · removed from the count"}</small></span></div>)}
          </div>}
        </section>

        <section id="links" className="card">
          <h2>Ad links</h2>
          <p className="muted">Each opens the shop with an ad click.</p>
          {[["trial_video", "fb"], ["free_guide", "fb"], ["parent_carousel", "fb"], ["holiday_static", "g"]].map(([k, s]) => (
            <a key={k} className="adlink" href={`/shop.html?ad=${k}&${s === "fb" ? "fbclid=IwAR" : "gclid=Cj0K"}${Date.now().toString(36)}`}>{adName(k)}<small>{s === "fb" ? "Meta" : "Google"} click</small></a>
          ))}
        </section>
        {t && <p className="foot">Spend {usd(t.spend_cents)} · paid revenue {usd(t.revenue_cents)} · spend on ads with no paid order {usd(t.spend_without_paid_cents)}</p>}
      </aside>
    </div>
  );
}
