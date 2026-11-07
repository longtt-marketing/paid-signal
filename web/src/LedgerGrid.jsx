// The PayPal ledger as an AG Grid table on the dashboard (AG Grid Community): every capture with its ad, how it was
// paid, the ledger's status (paid, held as a possible double payment, refunded), what Meta received, and the PayPal
// capture id, which opens the money trail. By default the rows are grouped by ad with a subtotal row per ad; a pinned
// total row follows the filters. Above it an AG Charts bar chart (Community, MIT) shows money kept, held and refunded
// per ad; a click on a bar filters the grid to that ad. The last column is the owner's Decision, edited in the cell:
// "Refund…" goes through the server's refund route (the server checks it), "Separate order…" counts a held payment.
import { useEffect, useMemo, useRef, useState } from "react";
import { AgCharts, BarSeriesModule, CategoryAxisModule, LegendModule, ModuleRegistry as ChartModules, NumberAxisModule } from "ag-charts-community";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { byAdChart, decisionOf, groupByAd, totalsOf } from "./gridTotals.js";

ModuleRegistry.registerModules([AllCommunityModule]);
ChartModules.registerModules([BarSeriesModule, CategoryAxisModule, NumberAxisModule, LegendModule]);

const theme = themeQuartz.withParams({
  fontFamily: "'Inter Tight', system-ui, sans-serif", fontSize: 13, foregroundColor: "#111111", headerTextColor: "#5E5E5E",
  headerBackgroundColor: "#F7F7F5", headerFontWeight: 600, borderColor: "#E6E6E3", rowBorder: { color: "#F0F0EE" },
  accentColor: "#0F8A4B", wrapperBorderRadius: 12, rowHoverColor: "#F7F7F5", spacing: 7,
});
const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const trail = (id) => `/trail?capture=${encodeURIComponent(id)}`;

function StatusCell({ data, node }) {
  if (!data) return null;
  if (node.rowPinned || data.isGroup) return <b className="grid-total">{data.status}</b>;
  const cls = data.status === "Paid" ? "pill good" : data.status.startsWith("Held") ? "pill warn" : "pill";
  return <span className={cls}>{data.status}</span>;
}
function CaptureCell({ value, node, data }) {
  if (!data || node.rowPinned || data.isGroup) return null;
  return <a className="grid-id" href={trail(value)} title="Open its money trail">{value}</a>;
}
function AdCell({ data, context, node }) {
  if (!data) return null;
  if (node.rowPinned || data.isGroup) return <b className="grid-total">{data.ad}</b>;
  // inside a group the ad is the group's: the row shows how it was paid and links its PayPal capture to the money trail
  if (context.grouped) return <a className="grid-ad grid-leaf" href={trail(data.capture_id)} title={`PayPal capture ${data.capture_id}: open its money trail`}>{data.via} · {data.capture_id.slice(0, 8)}…</a>;
  return context.narrow ? <a className="grid-ad" href={trail(data.capture_id)} title={`PayPal capture ${data.capture_id}: open its money trail`}>{data.ad}</a> : <span title={data.capture_id}>{data.ad}</span>;
}
// the Decision cell: a select the owner edits in place; rows with nothing left to decide show plain text
// the Decision editor: one click on the cell opens the choices under it; picking a new one acts, Esc closes
function DecisionEditor({ data, stopEditing, act }) {
  const d = decisionOf(data), first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  const pick = (o) => { stopEditing(true); if (o !== d.value) act(o, data); };
  return (
    <div className="decide-menu" role="menu" aria-label="Decision">
      {d.options.map((o, i) => <button key={o} ref={i === 0 ? first : null} type="button" role="menuitem" className={o === d.value ? "on" : ""} onClick={() => pick(o)}>{o === d.value ? `${o} (now)` : o}</button>)}
    </div>
  );
}
function DecisionCell({ data, node }) {
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

export default function LedgerGrid({ payments, dup, metaSent, adName, onRefund, onCount }) {
  const grid = useRef(null), box = useRef(null);
  const [grouped, setGrouped] = useState(true);
  const [pick, setPick] = useState("");
  const onPick = useMemo(() => (ad) => setPick((cur) => (cur === ad ? "" : ad)), []);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const [total, setTotal] = useState(null);
  const narrow = width > 0 && width < 760, tiny = width > 0 && width < 420;
  const rows = useMemo(() => payments.slice().reverse().map((p) => {
    const held = Boolean(dup[p.capture_id]);
    const part = Number(p.refunded_amount) > 0 && p.status !== "REFUNDED";
    return {
      raw: p, capture_id: p.capture_id, ad: p.ad && p.ad !== "direct" ? adName(p.ad) : "No ad click", amount: Number(p.amount),
      via: p.via === "invoice" ? "invoice" : "checkout",
      status: held ? "Held: double?" : p.status === "REFUNDED" ? "Refunded" : part ? `Paid, ${money(p.refunded_amount)} back` : "Paid",
      meta: metaSent[p.capture_id]?.ok ? "Received" : p.status === "REFUNDED" ? "No purchase" : "Not sent",
      kept: held || p.status === "REFUNDED" ? 0 : Number(p.amount) - Number(p.refunded_amount || 0),
      held, why: held ? `Held out of paid orders: same payer and ad as ${dup[p.capture_id].first}, ${dup[p.capture_id].seconds} s apart. Count it if it is a separate order.` : "", refundable: !held && (p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED"),
    };
  }), [payments, dup, metaSent, adName]);
  // grouped: one subtotal row per ad, then its payments; sorting and filtering are for the ungrouped view
  // a bar picked in the chart narrows the grid to that ad (the total row follows)
  const shown = useMemo(() => (pick ? rows.filter((r) => r.ad === pick) : rows), [rows, pick]);
  const data = useMemo(() => (grouped ? groupByAd(shown) : shown), [shown, grouped]);
  const cols = useMemo(() => [
    { headerName: "Ad click", children: [{ field: "ad", headerName: grouped ? "Ad, then each payment" : "Ad", flex: 1.4, minWidth: grouped ? 150 : 100, cellRenderer: AdCell }] },
    { headerName: "PayPal", children: [
      { field: "amount", headerName: "Amount", width: 92, valueFormatter: (p) => money(p.value), type: "rightAligned", hide: narrow && grouped },
      { field: "via", headerName: "Via", width: 100, hide: narrow || grouped },
      { field: "capture_id", headerName: "Capture", flex: 1, minWidth: 170, cellRenderer: CaptureCell, hide: narrow },
    ] },
    { headerName: "Ledger", children: [
      { field: "kept", headerName: "Kept", width: 92, valueFormatter: (p) => money(p.value), type: "rightAligned", headerTooltip: "Money kept after refunds; held double payments count 0" },
      { field: "status", headerName: "Status", width: narrow ? 140 : 190, cellRenderer: StatusCell, tooltipValueGetter: (p) => p.data?.why || null },
    ] },
    { headerName: "Meta", children: [{ field: "meta", headerName: "Purchase event", width: 140, hide: narrow }] },
    { headerName: "Decision", colId: "decision", width: tiny ? 112 : 150, minWidth: 104, pinned: tiny ? null : "right", sortable: false, filter: false, suppressHeaderMenuButton: true,
      headerTooltip: "The owner's call on each payment: Keep or Refund…, Hold or Separate order…; the server still checks it",
      valueGetter: (p) => (p.data && !p.data.isGroup && !p.node.rowPinned ? decisionOf(p.data).value : ""), cellRenderer: DecisionCell,
      editable: (p) => Boolean(p.data && !p.data.isGroup && !p.node.rowPinned && decisionOf(p.data).options.length), singleClickEdit: true,
      // the cell never stores the choice: it calls the same server routes as before, and the reloaded ledger shows the result
      cellEditor: DecisionEditor, cellEditorPopup: true, cellEditorPopupPosition: "under",
      cellEditorParams: { act: (choice, row) => (choice === "Refund…" ? onRefund(row.raw) : choice === "Separate order…" ? onCount(row.capture_id) : null) },
      valueSetter: () => false },
  ], [narrow, tiny, grouped, onRefund, onCount]);
  const retotal = (api) => { const list = []; api.forEachNodeAfterFilter((n) => n.data && !n.data.isGroup && list.push(n.data)); setTotal(totalsOf(list, narrow)); };
  const exportCsv = () => grid.current?.api?.exportDataAsCsv({ fileName: "paypal-ledger.csv", columnKeys: ["ad", "amount", "kept", "via", "status", "meta", "capture_id"],
    shouldRowBeSkipped: (p) => Boolean(p.node.data?.isGroup), processCellCallback: (p) => (p.column.getColId() === "ad" ? p.node.data?.ad : p.value) });
  return (
    <div className="ledger-grid" ref={box}>
      <KeptByAd rows={rows} pick={pick} onPick={onPick} narrow={narrow} />
      {pick && <div className="grid-pick"><button type="button" className="chip-x" onClick={() => setPick("")} aria-label={`Show every ad, not only ${pick}`}>Showing: {pick} ×</button><span className="muted">the total row follows the filter</span></div>}
      <div style={{ height: data.length > 10 ? 520 : "auto" }}>
        <AgGridReact ref={grid} theme={theme} rowData={data} columnDefs={cols} context={{ narrow, grouped }}
          defaultColDef={{ sortable: !grouped, filter: !grouped, resizable: true, suppressMovable: true }}
          domLayout={data.length > 10 ? "normal" : "autoHeight"} getRowId={(p) => p.data?.capture_id || p.data?.groupId || "total"} rowHeight={44}
          getRowClass={(p) => (p.node.rowPinned ? "row-total" : p.data?.isGroup ? "row-group" : p.data?.held ? "row-held" : "")}
          pinnedBottomRowData={total ? [total] : []} tooltipShowDelay={200}
          // one click on a Decision cell opens its list of choices at once
          onFirstDataRendered={(e) => retotal(e.api)} onGridSizeChanged={(e) => retotal(e.api)} onFilterChanged={(e) => retotal(e.api)} onRowDataUpdated={(e) => retotal(e.api)} />
      </div>
      <div className="ledger-foot"><span className="muted">{grouped ? "Grouped by ad, with a subtotal per ad; ungroup to sort and filter (the total row follows the filters)" : "Sort or filter any column; the total row follows the filters"}; {grouped || narrow ? "a payment's link" : "a capture id"} opens its money trail; hover a held row for why; click a Decision cell to change it.</span>
        <span className="ledger-acts"><button type="button" className="btn ghost" onClick={() => setGrouped((g) => !g)}>{grouped ? "Ungroup" : "Group by ad"}</button><button type="button" className="btn ghost" onClick={exportCsv}>Export CSV</button></span></div>
    </div>
  );
}
