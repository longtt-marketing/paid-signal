// Custom AG Studio widget: every PayPal capture on a time line, one lane per ad. Paid captures are solid green,
// refunded ones amber rings, partly refunded ones half filled. Reads through the widget API, so filters apply.
import { useEffect, useState } from "react";

const pick = (row, field, i) => row[field?.key] ?? row[field?.id] ?? Object.values(row)[i];
const COLOR = { COMPLETED: "#1a7a48", REFUNDED: "#8a4b00", PARTIALLY_REFUNDED: "#1a7a48" };

export function TimelineWidget({ dataMapping, widgetApi, context }) {
  const [rows, setRows] = useState([]);
  const lane = dataMapping?.lane?.[0], time = dataMapping?.time?.[0], id = dataMapping?.id?.[0], status = dataMapping?.status?.[0];

  useEffect(() => {
    if (!lane || !time || !id || !status) { widgetApi.setDisplayState("incompleteDataMapping"); return; }
    let live = true;
    widgetApi.setDisplayState("loading");
    widgetApi.getData({ fields: [lane, time, id, status] }).then((res) => {
      if (!live) return;
      const out = (res.results?.rows || []).map((r) => ({ lane: String(pick(r, lane, 0)), at: Date.parse(pick(r, time, 1)), id: String(pick(r, id, 2)), status: String(pick(r, status, 3)) }))
        .filter((r) => Number.isFinite(r.at));
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    }).catch(() => live && widgetApi.setDisplayState("noData"));
    return () => { live = false; };
  }, [lane, time, id, status, widgetApi, context?.dataVersion]);

  const lanes = [...new Set(rows.map((r) => r.lane))].sort();
  const t0 = Math.min(...rows.map((r) => r.at)), t1 = Math.max(...rows.map((r) => r.at));
  const W = 1000, L = 190, R = 24, H = 34, top = 8;
  const x = (t) => L + (t1 > t0 ? ((t - t0) / (t1 - t0)) * (W - L - R) : (W - L - R) / 2);
  const day = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${W} ${top + lanes.length * H + 28}`} role="img" aria-label={`${rows.length} PayPal captures over time by ad`}>
        {lanes.map((name, i) => (
          <g key={name}>
            <text x={0} y={top + i * H + H / 2 + 5} className="tl-name">{name}</text>
            <line x1={L} x2={W - R} y1={top + i * H + H / 2} y2={top + i * H + H / 2} className="tl-lane" />
          </g>
        ))}
        {rows.map((r) => {
          const cy = top + lanes.indexOf(r.lane) * H + H / 2, cx = x(r.at), c = COLOR[r.status] || "#6b7080";
          return (
            <g key={r.id}>
              <title>{`${r.id} · ${r.status.toLowerCase().replace("_", " ")} · ${new Date(r.at).toLocaleString()}`}</title>
              {r.status === "REFUNDED" ? <circle cx={cx} cy={cy} r={8} fill="#fff" stroke={c} strokeWidth={3} />
                : r.status === "PARTIALLY_REFUNDED" ? <><circle cx={cx} cy={cy} r={8} fill="#fff" stroke={c} strokeWidth={3} /><path d={`M ${cx} ${cy - 8} A 8 8 0 0 1 ${cx} ${cy + 8} Z`} fill={c} /></>
                : <circle cx={cx} cy={cy} r={8} fill={c} />}
            </g>
          );
        })}
        {rows.length > 0 && <><text x={L} y={top + lanes.length * H + 22} className="tl-axis">{day(t0)}</text><text x={W - R} y={top + lanes.length * H + 22} className="tl-axis" textAnchor="end">{day(t1)}</text></>}
      </svg>
      <div className="claim-key"><span><i className="claim-confirmed" /> paid</span><span><i className="tl-half" /> partly refunded</span><span><i className="tl-ring" /> refunded</span></div>
    </div>
  );
}

export const timelineWidgetDefinition = {
  id: "payment-timeline",
  label: "Payment timeline",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h18M3 16h18"/><circle cx="8" cy="8" r="2" fill="currentColor"/><circle cx="15" cy="16" r="2"/></svg>',
  dataMapping: {
    lane: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "One lane per value, e.g. the ad." },
    time: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "When the payment was captured (ISO time)." },
    id: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "The PayPal capture id." },
    status: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "Capture status: COMPLETED, PARTIALLY_REFUNDED or REFUNDED." },
  },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: "lane", label: "Lane" }, { key: "time", label: "Captured at" }, { key: "id", label: "Capture" }, { key: "status", label: "Status" }] }),
  comp: TimelineWidget,
  defaultSize: { width: 800, height: 260 },
  minSize: { width: 360, height: 160 },
};
