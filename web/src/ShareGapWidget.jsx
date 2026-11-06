// Custom AG Studio widget: each ad's share of what the ad report counts next to its share of the money kept.
// Shares are worked out here from the two sums Studio returns, so page filters and cross-filters apply as usual.
import { useEffect, useState } from "react";
import { widgetFormat, withSection } from "./widgetForm.js";

const pick = (row, field, i) => row[field?.key] ?? row[field?.id] ?? Object.values(row)[i];
const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function ShareGapWidget({ dataMapping, format, widgetApi, context }) {
  // flag a row when the ad report gives it this many points more than its share of the money (set in the edit panel)
  const flagAt = Number(format?.style?.flagPoints ?? 25);
  const [rows, setRows] = useState([]);
  const cat = dataMapping?.category?.[0], reported = dataMapping?.reported?.[0], money = dataMapping?.money?.[0];

  useEffect(() => {
    if (!cat || !reported || !money) { widgetApi.setDisplayState("incompleteDataMapping"); return; }
    let live = true;
    widgetApi.setDisplayState("loading");
    widgetApi.getData({ fields: [cat, reported, money], sort: [{ field: reported, direction: "desc" }] }).then((res) => {
      if (!live) return;
      const raw = (res.results?.rows || []).map((r) => ({ value: pick(r, cat, 0), name: String(pick(r, cat, 0)), a: Number(pick(r, reported, 1)) || 0, b: Number(pick(r, money, 2)) || 0 }));
      const ta = raw.reduce((n, r) => n + r.a, 0) || 1, tb = raw.reduce((n, r) => n + r.b, 0) || 1;
      const out = raw.map((r) => ({ value: r.value, name: r.name, a: r.a / ta, b: r.b / tb }));
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    }).catch(() => live && widgetApi.setDisplayState("noData"));
    return () => { live = false; };
  }, [cat, reported, money, widgetApi, context?.dataVersion]);

  // a click on an ad group cross-filters the rest of the page to it (ctrl or cmd adds to the selection)
  const selected = new Set((widgetApi.getCrossFilterSelections?.() || []).flatMap((s) => (s.type === "value" ? s.values : [])));
  const choose = (r) => (e) => { widgetApi.toggleCrossFilter({ type: "value", value: r.value, field: cat, group: 0, reset: !(e.metaKey || e.ctrlKey) }); e.stopPropagation(); };
  return (
    <div className="claim share" onClick={(e) => { if (e.target === e.currentTarget) widgetApi.resetCrossFilter(); }}>
      {rows.map((r) => (
        <div className={`claim-row${selected.has(r.value) ? " on" : selected.size ? " dim" : ""}`} key={r.name}>
          <button type="button" className="claim-name" onClick={choose(r)} aria-pressed={selected.has(r.value)} title="Filter the page to this group">{r.name}</button>
          <div className="claim-bars" role="img" aria-label={`${r.name}: ${pct(r.a)} of what the ad report counts, ${pct(r.b)} of the money kept`}>
            <i className="claim-claimed" style={{ width: `${r.a * 100}%` }} />
            <i className="claim-confirmed" style={{ width: `${Math.max(0.8, r.b * 100)}%` }} />
          </div>
          <span className={`claim-v${(r.a - r.b) * 100 > flagAt ? " gap" : ""}`}>{pct(r.a)} → {pct(r.b)}</span>
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
  form: (params) => withSection(params.createDefaults({ dataMappingItems: [{ key: "category", label: "Ad" }, { key: "reported", label: "Counted by the ad report" }, { key: "money", label: "Money kept" }] }),
    { key: "flag", label: "Overrated ads", items: [{ type: "number", id: "format.style.flagPoints", label: "Flag when the report's share is ahead by more than (points)", defaultValue: 25, min: 0, max: 100, step: 5 }] }),
  formatShape: widgetFormat((s) => s.object({ flagPoints: s.number({ description: "Flag a row in amber when its share of what the ad report counts exceeds its share of the money kept by more than this many percentage points. Default 25." }).optional() })),
  comp: ShareGapWidget,
  featureConfig: { crossFilter: { supportsHighlight: true } },
  ai: { label: "Reported share vs money share", description: "Each ad or ad group: its share of what the ad report counts against its share of the money kept; clicking one filters the page to it.", usage: "Map category to the ad or group name, reported to leads or chats, money to money kept." },
  defaultSize: { width: 800, height: 240 },
  minSize: { width: 320, height: 140 },
};
