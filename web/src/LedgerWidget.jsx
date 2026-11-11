// Custom AG Studio widget: the PayPal ledger as an AG Grid table (Community) inside the report. It reads every capture
// through Studio's widget API, so a click on a band in the money flow (or any page filter) narrows it to that ad; a click
// on an ad's subtotal row filters the whole page back. Each payment opens its trail (ad click → PayPal → ledger → Meta)
// and has the owner's Decision: Refund… or Separate order…, sent to the same server routes the dashboard uses, which
// check them. The grid pieces are shared with the dashboard's ledger (LedgerGrid.jsx).
import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, themeQuartz } from "ag-grid-community";
import { GRID_MODULES, GRID_ENTERPRISE, gridEnterpriseOn } from "./gridModules.js";
import { AdCell, ClaimCell, DecisionCell, DecisionEditor, DecisionForm, SearchBox, StatusCell, TrailRow, money, useClaims, useDecisionForm } from "./LedgerGrid.jsx";
import { searchRows } from "./adClaims.js";
import { decisionOf, groupByAd, totalsOf, trailHeight, withTrail } from "./gridTotals.js";
import { widgetFormat } from "./widgetForm.js";
import { DATA_EVENT } from "./OwesWidget.jsx";
import { AD_PICK, getPick, nextPick, setPick } from "./adPick.js";
import { filterModelFor, registerLedger } from "./ledgerView.js";

ModuleRegistry.registerModules(GRID_MODULES);

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
// what Claude is told about the columns when it asks the AI Toolkit for the grid's schema
const SCHEMA_PARAMS = {
  exclude: ["columnSizing", "columnVisibility", "pivot"],
  columns: {
    ad: { description: "The ad the payment came from.", includeSetValues: true },
    status: { description: "Paid; Paid, $X back (partly refunded); Refunded; Held: double? (possible double payment); Held: dispute.", includeSetValues: true },
    kept: { description: "Money the shop kept, in USD, after refunds; 0 when held. For 'kept', 'net', 'money we keep'." },
    amount: { description: "Amount the buyer paid (captured), in USD, before any refund. For 'captured', 'paid in', 'gross', 'amount'." },
    back: { description: "Amount refunded to the buyer, in USD (0 when nothing came back). For 'refunded', 'money back': sum this column per group rather than filtering by status." },
    via: { description: "How the buyer paid: checkout or invoice. Group by this column for 'how each payment was made', 'payment method'.", includeSetValues: true },
    at: { description: "Capture time, UTC (ISO)." },
  },
};

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
  // the owner decides in the shared form under the grid (LedgerGrid.jsx); the server checks it again; the report reloads
  const decisionForm = useDecisionForm(async (kind, row, value) => {
    if (kind === "refund") {
      const d = await post("/api/refund", { capture_id: row.capture_id, amount: value });
      setSaid(d.preview ? d.message : `Refunded ${money(d.refund?.amount)}; the ad's numbers update.`);
    } else {
      await post("/api/duplicates/distinct", { capture_id: row.capture_id, reason: value });
      setSaid("Counted as a separate order: the ad, Meta and the commission count it again.");
    }
    dispatchEvent(new Event("paid-signal:ledger"));
  });
  const act = decisionForm.open;

  // the page's cross-filter (a band clicked in the money flow, an ad in another widget) is on the ads table, which Studio
  // does not carry over to each capture; the widget reads the selected ads and narrows its own rows to them
  const [picked, setPicked] = useState(getPick());
  useEffect(() => { const on = (e) => setPicked(e.detail?.list || []); addEventListener(AD_PICK, on); return () => removeEventListener(AD_PICK, on); }, []);
  const narrow = width > 0 && width < 640;
  const shown = useMemo(() => searchRows(picked.length ? rows.filter((r) => picked.includes(r.ad)) : rows, q), [rows, picked, q]);
  // the assistant's view lists payments flat, so AG Grid's own sort applies across ads
  // a grid state from the AI Toolkit may group rows itself, so its view carries no trail rows
  const data = useMemo(() => (view?.state ? shown : withTrail(view ? shown : groupByAd(shown), open)), [shown, open, view]);
  const [ent, setEnt] = useState(gridEnterpriseOn());
  useEffect(() => { const on = () => setEnt(true); addEventListener(GRID_ENTERPRISE, on); return () => removeEventListener(GRID_ENTERPRISE, on); }, []);
  const asView = (d, reply) => ({ status: d.status || "all", ad: d.ad || "", sort: d.sort || "", label: d.label || "", reply });
  // the assistant's tool reaches this grid through the registry once the grid is ready (ledgerView.js); scripts and
  // the browser checks can also send the same view as an event
  const [gridReady, setGridReady] = useState(false);
  useEffect(() => {
    if (!gridReady) return undefined;
    const apply = (d) => new Promise((res) => { if (d.reset) { setView(null); res({ reset: true }); } else setView(asView(d, res)); });
    // AG Grid's AI Toolkit: the schema of the states this grid accepts, and a state (from Claude) to apply
    apply.toolkit = () => Boolean(grid.current?.api?.getStructuredSchema);
    // the grouped ledger's columns cannot group, filter or sort, so its schema would be empty: switch to the flat grid
    // first (no filter, no sort) and read the schema once AG Grid holds the flat columns
    apply.schema = () => {
      const api = grid.current?.api; if (!api?.getStructuredSchema) return null;
      if (viewRef.current) return api.getStructuredSchema(SCHEMA_PARAMS);
      return new Promise((res) => setView({ state: {}, label: "AG Grid AI Toolkit", quiet: true, reply: () => res(grid.current?.api?.getStructuredSchema(SCHEMA_PARAMS) ?? null) }));
    };
    apply.setGridState = (state, label) => new Promise((res) => setView({ state, label: label || "a grid state from the AI Toolkit", reply: res }));
    return registerLedger(apply);
  }, [gridReady, ent]);
  useEffect(() => {
    const on = (e) => { const d = e.detail || {}; setView(d.reset ? null : asView(d, d.reply)); };
    addEventListener(LEDGER_VIEW, on); return () => removeEventListener(LEDGER_VIEW, on);
  }, []);
  // once the rows are in: filter, sort, bring into view, flash, and tell the tool what the grid now shows
  useEffect(() => {
    const api = grid.current?.api; if (!api) return;
    if (view?.state) {
      // the AI Toolkit's state, as the grid's own setState applies it (filter, sort, row grouping, aggregation);
      // everything else about the grid stays as it is
      api.setState(view.state, ["columnSizing", "columnOrder", "columnPinning", "scroll", "focusedCell", "rowSelection", "cellSelection", "pagination", "sideBar", "partialColumnState"]);
    } else {
      api.setFilterModel(filterModelFor(view)); // AG Grid's own text filters on Status and Ad, shown in the headers
      const [colId, sort] = SORT_COL[view?.sort] || [];
      api.applyColumnState({ state: colId ? [{ colId, sort }] : [], defaultState: { sort: null, rowGroup: false, aggFunc: null } });
    }
    if (!view) return;
    const t = setTimeout(() => {
      const nodes = []; api.forEachNodeAfterFilterAndSort((n) => { if (n.data && !n.group && !n.rowPinned && !n.data.isDetail) nodes.push(n); });
      const groups = []; if (view.state) api.forEachNodeAfterFilterAndSort((n) => { if (n.group && n.level === 0) groups.push({ group: String(n.key), rows: n.allLeafChildren?.length || 0, ...(n.aggData ? Object.fromEntries(Object.entries(n.aggData).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(2)) : v])) : {}) }); });
      if (view.state) setStateTotal(totalsOf(nodes.map((n) => ({ ...n.data, raw: { refunded_amount: n.data.amount - n.data.kept } })), narrow));
      if (!view.reply) return; // scroll and flash once, when the agent asks; later data refreshes only re-filter
      if (view.quiet) { const r = view.reply; view.reply = null; r({}); return; } // the schema read: nothing to show yet
      if (nodes.length) { api.ensureIndexVisible(0, "top"); api.flashCells({ rowNodes: nodes.slice(0, 6), columns: ["ad", "kept", "status"], flashDuration: 1400, fadeDuration: 900 }); }
      box.current?.closest(".ag-studio-layout-widget")?.scrollIntoView({ behavior: "smooth", block: "center" });
      const st = api.getState();
      const reply = view.reply; view.reply = null; reply({ shown: nodes.length, filter_model: api.getFilterModel(), ...(view.state ? { groups, grid_state: { filter: st.filter, sort: st.sort, rowGroup: st.rowGroup, aggregation: st.aggregation } } : {}), ids: nodes.map((n) => n.data.capture_id), top: nodes.slice(0, 5).map((n) => ({ capture: n.data.capture_id, ad: n.data.ad, captured_usd: n.data.amount.toFixed(2), kept_usd: n.data.kept.toFixed(2), status: n.data.status })) });
    }, 120);
    return () => clearTimeout(t);
  }, [view, data]);
  const total = useMemo(() => totalsOf(shown.filter((r) => viewMatches(r, view)).map((r) => ({ ...r, raw: { refunded_amount: r.amount - r.kept } })), narrow), [shown, narrow, view]);
  // a click on an ad's row picks it: the money flow then filters the page with its own field, as a band click does
  const filterTo = (ad) => setPick(nextPick(getPick(), ad), "ledger");
  const [stateTotal, setStateTotal] = useState(null);
  const flat = Boolean(view); // the claim cell belongs to an ad's group row, absent from the flat view
  // with AG Grid Enterprise the flat view's Ad and Status can group rows and Kept, Captured, Refunded add up
  const groupable = (key) => (ent && flat ? { enableRowGroup: true } : {});
  const summable = () => (ent && flat ? { enableValue: true, allowedAggFuncs: ["sum", "count", "avg", "min", "max"] } : {});
  // in the flat view Status and Ad carry AG Grid text filters (the agent sets them; a person can change them in the
  // header); a trail row is filtered by its payment's values, so it stays with its payment
  const colFilter = (key) => (flat ? { filter: "agTextColumnFilter", filterParams: { maxNumConditions: 3 }, filterValueGetter: (p) => (p.data?.isDetail ? p.data.of?.[key] : p.data?.[key]) } : { filter: false });
  const cols = useMemo(() => [
    { field: "ad", headerName: "Ad, then each payment", flex: 1.5, minWidth: narrow ? 120 : 170, cellRenderer: AdCell, ...colFilter("ad"), ...groupable("ad") },
    { colId: "claim", headerName: "Ad report → PayPal", width: 196, cellRenderer: ClaimCell, sortable: false, hide: narrow || flat, headerTooltip: "Leads the ad report counts, against orders PayPal confirms paid" },
    { field: "kept", headerName: "Kept", width: 92, enableCellChangeFlash: true, ...summable(), valueFormatter: (p) => money(p.value), type: "rightAligned", headerTooltip: "Money kept after refunds; a held double payment counts 0" },
    { field: "status", headerName: "Status", enableCellChangeFlash: true, ...colFilter("status"), ...groupable("status"), width: 180, cellRenderer: StatusCell, tooltipValueGetter: (p) => p.data?.why || null, hide: narrow },
    { field: "meta", headerName: "What Meta heard", flex: 1, minWidth: 150, hide: narrow },
    { headerName: "Decision", colId: "decision", width: narrow ? 108 : 132, sortable: false, suppressHeaderMenuButton: true,
      valueGetter: (p) => (p.data && !p.data.isGroup && !p.node.rowPinned ? decisionOf(p.data).value : ""), cellRenderer: DecisionCell,
      editable: (p) => Boolean(p.data && !p.data.isGroup && !p.node.rowPinned && decisionOf(p.data).options.length), singleClickEdit: true,
      cellEditor: DecisionEditor, cellEditorPopup: true, cellEditorPopupPosition: "over", cellEditorParams: { act }, valueSetter: () => false },
    // not shown, exported: the CSV carries the capture date, click source, refunded amount and why a payment is held
    { field: "date", headerName: "Captured (UTC date)", hide: true }, { field: "source", headerName: "Click source", hide: true },
    { field: "back", headerName: "Refunded", hide: true, ...summable(), valueFormatter: (p) => money(p.value) }, { field: "why", headerName: "Why held", hide: true },
    { field: "amount", headerName: "Captured", hide: true, ...summable(), valueFormatter: (p) => money(p.value) }, { field: "capture_id", headerName: "PayPal capture", hide: true }, { field: "at", headerName: "Captured at (UTC)", hide: true }, { field: "via", headerName: "Paid through", hide: true, ...groupable("via") },
  ], [narrow, act, flat, ent]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ledger-w" ref={box}>
      <SearchBox value={q} onChange={setQ} />
      <div className="ledger-w-grid">
        <AgGridReact key={ent ? "enterprise" : "community"} ref={grid} theme={theme} rowData={data} columnDefs={cols} context={{ grouped: !view, open, toggle, claims }}
          defaultColDef={{ sortable: Boolean(view), resizable: true, suppressMovable: true }}
          onGridReady={() => setGridReady(true)}
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
          pinnedBottomRowData={rows.length ? [view?.state && stateTotal ? stateTotal : total] : []} tooltipShowDelay={200}
          autoGroupColumnDef={{ headerName: "Group", minWidth: 190, cellRendererParams: { innerRenderer: (p) => p.node.key ?? p.value ?? "" } }} groupDefaultExpanded={0} suppressAggFuncInHeader
          // a click on an ad's subtotal row filters the whole page to that ad
          onRowClicked={(e) => { if (e.data?.isGroup) filterTo(e.data.ad.replace(/ \(\d+\)$/, "")); }} />
      </div>
      <DecisionForm form={decisionForm} />
      <div className="ledger-w-foot">{view && <button type="button" className="chip-x" onClick={() => setView(null)} aria-label="Back to every payment grouped by ad">Assistant's view: {view.label || "filtered"} ×</button>}{picked.length > 0 && <button type="button" className="chip-x" onClick={() => setPick([], "ledger")}>Showing: {picked.join(", ")} ×</button>}
        <span>{said || "▸ shows a payment's history · click an ad's row to filter the page · Decision: refund it, or count it as a separate order"}</span>
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
