// The PayPal ledger as an AG Grid table on the dashboard (AG Grid Community): every capture with its ad, how it was
// paid, the ledger's status (paid, held as a possible double payment, refunded), what Meta received, and the PayPal
// capture id, which opens the money trail. By default the rows are grouped by ad with a subtotal row per ad; a pinned
// total row follows the filters. Above it an AG Charts bar chart (Community, MIT) shows money kept, held and refunded
// per ad; a click on a bar filters the grid to that ad. The last column is the owner's Decision, edited in the cell:
// "Refund…" goes through the server's refund route (the server checks it), "Separate order…" counts a held payment.
// The ▸ on a payment opens its trail under it: ad click → PayPal capture → ledger → what Meta heard. The same pieces
// make the PayPal ledger widget inside AG Studio (LedgerWidget.jsx).
import { useEffect, useMemo, useRef, useState } from "react";
import { AgCharts, BarSeriesModule, CategoryAxisModule, LegendModule, ModuleRegistry as ChartModules, NumberAxisModule } from "ag-charts-community";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, themeQuartz } from "ag-grid-community";
import { GRID_MODULES } from "./gridModules.js";
import { byAdChart, decisionOf, groupByAd, totalsOf, trailHeight, trailSteps, withTrail } from "./gridTotals.js";
import { AD_CLAIMS, claimCell, getClaims, searchRows } from "./adClaims.js";
import { disputeState } from "../../src/ledger.js";

ModuleRegistry.registerModules(GRID_MODULES);
ChartModules.registerModules([BarSeriesModule, CategoryAxisModule, NumberAxisModule, LegendModule]);

const theme = themeQuartz.withParams({
  fontFamily: "'Inter Tight', system-ui, sans-serif", fontSize: 13, foregroundColor: "#111111", headerTextColor: "#5E5E5E",
  headerBackgroundColor: "#F7F7F5", headerFontWeight: 600, borderColor: "#E6E6E3", rowBorder: { color: "#F0F0EE" },
  accentColor: "#0F8A4B", wrapperBorderRadius: 12, rowHoverColor: "#F7F7F5", spacing: 7,
});
export const money = (v) => `$${Number(v || 0).toFixed(2)}`;
export const trail = (id) => `/trail?capture=${encodeURIComponent(id)}`;

export function StatusCell({ data, node }) {
  if (!data) return null;
  if (node.rowPinned || data.isGroup) return <b className="grid-total">{data.status}</b>;
  const cls = data.status === "Paid" ? "pill good" : data.status.startsWith("Held") ? "pill warn" : "pill";
  return <span className={cls}>{data.status}</span>;
}
function CaptureCell({ value, node, data }) {
  if (!data || node.rowPinned || data.isGroup) return null;
  return <a className="grid-id" href={trail(value)} title="Open its money trail">{value}</a>;
}
// what each ad claims against what PayPal confirms, kept current from the dashboard's reconciliation
export function useClaims() {
  const [claims, setClaims] = useState(getClaims());
  useEffect(() => { const on = (e) => setClaims(e.detail || {}); addEventListener(AD_CLAIMS, on); return () => removeEventListener(AD_CLAIMS, on); }, []);
  return claims;
}
// on an ad's subtotal row: "31 leads → 1 paid" and a bar of how much of the ad report's claim PayPal confirms
export function ClaimCell({ data, context }) {
  if (!data?.isGroup) return null;
  const c = claimCell(context.claims?.[String(data.ad).replace(/ \(\d+\)$/, "")]);
  if (!c) return null;
  return (
    <span className="claim-cell" title={`The ad report counts ${c.text.split(" → ")[0]}; PayPal confirms ${c.text.split(" → ")[1]}`}>
      <span className="claim-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, Math.round(c.share * 100))}%` }} /></span>{c.text}
    </span>
  );
}
// the search box over the payments; the grid groups what matches
export function SearchBox({ value, onChange }) {
  return <input type="search" className="grid-search" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search payments: ad, capture, status, Meta" aria-label="Search payments" />;
}

// the ▸ that opens a payment's trail row under it
export function TrailToggle({ data, context }) {
  const on = context.open?.has(data.capture_id);
  return <button type="button" className="trail-toggle" aria-expanded={on} aria-label={`${on ? "Close" : "Open"} the trail of capture ${data.capture_id}`} onClick={(e) => { e.stopPropagation(); context.toggle(data.capture_id); }}>{on ? "▾" : "▸"}</button>;
}
export function AdCell({ data, context, node }) {
  if (!data) return null;
  if (node.rowPinned || data.isGroup) return <b className="grid-total">{data.ad}</b>;
  // inside a group the ad is the group's: the row shows how it was paid; ▸ opens its trail
  if (context.grouped) return <span className="grid-leaf-wrap"><TrailToggle data={data} context={context} /><span className="grid-leaf">{data.via} · {data.capture_id.slice(0, 8)}…</span></span>;
  return <span className="grid-leaf-wrap"><TrailToggle data={data} context={context} /><span title={data.capture_id}>{data.ad}</span></span>;
}
// the trail row under a payment: four steps, then the full money trail page
export function TrailRow({ data }) {
  if (!data?.of) return null;
  return (
    <div className="trail-row">
      <ol>{trailSteps(data.of).map((s, i) => <li key={s.k}><b>{i + 1} · {s.k}</b><span>{s.v}</span></li>)}</ol>
      <a href={trail(data.of.capture_id)}>Full money trail →</a>
    </div>
  );
}
// the Decision cell: a select the owner edits in place; rows with nothing left to decide show plain text
// the Decision editor: one click on the cell opens the choices under it; picking a new one acts, Esc closes
export function DecisionEditor({ data, stopEditing, act }) {
  const d = decisionOf(data), first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  const pick = (o) => { stopEditing(true); if (o !== d.value) act(o, data); };
  return (
    <div className="decide-menu" role="menu" aria-label="Decision">
      {d.options.map((o, i) => <button key={o} ref={i === 0 ? first : null} type="button" role="menuitem" className={o === d.value ? "on" : ""} onClick={() => pick(o)}>{o === d.value ? `${o} (now)` : o}</button>)}
    </div>
  );
}
export function DecisionCell({ data, node }) {
  if (!data || node.rowPinned || data.isGroup) return null;
  const d = decisionOf(data);
  if (!d.options.length) return <span className="muted">{d.value}</span>;
  return <span className={`grid-decide${data.held ? " warn" : ""}`} title="Click to decide">{d.value} ▾</span>;
}

// money kept, held and refunded per ad, as stacked bars; a click on a bar picks that ad, a second click clears it
const BAR = { kept: "#0F8A4B", held: "#E8A33D", refunded: "#C9C3B4" };
function KeptByAd({ rows, pick, onPick, narrow }) {
  const box = useRef(null), chart = useRef(null);
  const data = useMemo(() => byAdChart(rows), [rows]);
  const options = useMemo(() => ({
    data, height: 52 + 34 * Math.max(1, data.length), padding: { top: 4, right: 12, bottom: 4, left: 4 },
    background: { visible: false }, theme: { params: { fontFamily: "'Inter Tight', system-ui, sans-serif", fontSize: 12.5 } },
    series: [["kept", "Kept"], ["held", "Held: double?"], ["refunded", "Refunded"]].map(([k, name]) => ({
      type: "bar", direction: "horizontal", xKey: "ad", yKey: k, yName: name, stacked: true, fill: BAR[k],
      itemStyler: ({ datum }) => ({ fillOpacity: pick && datum.ad !== pick ? 0.28 : 1 }),
      listeners: { seriesNodeClick: ({ datum }) => onPick(datum.ad) },
    })),
    // on a phone the ad's name alone ("Testimonial"), its format is in the grid
    axes: { x: { type: "category", position: "left", label: { formatter: ({ value }) => (narrow ? String(value).split(" · ")[0] : value) } }, y: { type: "number", position: "bottom", label: { formatter: ({ value }) => `$${value}` } } },
    legend: { position: "bottom", item: { marker: { size: 10 } } },
  }), [data, pick, onPick, narrow]);
  useEffect(() => {
    if (!box.current) return;
    if (!chart.current) chart.current = AgCharts.create({ ...options, container: box.current });
    else chart.current.update({ ...options, container: box.current });
  }, [options]);
  useEffect(() => () => { chart.current?.destroy(); chart.current = null; }, []);
  return <div className="kept-chart"><div className="kept-head"><b>Money kept by ad</b><span className="muted">click a bar to filter the table</span></div><div ref={box} /></div>;
}

// The owner's Decision, confirmed in a small form under the grid (an amount, or why it is a separate order) instead of a
// browser prompt: the amount is checked against what is left to refund before the button works, and the server checks
// it again. submit(kind, row, value) does the call; both ledgers use this.
export function useDecisionForm(submit) {
  const [ask, setAsk] = useState(null);
  const open = (choice, row) => {
    const left = (Number(row.raw.amount) - Number(row.raw.refunded_amount || 0)).toFixed(2);
    if (choice === "Refund…") setAsk({ kind: "refund", row, left, value: left, busy: false, error: "" });
    else if (choice === "Separate order…") setAsk({ kind: "separate", row, value: "", busy: false, error: "" });
  };
  const problem = (a) => {
    if (!a) return "";
    if (a.kind === "separate") return a.value.trim().length < 3 ? "Say why, for example: a second child." : "";
    const v = Number(a.value);
    return !(v > 0) ? "Enter an amount above $0." : v > Number(a.left) + 1e-9 ? `At most $${a.left} is left to refund.` : "";
  };
  const confirm = async () => {
    const a = ask; if (!a || problem(a)) return;
    setAsk({ ...a, busy: true, error: "" });
    try { await submit(a.kind, a.row, a.kind === "refund" ? Number(a.value).toFixed(2) : a.value.trim()); setAsk(null); }
    catch (e) { setAsk({ ...a, busy: false, error: e.message }); }
  };
  return { ask, setAsk, open, problem, confirm };
}
export function DecisionForm({ form }) {
  const { ask, setAsk, problem, confirm } = form;
  if (!ask) return null;
  return (
    <form className="ledger-ask" onSubmit={(e) => { e.preventDefault(); confirm(); }} aria-label={ask.kind === "refund" ? "Confirm a refund" : "Count as a separate order"}>
      <b>{ask.kind === "refund" ? `Refund capture ${ask.row.capture_id} (${ask.row.ad})` : `Count ${ask.row.capture_id} as a separate order`}</b>
      {ask.kind === "refund"
        ? <label>Amount, USD (up to ${ask.left}) <input type="number" step="0.01" min="0.01" max={ask.left} value={ask.value} autoFocus onChange={(e) => setAsk({ ...ask, value: e.target.value, error: "" })} /></label>
        : <label>Why is it not a double payment? <input type="text" value={ask.value} autoFocus placeholder="for example: a second child" onChange={(e) => setAsk({ ...ask, value: e.target.value, error: "" })} /></label>}
      <button type="submit" className="ledger-ask-go" disabled={ask.busy || Boolean(problem(ask))}>{ask.busy ? "Checking…" : ask.kind === "refund" ? "Refund through PayPal" : "Count it"}</button>
      <button type="button" className="ledger-ask-x" onClick={() => setAsk(null)} disabled={ask.busy}>Cancel</button>
      <span className="ledger-ask-note">{ask.error || problem(ask) || "The server checks it again; on the demo's seeded payments a refund is only previewed."}</span>
    </form>
  );
}

export default function LedgerGrid({ payments, dup, metaSent, adName, onRefund, onCount }) {
  const grid = useRef(null), box = useRef(null);
  const [grouped, setGrouped] = useState(true);
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [q, setQ] = useState("");
  const claims = useClaims();
  const toggle = useMemo(() => (id) => setOpen((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const onPick = useMemo(() => (ad) => setPick((cur) => (cur === ad ? "" : ad)), []);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const [total, setTotal] = useState(null);
  // the owner's Decision is confirmed in the form under the grid; App does the server call
  const decisionForm = useDecisionForm((kind, row, value) => (kind === "refund" ? onRefund(row.raw, value) : onCount(row.capture_id, value)));
  const narrow = width > 0 && width < 760, tiny = width > 0 && width < 420;
  const rows = useMemo(() => payments.slice().reverse().map((p) => {
    const held = Boolean(dup[p.capture_id]);
    const part = Number(p.refunded_amount) > 0 && p.status !== "REFUNDED";
    // a PayPal dispute: open or unclear is held out of revenue, lost is money gone (the same rule as the reconciliation)
    const ds = disputeState(p), disputed = ds === "open" || ds === "unclear", lost = ds === "lost";
    return {
      raw: p, capture_id: p.capture_id, ad: p.ad && p.ad !== "direct" ? adName(p.ad) : "No ad click", amount: Number(p.amount),
      via: p.via === "invoice" ? "invoice" : "checkout",
      status: lost ? "Dispute lost" : disputed ? "Held: dispute" : held ? "Held: double?" : p.status === "REFUNDED" ? "Refunded" : part ? `Paid, ${money(p.refunded_amount)} back` : "Paid",
      meta: metaSent[p.capture_id]?.ok ? "Received" : p.status === "REFUNDED" ? "No purchase" : "Not sent",
      source: p.source === "fb" ? "Meta click" : p.source === "g" ? "Google click" : "", date: String(p.captured_at || "").slice(0, 10),
      metaAt: metaSent[p.capture_id]?.ok && metaSent[p.capture_id].at ? String(metaSent[p.capture_id].at).slice(0, 16).replace("T", " ") : "",
      kept: held || disputed || lost || p.status === "REFUNDED" ? 0 : Number(p.amount) - Number(p.refunded_amount || 0), back: Number(p.refunded_amount || 0), disputed: disputed || lost,
      held, why: disputed ? "Held out of revenue: the buyer opened a PayPal dispute." : lost ? "The buyer won a PayPal dispute: the money is gone." : held ? `Held out of paid orders: same payer and ad as ${dup[p.capture_id].first}, ${dup[p.capture_id].seconds} s apart. Count it if it is a separate order.` : "", refundable: !held && !disputed && !lost && (p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED"),
    };
  }), [payments, dup, metaSent, adName]);
  // grouped: one subtotal row per ad, then its payments; sorting and filtering are for the ungrouped view
  // a bar picked in the chart narrows the grid to that ad (the total row follows)
  const shown = useMemo(() => searchRows(pick ? rows.filter((r) => r.ad === pick) : rows, q), [rows, pick, q]);
  const data = useMemo(() => withTrail(grouped ? groupByAd(shown) : shown, open), [shown, grouped, open]);
  const cols = useMemo(() => [
    { headerName: "Ad click", children: [{ field: "ad", headerName: grouped ? "Ad, then each payment" : "Ad", flex: 1.4, minWidth: grouped ? 150 : 100, cellRenderer: AdCell },
      { colId: "claim", headerName: "Ad report → PayPal", width: 196, cellRenderer: ClaimCell, sortable: false, filter: false, hide: !grouped || narrow, headerTooltip: "Leads the ad report counts, against orders PayPal confirms paid" }] },
    { headerName: "PayPal", children: [
      { field: "amount", headerName: "Amount", width: 92, valueFormatter: (p) => money(p.value), type: "rightAligned", hide: narrow && grouped },
      { field: "via", headerName: "Via", width: 100, hide: narrow || grouped },
      { field: "capture_id", headerName: "Capture", flex: 1, minWidth: 170, cellRenderer: CaptureCell, hide: narrow },
    ] },
    { headerName: "Ledger", children: [
      { field: "kept", headerName: "Kept", width: 92, enableCellChangeFlash: true, valueFormatter: (p) => money(p.value), type: "rightAligned", headerTooltip: "Money kept after refunds; held double payments count 0" },
      { field: "status", headerName: "Status", enableCellChangeFlash: true, width: narrow ? 140 : 190, hide: tiny, cellRenderer: StatusCell, tooltipValueGetter: (p) => p.data?.why || null },
    ] },
    { headerName: "Meta", children: [{ field: "meta", headerName: "Purchase event", width: 140, hide: narrow }] },
    { headerName: "Decision", colId: "decision", width: tiny ? 112 : 150, minWidth: 104, pinned: tiny ? null : "right", sortable: false, filter: false, suppressHeaderMenuButton: true,
      headerTooltip: "The owner's call on each payment: Keep or Refund…, Hold or Separate order…; the server still checks it",
      valueGetter: (p) => (p.data && !p.data.isGroup && !p.node.rowPinned ? decisionOf(p.data).value : ""), cellRenderer: DecisionCell,
      editable: (p) => Boolean(p.data && !p.data.isGroup && !p.node.rowPinned && decisionOf(p.data).options.length), singleClickEdit: true,
      // the cell never stores the choice: it calls the same server routes as before, and the reloaded ledger shows the result
      cellEditor: DecisionEditor, cellEditorPopup: true, cellEditorPopupPosition: "over",
      cellEditorParams: { act: (choice, row) => decisionForm.open(choice, row) },
      valueSetter: () => false },
    // not shown, exported: the CSV carries the capture date, click source, refunded amount and why a payment is held
    { field: "date", headerName: "Captured (UTC date)", hide: true }, { field: "source", headerName: "Click source", hide: true },
    { field: "back", headerName: "Refunded", hide: true, valueFormatter: (p) => money(p.value) }, { field: "why", headerName: "Why held", hide: true },
  ], [narrow, tiny, grouped, onRefund, onCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const retotal = (api) => { const list = []; api.forEachNodeAfterFilter((n) => n.data && !n.data.isGroup && !n.data.isDetail && list.push(n.data)); setTotal(totalsOf(list, narrow)); };
  const exportCsv = () => grid.current?.api?.exportDataAsCsv({ fileName: "paypal-ledger.csv", columnKeys: ["ad", "amount", "kept", "back", "via", "status", "why", "meta", "capture_id", "date", "source"],
    shouldRowBeSkipped: (p) => Boolean(p.node.data?.isGroup || p.node.data?.isDetail), processCellCallback: (p) => (p.column.getColId() === "ad" ? p.node.data?.ad : p.value) });
  return (
    <div className="ledger-grid" ref={box}>
      <KeptByAd rows={rows} pick={pick} onPick={onPick} narrow={narrow} />
      <SearchBox value={q} onChange={setQ} />
      <DecisionForm form={decisionForm} />
      {pick && <div className="grid-pick"><button type="button" className="chip-x" onClick={() => setPick("")} aria-label={`Show every ad, not only ${pick}`}>Showing: {pick} ×</button><span className="muted">the total row follows the filter</span></div>}
      <div style={{ height: data.length > 10 ? 520 : "auto" }}>
        <AgGridReact ref={grid} theme={theme} rowData={data} columnDefs={cols} context={{ narrow, grouped, open, toggle, claims }}
          defaultColDef={{ sortable: !grouped, filter: !grouped, resizable: true, suppressMovable: true }}
          domLayout={data.length > 10 ? "normal" : "autoHeight"} getRowId={(p) => p.data?.detailId || p.data?.capture_id || p.data?.groupId || "total"} getRowHeight={(p) => (p.data?.isDetail ? trailHeight(width) : 44)}
          isFullWidthRow={(p) => Boolean(p.rowNode.data?.isDetail)} fullWidthCellRenderer={TrailRow}
          getRowClass={(p) => (p.node.rowPinned ? "row-total" : p.data?.isGroup ? "row-group" : p.data?.held ? "row-held" : "")}
          pinnedBottomRowData={total ? [total] : []} tooltipShowDelay={200}
          onFirstDataRendered={(e) => retotal(e.api)} onGridSizeChanged={(e) => retotal(e.api)} onFilterChanged={(e) => retotal(e.api)} onRowDataUpdated={(e) => retotal(e.api)} />
      </div>
      <div className="ledger-foot"><span className="muted">{grouped ? "Grouped by ad, with a subtotal per ad; ungroup to sort and filter (the total row follows the filters)" : "Sort or filter any column; the total row follows the filters"}; {narrow ? "" : "a capture id opens its money trail; "}▸ opens a payment's trail; hover a held row for why; click a Decision cell to change it.</span>
        <span className="ledger-acts"><button type="button" className="btn ghost" onClick={() => setGrouped((g) => !g)}>{grouped ? "Ungroup" : "Group by ad"}</button><button type="button" className="btn ghost" onClick={exportCsv}>Export CSV</button></span></div>
    </div>
  );
}
