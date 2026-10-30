// AG Studio and its agents, loaded as a separate chunk: the dashboard answers first, Studio arrives when it is needed.
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { AgStudioAiModule } from "ag-studio";
import { buildAi } from "./agentTools.js";
import { buildData, initialReport, theme } from "./studio.js";
import { claimWidgetDefinition } from "./ClaimWidget.jsx";
import { timelineWidgetDefinition } from "./TimelineWidget.jsx";
import { funnelWidgetDefinition } from "./FunnelWidget.jsx";

const PANELS = { view: { right: ["ai", "filters"] }, edit: { right: ["ai", "edit", "data", "filters"] } };

const StudioPanel = forwardRef(function StudioPanel({ state, invoices, license, csvRef, onInvoices, onRecommendation }, ref) {
  const studio = useRef(null);
  const ai = useMemo(() => buildAi({ getCsv: () => csvRef.current, onInvoices, onRecommendation }), [csvRef, onInvoices, onRecommendation]);
  const data = useMemo(() => (state ? buildData(state.reconciliation, state.payments, invoices, state.duplicates) : undefined), [state, invoices]);
  const context = useMemo(() => ({ dataVersion: (state?.payments || []).map((p) => p.capture_id + p.refunded_amount).join() }), [state]);
  const widgets = useMemo(() => (defaults) => createWidgets({ additionalTypes: [claimWidgetDefinition, timelineWidgetDefinition, funnelWidgetDefinition], menu: [...defaults.menu, { label: "Paid Signal", widgetIds: ["claim-vs-confirmed", "payment-timeline", "lead-funnel"] }] }), []);
  useImperativeHandle(ref, () => ({
    openAssistant() { const a = studio.current?.api; if (!a) return false; const s = a.getState(); a.setState({ ...s, panels: { ...(s.panels || {}), ai: { collapsed: false } } }); return true; },
    selectPage(id) { const a = studio.current?.api; if (a) a.setState({ ...a.getState(), selectedPageId: id }); },
  }), []);
  return (
    <AgStudioProvider modules={[AgStudioAiModule]} licenseKey={license || undefined}>
      <AgStudio ref={studio} data={data} context={context} initialState={initialReport} widgets={widgets} theme={theme} mode="view" ai={ai} panels={PANELS} onApiReady={(e) => { window.__studio = e.api; }} style={{ width: "100%", height: "100%" }} />
    </AgStudioProvider>
  );
});
export default StudioPanel;
