// Custom AG Studio widget: the PayPal ledger as an AG Grid table (Community) inside the report. It reads every capture
// through Studio's widget API, so a click on a band in the money flow (or any page filter) narrows it to that ad; a click
// on an ad's subtotal row filters the whole page back. Each payment opens its trail (ad click → PayPal → ledger → Meta)
// and has the owner's Decision: Refund… or Separate order…, sent to the same server routes the dashboard uses, which
// check them. The grid pieces are shared with the dashboard's ledger (LedgerGrid.jsx).
import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { AdCell, ClaimCell, DecisionCell, DecisionEditor, SearchBox, StatusCell, TrailRow, money, useClaims } from "./LedgerGrid.jsx";
import { searchRows } from "./adClaims.js";
import { decisionOf, groupByAd, totalsOf, trailHeight, withTrail } from "./gridTotals.js";
import { widgetFormat } from "./widgetForm.js";
import { DATA_EVENT } from "./OwesWidget.jsx";
import { AD_PICK, getPick, nextPick, setPick } from "./adPick.js";

ModuleRegistry.registerModules([AllCommunityModule]);

const pick = (row, field, i) => row[field?.key] ?? row[field?.id] ?? Object.values(row)[i];
// the report's ledger-paper look
const theme = themeQuartz.withParams({
  fontFamily: "var(--sans), 'Inter Tight', system-ui, sans-serif", fontSize: 13, foregroundColor: "#14130F", headerTextColor: "#5A5242",
  headerBackgroundColor: "#EFE8D6", headerFontWeight: 600, backgroundColor: "#FFFDF7", borderColor: "#DDD4BF", rowBorder: { color: "#DDD4BF" },
  accentColor: "#0B6B3A", wrapperBorderRadius: 2, rowHoverColor: "#F6F1E4", spacing: 6,
});
// Studio hands dates back as Date objects or strings; the trail shows YYYY-MM-DD
const day = (v) => { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? String(v || "").slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const KEYS = ["ad", "id", "status", "via", "meta", "source", "date", "gross", "refunded", "net", "held"];

// The Studio assistant's view of the ledger (the show_payments_in_ledger tool): the grid drops the ad groups and AG Grid
// itself filters (external filter), sorts (column state), scrolls to and flashes the rows the agent asked for.
export const LEDGER_VIEW = "paid-signal:ledger-view";
const STATUS_TEST = {
  refunded: (r) => r.status === "Refunded" || r.back > 0,
  held: (r) => r.held,
  refunded_or_held: (r) => r.held || r.status === "Refunded" || r.back > 0,
  paid: (r) => !r.held && r.status !== "Refunded",
};
// newest first sorts by the capture's time, not only its day, so payments on the same day keep their real order
const SORT_COL = { amount_desc: ["amount", "desc"], amount_asc: ["amount", "asc"], kept_desc: ["kept", "desc"], date_desc: ["at", "desc"] };
export function viewMatches(r, view) {
  if (r?.isDetail) r = r.of; // a payment's open trail goes with its payment
  if (!view || !r || r.isGroup) return true;
  if (view.ad && r.ad !== view.ad) return false;
  const t = STATUS_TEST[view.status];
  return t ? Boolean(t(r)) : true;
}

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

export function LedgerWidget({ dataMapping, widgetApi, context }) {
  const [rows, setRows] = useState([]);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(() => new Set());
  const [said, setSaid] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState(null);
  const viewRef = useRef(null); viewRef.current = view;
  const claims = useClaims();
  const [width, setWidth] = useState(0);
  const box = useRef(null), grid = useRef(null);
  useEffect(() => { const on = () => setTick((t) => t + 1); addEventListener(DATA_EVENT, on); return () => removeEventListener(DATA_EVENT, on); }, []);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const m = Object.fromEntries(KEYS.map((k) => [k, dataMapping?.[k]?.[0]]));
  const ready = KEYS.every((k) => m[k]);
  const atField = dataMapping?.at?.[0]; // optional: a layout saved before it existed still works

  useEffect(() => {
    if (!ready) { widgetApi.setDisplayState("incompleteDataMapping"); return; }
    let live = true;
    widgetApi.setDisplayState("loading");
    widgetApi.getData({ fields: [...KEYS.map((k) => m[k]), ...(atField ? [atField] : [])] }).then((res) => {
      if (!live) return;
      const out = (res.results?.rows || []).map((r) => {
        const v = Object.fromEntries(KEYS.map((k, i) => [k, pick(r, m[k], i)]));
        const at = atField ? String(pick(r, atField, KEYS.length) ?? "") : "";
        const gross = Number(v.gross) || 0, back = Number(v.refunded) || 0, held = Number(v.held) > 0, st = String(v.status);
        return {
          capture_id: String(v.id), at: at || day(v.date), ad: String(v.ad), adValue: v.ad, amount: gross, kept: Number(v.net) || 0, back, held,
          via: String(v.via).replace("PayPal ", ""), source: String(v.source) === "Other" ? "" : String(v.source), date: day(v.date),
          status: held && /dispute/i.test(String(v.meta)) ? "Held: dispute" : held ? "Held: double?" : st === "REFUNDED" ? "Refunded" : back > 0 ? `Paid, ${money(back)} back` : "Paid",
          meta: String(v.meta), why: held && /dispute/i.test(String(v.meta)) ? "Held out of revenue: a PayPal dispute is open, or the buyer won it." : held ? "Held out of paid orders as a possible double payment: same payer and ad minutes apart. Separate order… counts it." : "",
          refundable: !held && (st === "COMPLETED" || st === "PARTIALLY_REFUNDED"), raw: { capture_id: String(v.id), amount: gross, refunded_amount: back },
        };
      });
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    }).catch(() => live && widgetApi.setDisplayState("noData"));
    return () => { live = false; };
  }, [ready, widgetApi, context?.dataVersion, tick, atField?.id, ...KEYS.map((k) => m[k]?.id)]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useMemo(() => (id) => setOpen((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  // the owner decides; the server checks; the report reloads from the ledger
  const act = useMemo(() => async (choice, row) => {
    try {
      if (choice === "Refund…") {
        const left = (row.raw.amount - row.raw.refunded_amount).toFixed(2);
        const v = window.prompt(`Refund how much of capture ${row.capture_id}? (sandbox)`, left); if (v === null) return;
        const d = await post("/api/refund", { capture_id: row.capture_id, amount: v });
        setSaid(d.preview ? d.message : `Refunded ${money(d.refund?.amount)}; the ad's numbers update.`);
      } else if (choice === "Separate order…") {
        const reason = window.prompt("Why is this a separate order and not a double payment? (for example: a second child)"); if (!reason) return;
        await post("/api/duplicates/distinct", { capture_id: row.capture_id, reason });
        setSaid("Counted as a separate order: the ad, Meta and the commission count it again.");
      }
      dispatchEvent(new Event("paid-signal:ledger"));
    } catch (e) { setSaid(e.message); }
  }, []);

  // the page's cross-filter (a band clicked in the money flow, an ad in another widget) is on the ads table, which Studio
  // does not carry over to each capture; the widget reads the selected ads and narrows its own rows to them
  const [picked, setPicked] = useState(getPick());
  useEffect(() => { const on = (e) => setPicked(e.detail?.list || []); addEventListener(AD_PICK, on); return () => removeEventListener(AD_PICK, on); }, []);
  const narrow = width > 0 && width < 640;
  const shown = useMemo(() => searchRows(picked.length ? rows.filter((r) => picked.includes(r.ad)) : rows, q), [rows, picked, q]);
  // the assistant's view lists payments flat, so AG Grid's own sort applies across ads
  const data = useMemo(() => withTrail(view ? shown : groupByAd(shown), open), [shown, open, view]);
  useEffect(() => {
    const on = (e) => { const d = e.detail || {}; setView(d.reset ? null : { status: d.status || "all", ad: d.ad || "", sort: d.sort || "", label: d.label || "", reply: d.reply }); };
    addEventListener(LEDGER_VIEW, on); return () => removeEventListener(LEDGER_VIEW, on);
  }, []);
  // once the rows are in: filter, sort, bring into view, flash, and tell the tool what the grid now shows
  useEffect(() => {
    const api = grid.current?.api; if (!api) return;
    api.onFilterChanged();
    const [colId, sort] = SORT_COL[view?.sort] || [];
    api.applyColumnState({ state: colId ? [{ colId, sort }] : [], defaultState: { sort: null } });
    if (!view) return;
    const t = setTimeout(() => {
      const nodes = []; api.forEachNodeAfterFilterAndSort((n) => { if (n.data && !n.rowPinned && !n.data.isDetail) nodes.push(n); });
      if (!view.reply) return; // scroll and flash once, when the agent asks; later data refreshes only re-filter
      if (nodes.length) { api.ensureIndexVisible(0, "top"); api.flashCells({ rowNodes: nodes.slice(0, 6), columns: ["ad", "kept", "status"], flashDuration: 1400, fadeDuration: 900 }); }
      box.current?.closest(".ag-studio-layout-widget")?.scrollIntoView({ behavior: "smooth", block: "center" });
      const reply = view.reply; view.reply = null; reply({ shown: nodes.length, ids: nodes.map((n) => n.data.capture_id), top: nodes.slice(0, 5).map((n) => ({ capture: n.data.capture_id, ad: n.data.ad, captured_usd: n.data.amount.toFixed(2), kept_usd: n.data.kept.toFixed(2), status: n.data.status })) });
    }, 120);
    return () => clearTimeout(t);
  }, [view, data]);
  const total = useMemo(() => totalsOf(shown.filter((r) => viewMatches(r, view)).map((r) => ({ ...r, raw: { refunded_amount: r.amount - r.kept } })), narrow), [shown, narrow, view]);
  // a click on an ad's row picks it: the money flow then filters the page with its own field, as a band click does
  const filterTo = (ad) => setPick(nextPick(getPick(), ad), "ledger");
  const flat = Boolean(view); // the claim cell belongs to an ad's group row, absent from the flat view
  const cols = useMemo(() => [
    { field: "ad", headerName: "Ad, then each payment", flex: 1.5, minWidth: narrow ? 120 : 170, cellRenderer: AdCell },
    { colId: "claim", headerName: "Ad report → PayPal", width: 196, cellRenderer: ClaimCell, sortable: false, hide: narrow || flat, headerTooltip: "Leads the ad report counts, against orders PayPal confirms paid" },
    { field: "kept", headerName: "Kept", width: 92, enableCellChangeFlash: true, valueFormatter: (p) => money(p.value), type: "rightAligned", headerTooltip: "Money kept after refunds; a held double payment counts 0" },
    { field: "status", headerName: "Status", enableCellChangeFlash: true, width: 180, cellRenderer: StatusCell, tooltipValueGetter: (p) => p.data?.why || null, hide: narrow },
    { field: "meta", headerName: "What Meta heard", flex: 1, minWidth: 150, hide: narrow },
    { headerName: "Decision", colId: "decision", width: narrow ? 108 : 132, sortable: false, suppressHeaderMenuButton: true,
      valueGetter: (p) => (p.data && !p.data.isGroup && !p.node.rowPinned ? decisionOf(p.data).value : ""), cellRenderer: DecisionCell,
      editable: (p) => Boolean(p.data && !p.data.isGroup && !p.node.rowPinned && decisionOf(p.data).options.length), singleClickEdit: true,
      cellEditor: DecisionEditor, cellEditorPopup: true, cellEditorPopupPosition: "over", cellEditorParams: { act }, valueSetter: () => false },
    // not shown, exported: the CSV carries the capture date, click source, refunded amount and why a payment is held
    { field: "date", headerName: "Captured (UTC date)", hide: true }, { field: "source", headerName: "Click source", hide: true },
    { field: "back", headerName: "Refunded", hide: true, valueFormatter: (p) => money(p.value) }, { field: "why", headerName: "Why held", hide: true },
    { field: "amount", headerName: "Captured", hide: true, valueFormatter: (p) => money(p.value) }, { field: "capture_id", headerName: "PayPal capture", hide: true }, { field: "at", headerName: "Captured at (UTC)", hide: true }, { field: "via", headerName: "Paid through", hide: true },
  ], [narrow, act, flat]);

  return (
    <div className="ledger-w" ref={box}>
      <SearchBox value={q} onChange={setQ} />
      <div className="ledger-w-grid">
        <AgGridReact ref={grid} theme={theme} rowData={data} columnDefs={cols} context={{ grouped: !view, open, toggle, claims }}
          defaultColDef={{ sortable: Boolean(view), resizable: true, suppressMovable: true }}
          isExternalFilterPresent={() => Boolean(viewRef.current)} doesExternalFilterPass={(n) => viewMatches(n.data, viewRef.current)}
          // after AG Grid sorts the flat view, each open trail row goes back under its own payment
          postSortRows={(p) => {
            if (!viewRef.current) return;
            const trails = new Map(), rest = [];
            for (const n of p.nodes) (n.data?.isDetail ? trails.set(n.data.of.capture_id, n) : rest.push(n));
            const out = rest.flatMap((n) => (trails.has(n.data?.capture_id) ? [n, trails.get(n.data.capture_id)] : [n]));
            p.nodes.splice(0, p.nodes.length, ...out);
          }}
          getRowId={(p) => p.data?.detailId || p.data?.capture_id || p.data?.groupId || "total"}
          getRowHeight={(p) => (p.data?.isDetail ? trailHeight(width) : 40)} isFullWidthRow={(p) => Boolean(p.rowNode.data?.isDetail)} fullWidthCellRenderer={TrailRow}
          getRowClass={(p) => (p.node.rowPinned ? "row-total" : p.data?.isGroup ? "row-group" : p.data?.held ? "row-held" : "")}
          pinnedBottomRowData={rows.length ? [total] : []} tooltipShowDelay={200}
          // a click on an ad's subtotal row filters the whole page to that ad
          onRowClicked={(e) => { if (e.data?.isGroup) filterTo(e.data.ad.replace(/ \(\d+\)$/, "")); }} />
      </div>
      <div className="ledger-w-foot">{view && <button type="button" className="chip-x" onClick={() => setView(null)} aria-label="Back to every payment grouped by ad">Assistant's view: {view.label || "filtered"} ×</button>}{picked.length > 0 && <button type="button" className="chip-x" onClick={() => setPick([], "ledger")}>Showing: {picked.join(", ")} ×</button>}
        <span>{said || "▸ opens a payment's trail · click an ad's row to filter the page · click a Decision to act (the server checks it)"}</span>
        <button type="button" className="ledger-w-csv" onClick={() => grid.current?.api?.exportDataAsCsv({ fileName: "paypal-ledger.csv", columnKeys: ["ad", "amount", "kept", "back", "via", "status", "why", "meta", "capture_id", "date", "source"],
          shouldRowBeSkipped: (p) => Boolean(p.node.data?.isGroup || p.node.data?.isDetail) })}>Export CSV</button></div>
    </div>
  );
}

const field = (aiDescription, roles = ["category"]) => ({ type: "field", supportedRoles: roles, requires: { per: "dataMapping.ad", cardinality: "many" }, required: true, aiDescription });
export const ledgerWidgetDefinition = {
  id: "paypal-ledger",
  label: "PayPal ledger (AG Grid)",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 9v11"/></svg>',
  dataMapping: {
    ad: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "The ad each payment came from (one subtotal row each)." },
    id: field("The PayPal capture id."), status: field("PayPal's capture status."), via: field("Paid through: invoice or checkout."),
    meta: field("What Meta heard about the payment."), source: field("The click source."), date: field("The capture date."),
    gross: field("Amount captured.", ["numeric"]), refunded: field("Amount refunded.", ["numeric"]), net: field("Money kept (0 when held).", ["numeric"]), held: field("1 when held as a possible double payment.", ["numeric"]),
    at: { type: "field", supportedRoles: ["category"], requires: { per: "dataMapping.ad", cardinality: "many" }, required: false, aiDescription: "Optional: the capture's time, so newest first keeps payments on the same day in order." },
  },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: "ad", label: "Ad" }, { key: "id", label: "Capture" }, { key: "status", label: "Status" }, { key: "via", label: "Paid through" }, { key: "meta", label: "Meta" }, { key: "source", label: "Click source" }, { key: "date", label: "Date" }, { key: "gross", label: "Captured" }, { key: "refunded", label: "Refunded" }, { key: "net", label: "Kept" }, { key: "held", label: "Held" }] }),
  formatShape: widgetFormat((s) => s.object({})),
  comp: LedgerWidget,
  featureConfig: { crossFilter: { supportsHighlight: false } },
  ai: { label: "PayPal ledger (AG Grid)", description: "Every PayPal capture grouped by ad with a subtotal row per ad and a total row, in an AG Grid table; filtered by the page and by clicks in other widgets; a click on an ad's row filters the page; each payment opens its trail (ad click, PayPal capture, ledger, Meta) and has the owner's Decision (Refund… or Separate order…, checked by the server).", usage: "Map ad to captures.adName and the other fields to the captures table." },
  defaultSize: { width: 900, height: 360 },
  minSize: { width: 320, height: 220 },
};
