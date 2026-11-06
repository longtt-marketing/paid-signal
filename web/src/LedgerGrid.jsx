// The PayPal ledger as an AG Grid table on the dashboard (AG Grid Community): every capture with its ad, how it was
// paid, the ledger's status (paid, held as a possible double payment, refunded), what Meta received, and the PayPal
// capture id, which opens the money trail. By default the rows are grouped by ad with a subtotal row per ad; a pinned
// total row follows the filters. The row's button calls the same endpoints as before: a refund goes through the
// server's refund route (the server checks it), "Count it" marks a held payment as a separate order.
import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { groupByAd, totalsOf } from "./gridTotals.js";

ModuleRegistry.registerModules([AllCommunityModule]);

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
function ActionCell({ data, context, node }) {
  if (!data || node.rowPinned || data.isGroup) return null;
  if (data.held) return <button type="button" className="mini" onClick={() => context.onCount(data.capture_id)}>Count it</button>;
  if (data.refundable) return <button type="button" className="mini" onClick={() => context.onRefund(data.raw)}>Refund</button>;
  return null;
}

export default function LedgerGrid({ payments, dup, metaSent, adName, onRefund, onCount }) {
  const grid = useRef(null), box = useRef(null);
  const [grouped, setGrouped] = useState(true);
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
  const data = useMemo(() => (grouped ? groupByAd(rows) : rows), [rows, grouped]);
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
    { headerName: "", colId: "act", width: 104, minWidth: 104, pinned: "right", cellStyle: { paddingLeft: 6, paddingRight: 8 }, sortable: false, filter: false, cellRenderer: ActionCell, hide: tiny, suppressHeaderMenuButton: true },
  ], [narrow, tiny, grouped]);
  const retotal = (api) => { const list = []; api.forEachNodeAfterFilter((n) => n.data && !n.data.isGroup && list.push(n.data)); setTotal(totalsOf(list, narrow)); };
  const exportCsv = () => grid.current?.api?.exportDataAsCsv({ fileName: "paypal-ledger.csv", columnKeys: ["ad", "amount", "kept", "via", "status", "meta", "capture_id"],
    shouldRowBeSkipped: (p) => Boolean(p.node.data?.isGroup), processCellCallback: (p) => (p.column.getColId() === "ad" ? p.node.data?.ad : p.value) });
  return (
    <div className="ledger-grid" ref={box}>
      <div style={{ height: 520 }}>
        <AgGridReact ref={grid} theme={theme} rowData={data} columnDefs={cols} context={{ onRefund, onCount, narrow, grouped }}
          defaultColDef={{ sortable: !grouped, filter: !grouped, resizable: true, suppressMovable: true }}
          domLayout="normal" getRowId={(p) => p.data?.capture_id || p.data?.groupId || "total"} rowHeight={44}
          getRowClass={(p) => (p.node.rowPinned ? "row-total" : p.data?.isGroup ? "row-group" : p.data?.held ? "row-held" : "")}
          pinnedBottomRowData={total ? [total] : []} tooltipShowDelay={200}
          onFirstDataRendered={(e) => retotal(e.api)} onGridSizeChanged={(e) => retotal(e.api)} onFilterChanged={(e) => retotal(e.api)} onRowDataUpdated={(e) => retotal(e.api)} />
      </div>
      <div className="ledger-foot"><span className="muted">{grouped ? "Grouped by ad, with a subtotal per ad; ungroup to sort and filter (the total row follows the filters)" : "Sort or filter any column; the total row follows the filters"}; {grouped || narrow ? "a payment's link" : "a capture id"} opens its money trail; hover a held row for why.</span>
        <span className="ledger-acts"><button type="button" className="btn ghost" onClick={() => setGrouped((g) => !g)}>{grouped ? "Ungroup" : "Group by ad"}</button><button type="button" className="btn ghost" onClick={exportCsv}>Export CSV</button></span></div>
    </div>
  );
}
