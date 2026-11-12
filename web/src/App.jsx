import { setClaims } from "./adClaims.js";
import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// /studio opens the app straight on the AG Studio report (the judges' link) and skips the invoice sync on open
const STUDIO_PAGE = typeof location !== "undefined" && location.pathname === "/studio";

// the PayPal ledger as an AG Grid table, loaded only when the dashboard shows it
const LedgerGrid = lazy(() => import("./LedgerGrid.jsx"));

// If AG Studio cannot run (its trial key lapses, or the bundle fails to load), the report shows a recent picture of
// itself and says why, instead of an empty frame. Every number on it is also on the dashboard tab.
// a fault in the ledger table shows a note, never a blank dashboard
class GridGuard extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.error("Ledger table failed", e); }
  render() { return this.state.failed ? <p className="muted">The ledger table could not load here; the same payments are on the money trail and in the report.</p> : this.props.children; }
}

class StudioGuard extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.error("AG Studio did not load", e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="studio-fallback"><p className="muted">AG Studio could not load here (its trial key may have lapsed). This is a picture of the report taken on 5 Nov 2026; the same numbers are live on the Dashboard tab.</p><img src="/report-snapshot.jpg" alt="The AG Studio report: leads against PayPal-confirmed paid orders per ad, and the per-ad table" /></div>;
  }
}
import { adName } from "./names.js";
import { setPick } from "./adPick.js";
import { whenLedger } from "./ledgerView.js";
import FlowChart from "./FlowChart.jsx";
import GuidedTour from "./GuidedTour.jsx";

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
const clock = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
const AD_LINKS = [["trial_video", "fb"], ["free_guide", "fb"], ["parent_carousel", "fb"], ["holiday_static", "g"]];
const adLink = (k, s) => `/shop.html?ad=${k}&${s === "fb" ? "fbclid=IwAR" : "gclid=Cj0K"}${Date.now().toString(36)}`;
const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
const decisionsFor = (items, recId) => Object.fromEntries(items.filter((d) => d.rec_id === recId && d.index != null).map((d) => [d.index, { verdict: d.verdict, id: d.id, at: d.at }]));

function PhoneDisclosure({ id, title, className = "", summaryText = "", children }) {
  const query = "(max-width: 639px)";
  const [open, setOpen] = useState(() => !window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), sync = () => setOpen(!media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return (
    <details id={id} className={`phone-disclosure ${className}`.trim()} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span><span className="toggle-show">Show</span><span className="toggle-hide">Hide</span> {title}</span>{summaryText && <span className="phone-disclosure-meta">{summaryText}</span>}</summary>
      <div className="phone-disclosure-body">{children}</div>
    </details>
  );
}

export default function App({ first = null }) {
  const studio = useRef(null);
  const studioBox = useRef(null);
  const [csv, setCsv] = useState("");
  const [state, setState] = useState(null); // { reconciliation, meta, google, payments, duplicates }
  const [agent, setAgent] = useState({ status: "idle" });
  const [decisions, setDecisions] = useState({});
  const [visitorDecisions, setVisitorDecisions] = useState([]);
  const [sharedRecommendation, setSharedRecommendation] = useState(null);
  const [visitorRecommendation, setVisitorRecommendation] = useState(null);
  const [decisionCount, setDecisionCount] = useState(0);
  const [myDecisionCount, setMyDecisionCount] = useState(0);
  const [error, setError] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [license, setLicense] = useState(undefined);
  const [syncNote, setSyncNote] = useState("");
  const [sending, setSending] = useState({});
  const [studioOn, setStudioOn] = useState(() => /[?&](film|studio)=1/.test(location.search));
  const [toast, setToast] = useState("");
  const [view, setView] = useState(() => (STUDIO_PAGE || location.hash === "#report" ? "report" : "desk"));
  useEffect(() => {
    const on = () => setView(STUDIO_PAGE || location.hash === "#report" ? "report" : "desk");
    addEventListener("hashchange", on); return () => removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { if (view === "report") { setStudioOn(true); scrollTo(0, 0); requestAnimationFrame(() => dispatchEvent(new Event("resize"))); } }, [view]);
  const goDesk = (id) => { if (STUDIO_PAGE) { location.href = `/${id ? `#${id}` : ""}`; return; } if (location.hash === "#report") history.pushState(null, "", location.pathname + location.search); setView("desk"); if (id) setTimeout(() => scrollToId(id), 60); };
  const csvRef = useRef("");
  csvRef.current = csv;

  const [gridEnterprise, setGridEnterprise] = useState({ on: false, license: null });
  useEffect(() => { api("/api/config").then((c) => { setLicense(c.ag_studio_license || null); setGridEnterprise({ on: Boolean(c.ag_grid_enterprise), license: c.ag_grid_license || null }); }).catch(() => setLicense(null)); }, []);
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
  // a person says a flagged pair is two real orders: the second payment counts again (ad, Meta, commission)
  // the reason comes from the form under the ledger; a refusal comes back to that form (the server explains it)
  const markDistinct = useCallback(async (id, reason) => {
    await api("/api/duplicates/distinct", { capture_id: id, reason }); await load(csv); flash("Counted as a separate order: the ad, Meta and the commission count it again.");
  }, [load, csv]); // eslint-disable-line react-hooks/exhaustive-deps
  // the last checked recommendation and the decisions on it come back after a reload
  useEffect(() => {
    fetch("/api/recommendation").then((r) => r.json()).then(({ latest, mine, shared, decisions: ds = [], decision_count = 0, my_decision_count = 0 }) => {
      setSharedRecommendation(shared || null);
      setVisitorRecommendation(mine || null);
      setVisitorDecisions(ds);
      setDecisionCount(decision_count);
      setMyDecisionCount(my_decision_count);
      if (!latest) return;
      setAgent((a) => (a.status === "idle" ? { status: "done", grounded: true, recommendation: latest.recommendation, source: latest.source, rec_id: latest.id, at: latest.at, mine: Boolean(latest.mine) } : a));
      setDecisions((s) => (Object.keys(s).length ? s : decisionsFor(ds, latest.id)));
    }).catch(() => {});
  }, []);
  // webhooks first; this asks PayPal about sent invoices too, since the sandbox does not always emit INVOICING.INVOICE.PAID
  // a custom Studio widget that acted (the Nudge button) asks for fresh invoices, so the board shows the new reminders
  useEffect(() => { const on = () => loadInvoices(); addEventListener("paid-signal:refresh", on); return () => removeEventListener("paid-signal:refresh", on); }, [loadInvoices]);
  // the ledger widget in Studio refunded a payment or counted one: reload the ledger, so every widget shows it
  useEffect(() => { const on = () => csvRef.current && load(csvRef.current); addEventListener("paid-signal:ledger", on); return () => removeEventListener("paid-signal:ledger", on); }, [load]);
  const syncInvoices = useCallback(async () => { setSyncNote(""); try { const d = await api("/api/invoices/sync", {}); if (d.paid && csvRef.current) load(csvRef.current); } catch (e) { setSyncNote(e.message); } loadInvoices(); }, [load, loadInvoices]);
  // the dashboard asks PayPal for newly paid invoices on open; /studio only reads
  useEffect(() => { if (!STUDIO_PAGE) syncInvoices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const onRecommendation = useCallback((r) => {
    pinStudio(); setAgent({ status: "done", ...r, mine: true }); setDecisions({});
    if (r.saved) setVisitorRecommendation({ ...r.saved, mine: true });
    flash("The budget agent's change is waiting for your approval.", "approvals");
  }, [flash, pinStudio]);
  const showSavedRecommendation = useCallback((saved, mine) => {
    if (!saved) return;
    setAgent({ status: "done", grounded: true, recommendation: saved.recommendation, source: saved.source, rec_id: saved.id, at: saved.at, mine });
    setDecisions(decisionsFor(visitorDecisions, saved.id));
  }, [visitorDecisions]);

  // the revenue agent decides who is ready to pay; code prices it; the Agent Toolkit drafts it; nothing is sent here
  const [revenue, setRevenue] = useState({ status: "idle" });
  const [chase, setChase] = useState({ status: "idle" });
  // the chase agent's answer says whom it reminded; show that at once, before the KV listing catches up
  const markReminded = useCallback((d) => {
    const at = new Date().toISOString(), by = Object.fromEntries((d?.reminded || []).map((r) => [r.id, r]));
    if (Object.keys(by).length) setInvoices((cur) => cur.map((i) => (by[i.id] ? { ...i, reminded_at: at, reminder: { subject: by[i.id].subject, note: by[i.id].note } } : i)));
  }, []);
  const [studioPage, setStudioPage] = useState("overview");
  const [studioReady, setStudioReady] = useState(false);
  // an agent may switch the page itself (open_page, a filter, the ledger view): the tab bar follows Studio
  useEffect(() => { const t = setInterval(() => { if (studio.current?.isReady?.()) setStudioReady(true); const id = window.__studio?.getState?.().selectedPageId; if (id) setStudioPage((cur) => (cur === id ? cur : id)); }, 800); return () => clearInterval(t); }, []);
  const selectStudioPage = async (id) => {
    const end = Date.now() + 8000;
    while (Date.now() < end && !studio.current?.isReady?.()) await new Promise((resolve) => setTimeout(resolve, 100));
    if (!studio.current?.isReady?.()) return false;
    setStudioPage(id);
    return studio.current.selectPage(id);
  };
  const [morePages, setMorePages] = useState(false);
  // the headline on /studio: how many of the agents' PayPal writes PayPal reports back right now
  const [readBack, setReadBack] = useState(null);
  // what each ad claims and what PayPal confirms, for the "Ad report → PayPal" cell on the ledger grids' subtotal rows
  useEffect(() => { const list = state?.reconciliation?.ads; if (list) setClaims(Object.fromEntries(list.map((r) => [adName(r.ad), { leads: r.leads, paid: r.paid }]))); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (STUDIO_PAGE) fetch("/api/agent-actions").then((r) => r.json()).then((d) => d.total && setReadBack(d)).catch(() => {}); }, []);
  const [layoutNote, setLayoutNote] = useState("");
  const [allInv, setAllInv] = useState(false);
  const [allAct, setAllAct] = useState(false);
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
  // instruction: the owner's own request; the agent weighs it, and code still refuses a move the payments do not support
  const askWeek = async (id, instruction) => {
    setAgent({ status: "running", instruction }); scrollToId("approvals");
    try {
      const out = await api("/api/agent", { scenario: id, ...(instruction ? { instruction } : {}) });
      setAgent({ status: "done", instruction, ...out }); setDecisions({});
      if (out.saved) out.mine ? setVisitorRecommendation({ ...out.saved, mine: true }) : setSharedRecommendation(out.saved);
    }
    catch (e) { setAgent({ status: "error", error: e.message }); }
  };
  // on the live PayPal ledger too, the owner can add a request; the payments still decide what code lets through
  const ask = async (instruction) => {
    setAgent({ status: "running", instruction }); scrollToId("approvals");
    try {
      const out = await api("/api/agent", { csv, ...(instruction ? { instruction } : {}) });
      setAgent({ status: "done", instruction, ...out }); setDecisions({});
      if (out.saved) out.mine ? setVisitorRecommendation({ ...out.saved, mine: true }) : setSharedRecommendation(out.saved);
    }
    catch (e) { setAgent({ status: "error", error: e.message }); }
  };
  // a step in the judge strip: go to the first page, bring the widget it names into view, flash it and put focus on the
  // control to press (a band, the first ▸, the Nudge button), so the judge sees where to click instead of reading prose
  const pointTo = async (title, control) => {
    await selectStudioPage("overview");
    const go = (n) => {
      // Studio may keep a hidden copy of a widget: take a visible one, and the one holding the control when there is one
      const all = [...document.querySelectorAll(".ag-studio-layout-widget")].filter((x) => x.offsetHeight > 0 && title.split("|").some((t) => x.textContent.includes(t)));
      const w = all.find((x) => control && x.querySelector(control)) || all[0];
      if (!w) { if (n > 0) setTimeout(() => go(n - 1), 300); return; }
      w.scrollIntoView({ behavior: "smooth", block: "center" });
      w.classList.add("ps-flash"); setTimeout(() => w.classList.remove("ps-flash"), 4200);
      // Studio draws a widget once it is in view: look for the control again until it is there
      const mark = (k) => {
        const c = control && [...document.querySelectorAll(".ag-studio-layout-widget")].filter((x) => x.offsetHeight > 0 && title.split("|").some((t) => x.textContent.includes(t))).map((x) => x.querySelector(control)).find(Boolean);
        if (c) { c.focus({ preventScroll: true }); c.classList.add("ps-point"); setTimeout(() => c.classList.remove("ps-point"), 4200); }
        else if (control && k > 0) setTimeout(() => mark(k - 1), 250);
      };
      setTimeout(() => mark(30), 400);
    };
    go(20);
  };
  // the strip's link: open the assistant on a new chat, so its starters (Replay a budget run first) are in view
  const openReplay = async () => {
    // the recorded run is about the first page: go there first, so the chart it adds lands where the judge is looking
    await selectStudioPage("overview");
    openAssistant();
    const tryNew = (n) => { const b = [...document.querySelectorAll("#studio button")].find((x) => /^New( chat)?$/.test(x.textContent.trim())); if (b) b.click(); else if (n > 0) setTimeout(() => tryNew(n - 1), 400); };
    setTimeout(() => tryNew(20), 600);
  };
  const openAssistant = () => {
    setStudioOn(true); if (location.hash !== "#report") location.hash = "report";
    const tryOpen = (n) => { if (!studio.current?.openAssistant() && n > 0) setTimeout(() => tryOpen(n - 1), 400); };
    tryOpen(30);
  };
  const runGuidedTourStep = async (step, setCaption) => {
    document.querySelectorAll(".ps-point").forEach((el) => el.classList.remove("ps-point"));
    const waitFor = async (find, ms = 30000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const found = find();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return null;
    };
    const visibleWidget = (label, selector) => [...document.querySelectorAll(".ag-studio-layout-widget")]
      .filter((el) => el.offsetHeight > 0 && el.textContent.includes(label))
      .map((el) => ({ widget: el, control: selector ? el.querySelector(selector) : null }))
      .find((x) => !selector || x.control);
    const point = (el) => {
      el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
      el.classList.add("ps-point");
    };

    if (step < 2) {
      await selectStudioPage("overview");
      const label = step === 0 ? "Ad report vs PayPal: leads → paid money" : "PayPal ledger (AG Grid)";
      const selector = step === 0 ? "[role=button][aria-label^='Testimonial']" : ".trail-toggle";
      const found = await waitFor(() => visibleWidget(label, selector));
      if (!found) { if (step === 0) setCaption("The ad chart is still loading; use Next to continue or try this step again."); return; }
      point(found.control);
      // the chart's bands are SVG groups (no .click()): send a real click event; a band already picked stays picked
      if (!(step === 0 && found.control.getAttribute("aria-pressed") === "true")) found.control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return;
    }
    if (step === 2) {
      await selectStudioPage("overview");
      // clear the ad picked in step 1 (the chart's own reset) and put the ledger back to its grouped view, then send
      setPick([], "flow");
      const ledger = await whenLedger(8000);
      if (ledger) await Promise.race([ledger({ reset: true }), new Promise((r) => setTimeout(r, 3000))]);
      await new Promise((r) => setTimeout(r, 1500));
      openAssistant();
      const fresh = await waitFor(() => [...document.querySelectorAll("button")].find((el) => /^New( chat)?$/.test(el.textContent.trim())));
      if (fresh) fresh.click();
      const input = await waitFor(() => [...document.querySelectorAll("textarea")].find((el) => (el.placeholder || "").startsWith("Ask the AI")));
      if (!input) { setCaption("The assistant could not open here; use Next to continue. The grouped view is in the gallery."); return; }
      const prompt = "In the PayPal ledger, group the payments by ad and show the money kept per ad.";
      point(input);
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(input, prompt); else input.value = prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      setCaption("The assistant asks AG Grid's AI Toolkit for the grid's schema, then sets a grouped state…");
      const began = Date.now(); const end = began + 75000;
      while (Date.now() < end) {
        const text = document.body?.innerText || "";
        if (text.includes("Applied a grid state to the ledger (AG Grid AI Toolkit)")) {
          setCaption("AG Grid's AI Toolkit grouped the ledger by ad and totalled the money kept, after refunds."); return;
        }
        if (/daily limit|rate limit|too many requests|request failed|tool failed|assistant.{0,40}(?:error|failed)/i.test(text)) {
          setCaption("The assistant is resting; the grouped view is in the gallery."); return;
        }
        setCaption(`Live model call: the assistant reads the grid's schema from AG Grid's AI Toolkit, then sets a grouped state… ${Math.round((Date.now() - began) / 1000)} s (usually 15 to 40 s)`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      setCaption("The assistant is resting; the grouped view is in the gallery.");
      return;
    }
    await selectStudioPage("agents");
    const found = await waitFor(() => visibleWidget("Agent writes, read back from PayPal"));
    if (found) point(found.widget);
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
  // the amount comes from the form under the ledger, already checked against what is left; the server checks it again
  const refund = async (p, amount) => {
    const d = await api("/api/refund", { capture_id: p.capture_id, amount });
    flash(d.preview ? d.message : `Refunded ${money(d.refund?.amount)}. The ad's numbers and its conversion are updated.`);
    load(csvRef.current);
  };
  // a decision is recorded on the server (what and when is kept with its evidence)
  const actions = agent.recommendation?.actions || [];
  const decide = async (i, verdict) => {
    const a = actions[i];
    try {
      const d = await api("/api/decisions", { ad: a.ad, change: a.change, verdict, reason: a.reason, evidence: a.evidence, rec_id: agent.rec_id, index: i });
      setDecisions((s) => ({ ...s, [i]: { verdict, id: d.id, at: d.at } }));
      setVisitorDecisions((items) => [d, ...items]); setMyDecisionCount((n) => n + 1); setDecisionCount((n) => n + 1);
    }
    catch (e) { flash(e.message); }
  };

  const t = state?.reconciliation?.totals;
  const ads = state?.reconciliation?.ads || [];
  const dup = Object.fromEntries((state?.duplicates || []).map((d) => [d.capture_id, d.first]));
  const metaSent = Object.fromEntries((state?.metaSends || []).map((m) => [m.capture_id, m]));
  const lastMeta = [...(state?.metaSends || [])].filter((m) => m.ok && !m.backfill).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  const drafts = invoices.filter((i) => i.status === "DRAFT");
  const costPerPaid = t && t.paid ? usd(Math.round(t.spend_cents / t.paid)) : "none";
  const paymentRows = state?.payments || [];
  const partlyRefunded = paymentRows.filter((p) => Number(p.refunded_amount || 0) > 0 && Number(p.refunded_amount || 0) < Number(p.amount)).length;
  const paymentBreakdown = state && (() => {
    const totals = state.reconciliation.totals;
    const parts = [`${totals.paid} paid orders${partlyRefunded ? ` (${partlyRefunded} partly refunded)` : ""}`, `${totals.refunded} fully refunded`, `${totals.held} held`];
    if (totals.disputed) parts.push(`${totals.disputed} disputed`);
    const unmatched = state.reconciliation.unmatched_captures.length;
    if (unmatched) parts.push(`${unmatched} unmatched`);
    const unclassified = Math.max(0, paymentRows.length - totals.paid - totals.refunded - totals.held - totals.disputed - unmatched);
    if (unclassified) parts.push(`${unclassified} unclassified`);
    return `${paymentRows.length} payments = ${parts.join(" + ")}`;
  })();
  const byCost = [...ads].sort((a, b) => b.spend_cents - a.spend_cents);
  const odds = state?.odds?.ads || {}; // small-sample read from the ledger (paybackOdds)
  const best = ads.filter((a) => a.cost_per_paid_cents != null).sort((a, b) => a.cost_per_paid_cents - b.cost_per_paid_cents)[0]?.ad;
  const worst = ads.filter((a) => a.cost_per_paid_cents != null).sort((a, b) => b.cost_per_paid_cents - a.cost_per_paid_cents)[0]?.ad;

  const activity = useMemo(() => {
    const out = [];
    for (const p of state?.payments || []) {
      out.push({ at: p.captured_at, kind: "paid", text: `${p.ad && p.ad !== "direct" ? short(p.ad) : "No ad click"} paid ${money(p.amount)}${p.channel === "messenger" ? " · Messenger lead" : p.channel === "lead_form" ? " · lead form" : p.via === "invoice" ? " · invoice" : p.source === "g" ? " · Google click" : p.source === "fb" ? " · Meta click" : ""}` });
      if (Number(p.refunded_amount) > 0) out.push({ at: p.refunded_at || p.captured_at, kind: "refund", text: `${short(p.ad)} refunded ${money(p.refunded_amount)}${p.source === "g" ? " · Google " + (Number(p.refunded_amount) >= Number(p.amount) ? "retraction" : "restatement") : " · taken off here; Meta has no retraction"}` });
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
            <a href="/judge">Try it</a>
            <a href="/studio" className={view === "report" ? "on" : ""}>AG Studio</a>
            <a href="/proof">Proof</a>
            <a href="https://github.com/longtt-marketing/paid-signal">Code</a>
          </nav>
          <div className="top-end">
            <span className="live"><i />PayPal sandbox live</span>
          </div>
        </div>
      </header>

      <main id="main" className="desk">
        <section id="overview" className="hero" aria-label="Claimed vs paid">
          <div className="hero-copy">
            <p className="kicker">Kite Robotics Club · demo shop</p>
            <h1 className="duo"><span className="n claimed">{(t || first)?.leads ?? "…"} leads.</span><span className="n paid">{(t || first)?.paid ?? "…"} paid.</span></h1>
            {paymentBreakdown && <p className="payment-count-line">{paymentBreakdown}</p>}
            <p className="pitch">Ads learn from leads. PayPal knows who paid.</p>
            <div className="hero-actions"><a className="cta" href="/studio?tour=1">▶ Take the 60-second tour</a><a className="cta ghost" href="/judge#customer">Be the customer: pay $49</a></div>
          </div>
          <div className="hero-bars" aria-label="Leads and paid orders by ad">
            <div className="hb-head"><b>By ad</b><span>paid revenue per $1 of ads</span></div>
            {byCost.length ? [...ads].sort((a, b) => b.leads - a.leads).map((a) => {
              const top = Math.max(...ads.map((x) => x.leads), 1), back = a.spend_cents ? a.revenue_cents / a.spend_cents : 0;
              return <div key={a.ad} className="hb-row">
                <div className="hb-main"><span>{adName(a.ad)}</span>
                  <div className="hb-bars"><i className="l" style={{ width: `${(a.leads / top) * 100}%` }} /><i className="p" style={{ width: `${Math.max((a.paid / top) * 100, 2)}%` }} /></div>
                  <small>{a.leads} leads · {a.paid} paid</small></div>
                <b className={a.ad === best ? "good" : back < 1 ? "warn" : ""}>{"$" + back.toFixed(2)}</b>
              </div>;
            }) : <p className="ghost">Loading the ledger…</p>}
            {t && <div className="totals" aria-label="Totals">
              <div><b>{usd(t.revenue_cents)}</b><small>paid revenue</small></div>
              <div><b>{usd(t.spend_cents)}</b><small>ad spend</small></div>
              <div title="Same payer, same ad, minutes apart: not counted until a person decides"><b>{t.held}</b><small>double payment held</small></div>
            </div>}
          </div>
        </section>
        {error && <p className="err" role="alert">{error}</p>}

        <section className="flow-card" aria-label="From the ad report, through PayPal, back to Meta">
          <div className="hb-head"><b>Ad report → PayPal → Meta</b><a className="link-btn" href={adLink("trial_video", "fb")}>Pay from an ad link</a></div>
          {state ? <FlowChart ads={ads} payments={state.payments} sends={state.metaSends} held={(state.duplicates || []).map((d) => d.capture_id)} worst={worst} /> : <p className="ghost">Loading the ledger…</p>}
          <div className="legend"><span><i className="l" />what the ads report</span><span><i className="p" />what PayPal confirms</span><span><i className="m" />what Meta learns</span></div>
        </section>
        <section className="agents" aria-label="Agents">
          <div className="sec-head"><h2>Agents draft. Code checks. You approve.</h2></div>
          <div className="agent-grid">
            {[
              ["Revenue", "Reads the chat, drafts the invoice.", "PayPal invoice", <button className="mini" disabled={revenue.status === "running"} onClick={askRevenue}>{revenue.status === "running" ? "Reading…" : "Run"}</button>],
              ["Send", "Sends it once you approve.", "PayPal invoice", <button className="mini" onClick={() => scrollToId("approvals")}>Approvals</button>],
              ["Chase", "Reminds who still owes.", "PayPal reminder", <button className="mini" disabled={chase.status === "running"} onClick={askChase}>{chase.status === "running" ? "Chasing…" : "Chase"}</button>],
              ["Refund", "Returns a double payment.", "PayPal refund", <a className="mini" href="/judge#refund">Watch</a>],
              ["Commission", "Pays the creator per paid order.", "PayPal Payouts", <a className="mini" href="/judge#commission">Watch</a>],
              ["Budget", "Moves money only on PayPal proof.", "Checked in code", <button className="mini" disabled={agent.status === "running"} onClick={() => ask()}>{agent.status === "running" ? "Reading…" : "Ask"}</button>],
            ].map(([n, does, tool, act]) => <article key={n}><div><b>{n}</b><p>{does}</p></div><div className="agent-foot"><span className="agent-tool">{tool}</span>{act}</div></article>)}
          </div>
        </section>


        <div className="cols">
          <div className="col-main">
            <section className="card" aria-label="Per ad">
              <div className="card-head"><h2>Per ad</h2><span className="muted">No budget moves under 3 paid orders</span></div>
              <div className="scroll-x desktop-only">
                <table className="grid">
                  <thead><tr><th>Ad</th><th>Spend</th><th>Leads</th><th>Paid</th><th>Revenue</th><th title="Chance, computed in code, that this ad's paid revenue covers its ad spend">Chance it covers spend</th></tr></thead>
                  <tbody>
                    {byCost.map((a) => {
                      const o = odds[a.ad], pc = o ? Math.round(o.chance_covers_spend * 100) : null;
                      return <tr key={a.ad} title={o ? (o.more_spend_to_decide_cents != null ? `Cut if the next ${usd(o.more_spend_to_decide_cents)} brings no paid order` : o.verdict) : ""}><td>{adName(a.ad).split(" · ")[0]}</td><td>{usd(a.spend_cents)}</td><td>{a.leads}</td><td><b>{a.paid}</b>{a.held > 0 && <small className="held"> +{a.held} held</small>}</td><td>{usd(a.revenue_cents)}</td>
                        <td>{pc == null ? "–" : <span className={`pill ${pc >= 80 ? "good" : pc < 30 ? "warn" : ""}`}>{pc}%</span>}</td></tr>;
                    })}
                    {t && <tr className="total"><td>Total</td><td>{usd(t.spend_cents)}</td><td>{t.leads}</td><td>{t.paid}</td><td>{usd(t.revenue_cents)}</td><td></td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="ad-cards" aria-label="Per-ad summary">
                {byCost.map((a) => <article key={a.ad} className="ad-card">
                  <h3>{adName(a.ad)}</h3>
                  <p className="ad-card-flow"><span>{a.leads} leads</span><span aria-hidden="true">→</span><b>{a.refunded || a.held || a.disputed ? `${a.paid} paid of ${a.paid + a.refunded + a.held + a.disputed} payments` : `${a.paid} paid orders`}</b></p>
                  <p className="ad-card-revenue"><span>Paid revenue</span><b>{usd(a.revenue_cents)}</b></p>
                  <div className="ad-card-cover"><span>Covers its spend?</span><b>{odds[a.ad] ? `${Math.round(odds[a.ad].chance_covers_spend * 100)}%` : "Not calculated"}</b>
                    <small>{odds[a.ad] ? odds[a.ad].more_spend_to_decide_cents != null ? `Cut if the next ${usd(odds[a.ad].more_spend_to_decide_cents)} brings no paid order` : odds[a.ad].verdict : "No cut point available"}</small>
                  </div>
                </article>)}
              </div>
            </section>

            <PhoneDisclosure id="payments" title="Payments" className="card" summaryText={state ? `${state.payments.length} in the ledger` : ""}>
              <div className="card-head phone-section-head"><h2>PayPal ledger</h2>{state && <span className="pill good">{state.payments.length} in the ledger</span>}</div>
              <div id="captures">
                {state && <GridGuard><Suspense fallback={<p className="muted">Loading the ledger…</p>}><LedgerGrid payments={state.payments || []} dup={Object.fromEntries((state.duplicates || []).map((d) => [d.capture_id, d]))} metaSent={metaSent} adName={adName} onRefund={refund} onCount={markDistinct} /></Suspense></GridGuard>}
              </div>
            </PhoneDisclosure>

            <PhoneDisclosure id="signal" title="Ad platform signal" className="card" summaryText={state ? `${state.meta.events.length} Meta events` : ""}>
              <div className="card-head phone-section-head"><h2>Ad platform signal</h2>{state && <span className="ok">{state.meta.events.length} Meta Purchase events · {state.google.conversions.length} Google {state.google.conversions.length === 1 ? "row" : "rows"}</span>}</div>
              <p className="muted">PayPal-confirmed payments from Meta ads become Purchase events, one per capture.</p>
              {state?.metaLive && <div className="live-meta" role="status">
                <span className="pulse" aria-hidden="true" />
                {lastMeta ? <span><b>Live to Meta:</b> last Purchase (${lastMeta.value}) received {clock(lastMeta.at)}, events_received {lastMeta.events_received}.</span>
                  : <span><b>Live to Meta:</b> a PayPal-confirmed payment is sent as a test event.</span>}
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
                      <div><dt>Event</dt><dd>Purchase · {ev.action_source === "business_messaging" ? "Messenger conversation" : ev.action_source === "system_generated" ? "lead-form CRM event" : ev.action_source === "chat" ? "invoice paid after a chat" : "paid at checkout"}</dd></div>
                      <div><dt>Matched on</dt><dd>{[ev.user_data.fbc && "the ad click (fbc)", ev.user_data.em && "the payer's hashed email", ev.user_data.page_scoped_user_id && "Messenger page-scoped ID", ev.user_data.lead_id && "Meta lead ID", ev.user_data.client_user_agent && "browser"].filter(Boolean).join(", ")}</dd></div>
                      <div><dt>Meta</dt><dd>{sent?.ok ? `received ${sent.events_received} event ${clock(sent.at)}${sent.backfill ? " (sent later, before the live link)" : ""}` : "not sent yet"}</dd></div>
                    </dl>
                    <details><summary>Event payload shape (IDs redacted)</summary><pre tabIndex={0} aria-label="Meta Purchase event payload shape">{JSON.stringify(ev, null, 2)}</pre></details>
                  </div>;
                })()}
                <details className="sig-more"><summary>Held back and Google adjustments</summary><div className="sig-side">
                  {state?.meta.held.length > 0 && <div><b>Held back from Meta</b>{state.meta.held.map((h) => <small key={h.capture_id}>{h.capture_id} · {state.metaSends.some((m) => m.capture_id === h.capture_id && m.superseded) ? "Google click: goes to Google only now (it reached Meta once, before that rule)" : h.reason}</small>)}</div>}
                  {state && <div><b>Google adjustments</b>{state.google.adjustments.map((a) => <small key={a.order_id + a.adjustment_type}>{a.adjustment_type === "RETRACTION" ? "Retraction" : "Restatement"} · {a.order_id}{a.adjusted_value ? ` → $${a.adjusted_value}` : ""}</small>)}</div>}
                </div></details>
              </div>
            </PhoneDisclosure>
          </div>

          <aside className="col-side" aria-label="Approvals and activity">
            <section id="approvals" className="card">
              <div className="card-head"><h2>Approvals</h2><div className="approval-meta"><span>{myDecisionCount} by you · {decisionCount} across visitors</span>{agent.status === "done" && <span className={agent.grounded ? "ok" : "warn"}>{agent.grounded ? "Numbers checked in code" : "Number check flagged"}</span>}</div></div>
              <div id="actions">
                {agent.status === "idle" && <p className="muted">Budget changes wait here for you.</p>}
                {/SYNTHETIC/.test(agent.source || "") && <p className="synthetic"><b>Synthetic week</b> {agent.synthetic?.story || agent.source.split("SYNTHETIC: ")[1]} Not PayPal payments: made up to show a real budget decision.{agent.grade ? (agent.grade.ok ? " Matches the known right answer." : " Differs from the known right answer.") : ""}</p>}
                {agent.mine && sharedRecommendation && <p className="run-notice" role="status">You changed the inputs; this is your run. <button type="button" onClick={() => showSavedRecommendation(sharedRecommendation, false)}>Show the live ledger's run</button></p>}
                {!agent.mine && visitorRecommendation && agent.rec_id === sharedRecommendation?.id && <p className="run-notice" role="status">Your run is saved for this browser. <button type="button" onClick={() => showSavedRecommendation(visitorRecommendation, true)}>Show your run</button></p>}
                {agent.instruction && <p className="owner-ask"><b>Owner asked</b> “{agent.instruction}”</p>}
                {agent.status === "running" && <div className="skel" aria-live="polite"><i /><i /><i /><span>Claude is reading the ledger…</span></div>}
                {(agent.trace || []).filter((s) => s.tool === "submit_recommendation" && s.why).map((s, k) => <div key={k} className="dec bad"><b>Code refused Claude's {k === 0 ? "first" : "next"} proposal</b>{s.why.map((w) => <small key={w}>{w}</small>)}</div>)}
                {agent.status === "error" && <p className="err">{agent.error}</p>}
                
                {actions.slice(0, allAct ? undefined : 2).map((a, i) => (
                  <article key={i} className={`action ${decisions[i]?.verdict || ""}`}>
                    <span className={`tag ${a.change}`}>Budget · {CHANGE[a.change] || a.change}</span>
                    <b>{adName(a.ad)}</b>
                    <p>{a.reason}</p>
                    <details className="ev"><summary>Evidence: {a.evidence.length} item{a.evidence.length === 1 ? "" : "s"} checked in code</summary><div className="chips">{a.evidence.map((e) => <span key={e} className="chip">{e.startsWith("row:") ? `${short(e.slice(4))} row` : `capture ${e}`}</span>)}</div></details>
                    {decisions[i] ? <p className="decided">{decisions[i].verdict === "approved" ? (a.change === "keep" ? "Agreed: no change" : "Approved") : "Dismissed"} · logged {new Date(decisions[i].at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} · {decisions[i].id}</p>
                      : <div className="row"><button className="primary" onClick={() => decide(i, "approved")}>{a.change === "keep" ? "Agree, no change" : "Approve"}</button><button onClick={() => decide(i, "dismissed")}>Dismiss</button></div>}
                  </article>
                ))}
                {actions.length > 2 && <button type="button" className="more-row" onClick={() => setAllAct((v) => !v)}>{allAct ? "Show fewer" : `All ${actions.length} changes`}<span>{allAct ? "−" : "+"}</span></button>}
                {(agent.source || agent.trace) && <details className="ev"><summary>Run details</summary>{agent.source && <p className="trace">From the {agent.source}</p>}{agent.trace && <p className="trace">{agent.trace.map((s) => s.tool + (s.ad ? `(${s.ad})` : "")).join(" → ")} · {(agent.ms / 1000).toFixed(1)} s</p>}</details>}
              </div>
              {revenue.status !== "idle" && <PhoneDisclosure id="revenue" title="Invoice proposals" className="phone-disclosure-inner"
                summaryText={revenue.status === "running" ? "Working…" : revenue.status === "error" ? "Needs attention" : `${revenue.drafts.filter((d) => d.id).length} drafts`}>
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
              </PhoneDisclosure>}
              <PhoneDisclosure id="invoices" title="Invoice history" className="phone-disclosure-inner" summaryText={`${invoices.length} invoices`}>
                <div className="sub-head"><b>Invoices</b><span className="row">{invoices.some((i) => i.status === "SENT" || i.status === "UNPAID") && <button className="mini" disabled={chase.status === "running"} onClick={askChase}>{chase.status === "running" ? "Chasing…" : "Chase unpaid"}</button>}<button className="mini" onClick={syncInvoices}>Refresh</button></span></div>
                {invoices.some((i) => i.status === "SENT" || i.status === "UNPAID") && <p className="muted small">Demo clock: reminders after 1 hour (3 days in a real shop).</p>}
                {chase.status === "error" && <p className="err">{chase.error}</p>}
                {chase.status === "done" && <div className="dec ok"><b>Chase agent: {chase.reminded.length} reminded{chase.eligible != null ? ` of ${chase.eligible} waiting` : ""}</b><small>{chase.summary}</small>
                  <small className="trace">{chase.trace.map((s) => s.refused ? `${s.tool} refused` : s.tool).join(" → ")}{chase.ms ? ` · ${(chase.ms / 1000).toFixed(1)} s` : ""} · reminders sent with PayPal's Agent Toolkit</small></div>}
                {syncNote && <p className="note" role="status">Could not re-check sent invoices with PayPal: {syncNote}</p>}
                {invoices.length === 0 && <p className="muted">No drafts yet. Open the Studio assistant and choose "Invoice warm leads".</p>}
                {[...invoices].sort((x, y) => (x.status === "CANCELLED") - (y.status === "CANCELLED")).slice(0, allInv ? undefined : 5).map((i) => (
                  <div key={i.id} className={`cap inv ${i.sent_by ? "agent" : ""}`}>
                    <span><b>{i.lead.replace(" (fictional)", "")}</b><small>{short(i.ad)} · {money(i.amount)}{i.lines?.length > 1 ? ` · ${i.lines.length} children, sibling 20% off` : ""}{i.sent_by ? " · sent by the agent" : i.status === "DRAFT" ? (i.drafted_by ? " · drafted by the agent" : " · draft") : ""}{i.reminded_at && !["PAID", "CANCELLED"].includes(i.status) ? ` · reminded ${clock(i.reminded_at)}` : ""}</small>{sending[i.id] && <small className="agent-say" role="status">{sending[i.id]}</small>}</span>
                    {i.status === "DRAFT" ? <button className="mini go" disabled={sending[i.id] === "Agent checking and sending…"} onClick={() => send(i.id)}>Approve</button>
                      : i.status === "PAID" ? <span className="ok">Paid</span>
                      : i.status === "CANCELLED" ? <span className="muted">Cancelled, not owed</span>
                      : i.pay_url ? <a href={i.pay_url} target="_blank" rel="noopener noreferrer">Sent ↗</a> : <span className="muted">{i.status}</span>}
                  </div>
                ))}
              </PhoneDisclosure>
              {invoices.length > 5 && <button type="button" className="more-row" onClick={() => setAllInv((v) => !v)}>{allInv ? "Show fewer" : `All ${invoices.length} invoices`}<span>{allInv ? "−" : "+"}</span></button>}
              <button className="btn wide" onClick={openAssistant}>Open the Studio assistant</button>
            </section>

            <PhoneDisclosure title="Activity" className="card" summaryText={`${activity.length} recent events`}>
              <div className="card-head phone-section-head"><h2>Activity</h2></div>
              <ol className="feed">
                {activity.map((e, k) => <li key={k} className={e.kind}><i /><span>{e.text}</span><time dateTime={e.at}>{clock(e.at)}</time></li>)}
                {!activity.length && <li className="muted">No payments yet.</li>}
              </ol>
            </PhoneDisclosure>

            <PhoneDisclosure id="links" title="Ad links & data" className="card">
              <div className="card-head phone-section-head"><h2>Ad links</h2></div>
              <p className="muted">Each opens the shop with an ad click.</p>
              <div className="links">
                {AD_LINKS.map(([k, s]) => <a key={k} className="adlink" href={adLink(k, s)}>{adName(k)}<small>{s === "fb" ? "Meta" : "Google"} click</small></a>)}
              </div>
              <details className="csv">
                <summary>Use your own ad export</summary>
                <textarea value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} aria-label="Ad export CSV (ad, spend, leads)" />
                <button className="primary" onClick={() => load(csv)}>Reconcile again</button>
                {state?.csv_errors?.length ? <p className="note">{state.csv_errors.join(" ")}</p> : null}
              </details>
            </PhoneDisclosure>
          </aside>
        </div>

        <section id="studio" className="card studio-card" ref={studioBox} aria-label="AG Studio">
          <div className="card-head">
            <div><h2>{view === "report" ? "The shop's PayPal workspace · AG Studio" : "Claimed vs confirmed, in AG Studio"}</h2><p className="muted">{STUDIO_PAGE ? "AI agents do the PayPal work here; nothing reaches a customer until you click." : "Seven custom widgets, a real shop's book, cross-filters, Claude in the assistant."}{layoutNote ? ` ${layoutNote}.` : ""}</p></div>
            <div className="row">
              {view === "report" ? <button className="btn" onClick={() => goDesk("approvals")}>Approvals {myDecisionCount > 0 && <span className="count">{myDecisionCount}</span>}</button> : <a className="btn" href="#report">Open the report</a>}
              <button className="btn" onClick={() => setLayoutNote(studio.current?.saveLayout() ? "Saved in this browser" : "Could not save")}>Save layout</button>
              <button className="btn" onClick={() => { studio.current?.resetLayout(); setLayoutNote("Back to the default report"); }}>Reset</button>
              <button className="btn dark" onClick={openAssistant}>Open the Studio assistant</button>
            </div>
          </div>
          {STUDIO_PAGE && <GuidedTour
            autoStart={/[?&]tour=1(?:&|$)/.test(location.search)}
            ready={studioReady}
            onStep={runGuidedTourStep}
            onEnd={() => document.querySelectorAll(".ps-point").forEach((el) => el.classList.remove("ps-point"))}
            readBack={readBack}
            pointTo={pointTo}
            openReplay={openReplay}
            goAgents={() => selectStudioPage("agents")}
          />}
          <div className="studio-pages" role="group" aria-label="Report pages">
            {/* three pages carry the story; the rest fold under More pages */}
            {[["overview", "Ads vs PayPal"], ["agents", "Agents → PayPal"], ["shop", "Real shop: October"], ...(morePages || !["overview", "agents", "shop"].includes(studioPage) ? [["perad", "Per ad"], ["captures", "PayPal captures"], ["ledger", "Ad → PayPal → Meta"], ["owes", "Who still owes"], ["mine", "Your page"]] : [])].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={studioPage === id} className={studioPage === id ? "on" : ""} onClick={() => selectStudioPage(id)}>{label}</button>
            ))}
            {!morePages && ["overview", "agents", "shop"].includes(studioPage) && <button type="button" className="more-pages" onClick={() => setMorePages(true)}>More pages (5) ▾</button>}
          </div>
          <div className="studio">
            {studioOn && license !== undefined
              ? <StudioGuard><Suspense fallback={<div className="studio-wait">Loading AG Studio…</div>}><StudioPanel ref={studio} state={state} invoices={invoices} license={license} gridEnterprise={gridEnterprise} csvRef={csvRef} onInvoices={onStudioInvoices} onNudge={onNudge} onRecommendation={onRecommendation} /></Suspense></StudioGuard>
              : <a className="studio-wait" href="#report">Open the AG Studio report</a>}
          </div>
        </section>

        <footer className="foot">Fictional demo shop · real PayPal sandbox calls · Meta test events
          <div className="more-links" aria-label="More pages"><b>More</b><a href="/trail">Money trail</a><a href="/scenarios.html">Scenarios</a><a href="/connect.html">Connect a shop</a><a href="/data">Data use</a><a href="https://github.com/longtt-marketing/paid-signal">Code</a></div>
        </footer>
      </main>
      {toast && <div className="toast" role="status"><span>{toast.msg}</span>{toast.go && <button className="mini go" onClick={() => { goDesk(toast.go); setToast(""); }}>Review</button>}</div>}
    </div>
  );
}
