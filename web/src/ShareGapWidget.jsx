// Custom AG Studio widget: each ad's share of what the ad report counts next to its share of the money kept.
// Shares are worked out here from the two sums Studio returns, so page filters and cross-filters apply as usual.
import { useEffect, useState } from "react";

const pick = (row, field, i) => row[field?.key] ?? row[field?.id] ?? Object.values(row)[i];
const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function ShareGapWidget({ dataMapping, widgetApi, context }) {
  const [rows, setRows] = useState([]);
  const cat = dataMapping?.category?.[0], reported = dataMapping?.reported?.[0], money = dataMapping?.money?.[0];

  useEffect(() => {
    if (!cat || !reported || !money) { widgetApi.setDisplayState("incompleteDataMapping"); return; }
    let live = true;
    widgetApi.setDisplayState("loading");
    widgetApi.getData({ fields: [cat, reported, money], sort: [{ field: reported, direction: "desc" }] }).then((res) => {
      if (!live) return;
      const raw = (res.results?.rows || []).map((r) => ({ name: String(pick(r, cat, 0)), a: Number(pick(r, reported, 1)) || 0, b: Number(pick(r, money, 2)) || 0 }));
      const ta = raw.reduce((n, r) => n + r.a, 0) || 1, tb = raw.reduce((n, r) => n + r.b, 0) || 1;
      const out = raw.map((r) => ({ name: r.name, a: r.a / ta, b: r.b / tb }));
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    }).catch(() => live && widgetApi.setDisplayState("noData"));
    return () => { live = false; };
  }, [cat, reported, money, widgetApi, context?.dataVersion]);

  return (
    <div className="claim share">
      {rows.map((r) => (
        <div className="claim-row" key={r.name}>
          <span className="claim-name">{r.name}</span>
          <div className="claim-bars" role="img" aria-label={`${r.name}: ${pct(r.a)} of what the ad report counts, ${pct(r.b)} of the money kept`}>
            <i className="claim-claimed" style={{ width: `${r.a * 100}%` }} />
            <i className="claim-confirmed" style={{ width: `${Math.max(0.8, r.b * 100)}%` }} />
          </div>
          <span className={`claim-v${r.b < r.a / 2 ? " gap" : ""}`}>{pct(r.a)} → {pct(r.b)}</span>
        </div>
      ))}
      <div className="claim-key"><span><i className="claim-claimed" /> share of what the ad report counts</span><span><i className="claim-confirmed" /> share of the money kept</span></div>
    </div>
  );
}

export const shareGapWidgetDefinition = {
  id: "share-gap",
  label: "Reported share vs money share",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h5M4 17h10"/></svg>',
  dataMapping: {
    category: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "The ad or ad group (one row each)." },
    reported: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.category", cardinality: "one" }, required: true, aiDescription: "What the ad report counts, e.g. leads or chats." },
    money: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.category", cardinality: "one" }, required: true, aiDescription: "Money kept after refunds, from payments." },
  },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: "category", label: "Ad" }, { key: "reported", label: "Counted by the ad report" }, { key: "money", label: "Money kept" }] }),
  comp: ShareGapWidget,
  defaultSize: { width: 800, height: 240 },
  minSize: { width: 320, height: 140 },
};
