// Custom AG Studio widget: per ad, the leads the ad platform reports, how many got a PayPal invoice, and how many paid
// orders PayPal confirms (from checkout or invoice, so paid can exceed invoiced). Reads aggregated rows through the widget API, so page filters and cross-filters apply.
import { useEffect, useState } from "react";

const pick = (row, field, i) => row[field?.key] ?? row[field?.id] ?? Object.values(row)[i];

export function FunnelWidget({ dataMapping, widgetApi, context }) {
  const [rows, setRows] = useState([]);
  const cat = dataMapping?.category?.[0], leads = dataMapping?.leads?.[0], inv = dataMapping?.invoiced?.[0], paid = dataMapping?.paid?.[0];

  useEffect(() => {
    if (!cat || !leads || !inv || !paid) { widgetApi.setDisplayState("incompleteDataMapping"); return; }
    let live = true;
    widgetApi.setDisplayState("loading");
    widgetApi.getData({ fields: [cat, leads, inv, paid] }).then((res) => {
      if (!live) return;
      const out = (res.results?.rows || []).map((r) => ({ name: String(pick(r, cat, 0)), leads: Number(pick(r, leads, 1)) || 0, invoiced: Number(pick(r, inv, 2)) || 0, paid: Number(pick(r, paid, 3)) || 0 }))
        .sort((a, b) => b.leads - a.leads);
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    }).catch(() => live && widgetApi.setDisplayState("noData"));
    return () => { live = false; };
  }, [cat, leads, inv, paid, widgetApi, context?.dataVersion]);

  const max = Math.max(1, ...rows.map((r) => r.leads));
  const w = (n) => `${Math.max(n ? 2 : 0, (n / max) * 100)}%`;
  return (
    <div className="funnel">
      {rows.map((r) => (
        <div key={r.name} className="fn-row">
          <b>{r.name}</b>
          <div className="fn-bars" aria-label={`${r.name}: ${r.leads} leads, ${r.invoiced} invoiced, ${r.paid} paid`}>
            <i className="fn-leads" style={{ width: w(r.leads) }} /><i className="fn-inv" style={{ width: w(r.invoiced) }} /><i className="fn-paid" style={{ width: w(r.paid) }} />
          </div>
          <span>{r.leads} · {r.invoiced} · <em>{r.paid}</em></span>
        </div>
      ))}
      <div className="claim-key"><span><i className="fn-leads" /> leads the ad reports</span><span><i className="fn-inv" /> invoiced through PayPal</span><span><i className="fn-paid" /> paid</span></div>
    </div>
  );
}

export const funnelWidgetDefinition = {
  id: "lead-funnel",
  label: "Leads, invoices, paid",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h18M6 12h12M10 19h4"/></svg>',
  dataMapping: {
    category: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "One row per value, e.g. the ad name." },
    leads: { type: "field", supportedRoles: ["measure"], required: true, aiDescription: "Leads the ad platform reports." },
    invoiced: { type: "field", supportedRoles: ["measure"], required: true, aiDescription: "Leads that got a PayPal invoice." },
    paid: { type: "field", supportedRoles: ["measure"], required: true, aiDescription: "Paid orders PayPal confirms." },
  },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: "category", label: "Ad" }, { key: "leads", label: "Leads" }, { key: "invoiced", label: "Invoiced" }, { key: "paid", label: "Paid" }] }),
  comp: FunnelWidget,
  defaultSize: { width: 800, height: 240 },
  minSize: { width: 360, height: 160 },
};
