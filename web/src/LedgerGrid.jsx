// The PayPal ledger as an AG Grid table on the dashboard: every capture with its ad, how it was paid, the ledger's
// status (paid, held as a possible double payment, refunded), what Meta received, and the PayPal capture id, which
// opens the money trail. The row's button calls the same endpoints as before: a refund goes through the server's
// refund route (the server checks it), "Count it" marks a held payment as a separate order. Loaded only when shown.
import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { totalsOf } from "./gridTotals.js";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "'Inter Tight', system-ui, sans-serif", fontSize: 13, foregroundColor: "#111111", headerTextColor: "#5E5E5E",
  headerBackgroundColor: "#F7F7F5", headerFontWeight: 600, borderColor: "#E6E6E3", rowBorder: { color: "#F0F0EE" },
  accentColor: "#0F8A4B", wrapperBorderRadius: 12, rowHoverColor: "#F7F7F5", spacing: 7,
});
const money = (v) => `$${Number(v || 0).toFixed(2)}`;

function StatusCell({ data, node }) {
  if (node.rowPinned) return <b className="grid-total">{data.status}</b>;
  const cls = data.status === "Paid" ? "pill good" : data.status.startsWith("Held") ? "pill warn" : "pill";
  return <span className={cls}>{data.status}</span>;
}
function CaptureCell({ value, node }) {
  if (node.rowPinned) return null;
  return <a className="grid-id" href={`/trail?capture=${encodeURIComponent(value)}`} title="Open its money trail">{value}</a>;
}
function AdCell({ data, context, node }) {
  if (node.rowPinned) return <b className="grid-total">{data.ad}</b>;
  // in a narrow frame the capture column is hidden: the ad name opens the money trail instead
  return context.narrow ? <a className="grid-ad" href={`/trail?capture=${encodeURIComponent(data.capture_id)}`} title={`PayPal capture ${data.capture_id}: open its money trail`}>{data.ad}</a> : <span title={data.capture_id}>{data.ad}</span>;
}
function ActionCell({ data, context, node }) {
  if (node.rowPinned) return null;
  if (data.held) return <button type="button" className="mini" onClick={() => context.onCount(data.capture_id)}>Count it</button>;
  if (data.refundable) return <button type="button" className="mini" onClick={() => context.onRefund(data.raw)}>Refund</button>;
  return null;
}

export default function LedgerGrid({ payments, dup, metaSent, adName, onRefund, onCount }) {
  const grid = useRef(null), box = useRef(null);
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
      held, why: held ? `Held out of paid orders: same payer and ad as ${dup[p.capture_id].first}, ${dup[p.capture_id].seconds} s apart. Count it if it is a separate order.` : "", refundable: !held && (p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED"),
    };
  }), [payments, dup, metaSent, adName]);
  const cols = useMemo(() => [
    { headerName: "Ad click", children: [{ field: "ad", headerName: "Ad", flex: 1.4, minWidth: 100, cellRenderer: AdCell }] },
    { headerName: "PayPal", children: [
      { field: "amount", headerName: "Amount", width: 92, valueFormatter: (p) => money(p.value), type: "rightAligned" },
      { field: "via", headerName: "Via", width: 100, hide: narrow },
      { field: "capture_id", headerName: "Capture", flex: 1, minWidth: 170, cellRenderer: CaptureCell, hide: narrow },
    ] },
    { headerName: "Ledger", children: [
      { field: "status", headerName: "Status", width: narrow ? 140 : 210, cellRenderer: StatusCell, tooltipValueGetter: (p) => p.data?.why || null },
    ] },
    { headerName: "Meta", children: [{ field: "meta", headerName: "Purchase event", width: 140, hide: narrow }] },
    { headerName: "", colId: "act", width: 104, minWidth: 104, pinned: "right", cellStyle: { paddingLeft: 6, paddingRight: 8 }, sortable: false, filter: false, cellRenderer: ActionCell, hide: tiny, suppressHeaderMenuButton: true },
  ], [narrow, tiny]);
  const retotal = (api) => { const list = []; api.forEachNodeAfterFilter((n) => n.data && list.push(n.data)); setTotal(totalsOf(list, narrow)); };
  const exportCsv = () => grid.current?.api?.exportDataAsCsv({ fileName: "paypal-ledger.csv", columnKeys: ["ad", "amount", "via", "status", "meta", "capture_id"] });
  return (
    <div className="ledger-grid" ref={box}>
      <div style={{ height: rows.length > 8 ? 470 : undefined }}>
        <AgGridReact ref={grid} theme={theme} rowData={rows} columnDefs={cols} context={{ onRefund, onCount, narrow }}
          defaultColDef={{ sortable: true, filter: true, resizable: true, suppressMovable: true }}
          domLayout={rows.length > 8 ? "normal" : "autoHeight"} getRowId={(p) => p.data.capture_id} rowHeight={44}
          getRowClass={(p) => (p.node.rowPinned ? "row-total" : p.data.held ? "row-held" : "")}
          pinnedBottomRowData={total ? [total] : []} tooltipShowDelay={200}
          onFirstDataRendered={(e) => retotal(e.api)} onGridSizeChanged={(e) => retotal(e.api)} onFilterChanged={(e) => retotal(e.api)} onRowDataUpdated={(e) => retotal(e.api)} />
      </div>
      <div className="ledger-foot"><span className="muted">Sort or filter any column, and the total row follows; {narrow ? "an ad name" : "a capture id"} opens that payment's money trail; hover a held row for why.</span><button type="button" className="btn ghost" onClick={exportCsv}>Export CSV</button></div>
    </div>
  );
}
