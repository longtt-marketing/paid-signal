// AG Studio and its agents, loaded as a separate chunk: the dashboard answers first, Studio arrives when it is needed.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { AgStudioAiModule } from "ag-studio";
import { buildAi } from "./agentTools.js";
import { buildData, initialReport, phoneReport, phoneTheme, shopSources, theme } from "./studio.js";
import { shareGapWidgetDefinition } from "./ShareGapWidget.jsx";
import { toolDisplay } from "./toolDisplay.jsx";
import { claimWidgetDefinition } from "./ClaimWidget.jsx";
import { timelineWidgetDefinition } from "./TimelineWidget.jsx";
import { funnelWidgetDefinition } from "./FunnelWidget.jsx";
import { owesWidgetDefinition, DATA_EVENT } from "./OwesWidget.jsx";

const PANELS = { view: { right: ["ai", "filters"] }, edit: { right: ["ai", "edit", "data", "filters"] } };
// a phone keeps only the assistant rail, so the report gets the width
const PHONE_PANELS = { view: { right: ["ai"] }, edit: { right: ["ai", "edit"] } };
const narrow = () => typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;

const StudioPanel = forwardRef(function StudioPanel({ state, invoices, license, csvRef, onInvoices, onRecommendation, onNudge }, ref) {
  const studio = useRef(null);
  const [phone] = useState(narrow); // chosen once at mount; Studio keeps its own layout state after that
  const ai = useMemo(() => buildAi({ getCsv: () => csvRef.current, onInvoices, onRecommendation, onNudge }), [csvRef, onInvoices, onRecommendation, onNudge]);
  // the real shop's October book, static files: loaded once, then joined into Studio's data as two more tables
  const [shop, setShop] = useState(() => shopSources(null, ""));
  useEffect(() => { Promise.all([fetch("/data/merchant-case.json").then((r) => r.json()), fetch("/data/shop/payments-2026-10.csv").then((r) => r.text())])
    .then(([c, csv]) => setShop(shopSources(c.read, csv))).catch(() => {}); }, []);
  const data = useMemo(() => (state ? buildData(state.reconciliation, state.payments, invoices, state.duplicates, state.metaSends, shop) : undefined), [state, invoices, shop]);
  const context = useMemo(() => ({ dataVersion: (state?.payments || []).map((p) => p.capture_id + p.refunded_amount).join() + (invoices || []).map((i) => i.id + i.status + (i.reminded_at || "")).join() + `|shop${shop.sources[1].data.length}` }), [state, invoices, shop]);
  // tell custom widgets the data changed, once Studio has taken the new data in
  useEffect(() => { if (!data) return; const t = setTimeout(() => dispatchEvent(new Event(DATA_EVENT)), 400); return () => clearTimeout(t); }, [data]);
  const widgets = useMemo(() => (defaults) => createWidgets({ additionalTypes: [claimWidgetDefinition, timelineWidgetDefinition, funnelWidgetDefinition, owesWidgetDefinition, shareGapWidgetDefinition], menu: [...defaults.menu, { label: "Paid Signal", widgetIds: ["claim-vs-confirmed", "payment-timeline", "lead-funnel", "who-still-owes", "share-gap"] }] }), []);
  useImperativeHandle(ref, () => ({
    openAssistant() { const a = studio.current?.api; if (!a) return false; const s = a.getState(); a.setState({ ...s, panels: { ...(s.panels || {}), ai: { collapsed: false } } }); return true; },
    selectPage(id) { const a = studio.current?.api; if (a) a.setState({ ...a.getState(), selectedPageId: id }); },
  }), []);
  return (
    <AgStudioProvider modules={[AgStudioAiModule]} licenseKey={license || undefined}>
      <AgStudio ref={studio} data={data} context={context} initialState={phone ? phoneReport : initialReport} widgets={widgets} theme={phone ? phoneTheme : theme} mode="view" ai={ai} aiToolDisplay={toolDisplay} panels={phone ? PHONE_PANELS : PANELS} onApiReady={(e) => { window.__studio = e.api; }} style={{ width: "100%", height: "100%" }} />
    </AgStudioProvider>
  );
});
export default StudioPanel;
