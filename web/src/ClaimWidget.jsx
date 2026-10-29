// Custom AG Studio widget: for each ad, the leads the ad platform claims next to the paid orders PayPal confirms.
// It reads its data through Studio's widget API, so page filters and cross-filters apply to it like any built-in widget.
import { useEffect, useState } from "react";

const pick = (row, field, i) => row[field?.key] ?? row[field?.id] ?? Object.values(row)[i];

export function ClaimWidget({ dataMapping, widgetApi, context }) {
  const [rows, setRows] = useState([]);
  const cat = dataMapping?.category?.[0], claimed = dataMapping?.claimed?.[0], confirmed = dataMapping?.confirmed?.[0];

  useEffect(() => {
    if (!cat || !claimed || !confirmed) { widgetApi.setDisplayState("incompleteDataMapping"); return; }
    let live = true;
    widgetApi.setDisplayState("loading");
    widgetApi.getData({ fields: [cat, claimed, confirmed], sort: [{ field: claimed, direction: "desc" }] }).then((res) => {
      if (!live) return;
      const out = (res.results?.rows || []).map((r) => ({ name: String(pick(r, cat, 0)), claimed: Number(pick(r, claimed, 1)) || 0, confirmed: Number(pick(r, confirmed, 2)) || 0 }));
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    }).catch(() => live && widgetApi.setDisplayState("noData"));
    return () => { live = false; };
  }, [cat, claimed, confirmed, widgetApi, context?.dataVersion]); // Studio sends no data-changed event; the app bumps dataVersion

  const max = Math.max(1, ...rows.map((r) => r.claimed));
  return (
    <div className="claim">
      {rows.map((r) => (
        <div className="claim-row" key={r.name}>
          <span className="claim-name">{r.name}</span>
          <div className="claim-bars" role="img" aria-label={`${r.name}: ${r.claimed} leads claimed, ${r.confirmed} paid orders confirmed`}>
            <i className="claim-claimed" style={{ width: `${(r.claimed / max) * 100}%` }} />
            <i className={r.confirmed ? "claim-confirmed" : "claim-none"} style={{ width: `${Math.max(r.confirmed ? 1.5 : 0.8, (r.confirmed / max) * 100)}%` }} />
          </div>
          <span className={`claim-v${r.confirmed ? "" : " gap"}`}>{r.claimed} → {r.confirmed}</span>
        </div>
      ))}
      <div className="claim-key"><span><i className="claim-claimed" /> leads the ad reports</span><span><i className="claim-confirmed" /> paid orders PayPal confirms</span></div>
    </div>
  );
}

export const claimWidgetDefinition = {
  id: "claim-vs-confirmed",
  label: "Claimed vs confirmed",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h14M4 12h8M4 17h11"/><path d="M4 9h6M4 14h3" stroke-width="1"/></svg>',
  dataMapping: {
    category: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "The ad (one bar group per ad)." },
    claimed: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.category", cardinality: "one" }, required: true, aiDescription: "What the ad platform reports, e.g. leads." },
    confirmed: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.category", cardinality: "one" }, required: true, aiDescription: "What PayPal confirms, e.g. paid orders." },
  },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: "category", label: "Ad" }, { key: "claimed", label: "Claimed by the ad" }, { key: "confirmed", label: "Confirmed by PayPal" }] }),
  comp: ClaimWidget,
  defaultSize: { width: 800, height: 300 },
  minSize: { width: 320, height: 160 },
};
