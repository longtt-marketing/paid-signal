// Custom AG Studio widget: a flow from each ad's share of what the ad report counts (left) to its share of the money
// PayPal confirms (right). Band width on each side is that share, so an ad the report overrates visibly narrows, and
// one it underrates widens. Shares come from the two sums Studio returns, so page filters and cross-filters apply.
import { useEffect, useRef, useState } from "react";
import { widgetFormat, withSection } from "./widgetForm.js";
import { stack, firstSentence } from "./flowLayout.js";
import { AD_NAMES } from "./names.js";

const pick = (row, field, i) => row[field?.key] ?? row[field?.id] ?? Object.values(row)[i];
const pct = (x) => `${Math.round(x * 100)}%`;
const KEY_OF = Object.fromEntries(Object.entries(AD_NAMES).map(([k, v]) => [v, k]));
const CHANGE = { increase: "Raise", reduce: "Cut", pause: "Pause", keep: "Keep", fix_tracking: "Fix tracking" };
const PAID = "#0B6B3A", CLAIMED = "#C4B99D", FADED = "#9C8F70", INK = "#14130F", LABEL = "#5A5242", SHEET = "#FFFDF7";

export function MoneyFlowWidget({ dataMapping, format, widgetApi, context }) {
  const order = format?.style?.rightOrder === "same" ? "same" : "money";
  const leftLabel = format?.style?.leftLabel || "Ad report counts", rightLabel = format?.style?.rightLabel || "PayPal confirms";
  const brief = (t) => t.split(" (")[0].split(" ").slice(0, 2).join(" ");
  const [rows, setRows] = useState([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useRef(null);
  // the budget agent's latest checked recommendation, so a click on an ad's band shows its verdict for the owner to decide
  const [rec, setRec] = useState(null);
  const [decided, setDecided] = useState({});
  const cat = dataMapping?.category?.[0], reported = dataMapping?.reported?.[0], money = dataMapping?.money?.[0];

  useEffect(() => {
    if (!cat || !reported || !money) { widgetApi.setDisplayState("incompleteDataMapping"); return; }
    let live = true;
    widgetApi.setDisplayState("loading");
    widgetApi.getData({ fields: [cat, reported, money], sort: [{ field: reported, direction: "desc" }] }).then((res) => {
      if (!live) return;
      const raw = (res.results?.rows || []).map((r) => ({ value: pick(r, cat, 0), name: String(pick(r, cat, 0)), a: Number(pick(r, reported, 1)) || 0, b: Number(pick(r, money, 2)) || 0 }));
      const ta = raw.reduce((n, r) => n + r.a, 0) || 1, tb = raw.reduce((n, r) => n + r.b, 0) || 1;
      const out = raw.map((r) => ({ ...r, sa: r.a / ta, sb: r.b / tb }));
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    }).catch(() => live && widgetApi.setDisplayState("noData"));
    return () => { live = false; };
  }, [cat, reported, money, widgetApi, context?.dataVersion]);

  const hasAds = rows.some((r) => KEY_OF[r.name]);
  useEffect(() => {
    if (!hasAds || rec) return;
    fetch("/api/recommendation").then((r) => r.json()).then((d) => d.latest && setRec(d.latest)).catch(() => {});
  }, [hasAds, rec]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selected = new Set((widgetApi.getCrossFilterSelections?.() || []).flatMap((s) => (s.type === "value" ? s.values : [])));
  const choose = (r) => (e) => { widgetApi.toggleCrossFilter({ type: "value", value: r.value, field: cat, group: 0, reset: !(e.metaKey || e.ctrlKey) }); e.stopPropagation(); };

  const one = selected.size === 1 ? rows.find((r) => selected.has(r.value)) : null;
  const key = one && KEY_OF[one.name];
  const actions = rec?.recommendation?.actions || [];
  const index = key ? actions.findIndex((a) => a.ad === key) : -1;
  const act = index >= 0 ? actions[index] : null;
  const decide = (verdict) => async (e) => {
    e.stopPropagation();
    setDecided((m) => ({ ...m, [key]: { busy: true } }));
    try {
      const r = await fetch("/api/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ad: key, verdict, rec_id: rec.id, index, reason: act.reason, evidence: act.evidence, change: act.change }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDecided((m) => ({ ...m, [key]: { verdict, id: d.id } }));
    } catch (err) { setDecided((m) => ({ ...m, [key]: { error: err.message } })); }
  };
  const { w, h: fullH } = size;
  const stripH = key && rec ? (fullH < 300 || w < 520 ? 84 : 58) : 0;
  const h = Math.max(60, fullH - stripH);
  const narrow = w < 520;
  const colW = narrow ? Math.max(96, Math.round(w * 0.36)) : Math.min(190, Math.max(80, w * 0.28));
  const fs = narrow ? 11 : 12.5;
  const top = 22, H = Math.max(40, h - top - 2), gap = rows.length > 1 ? Math.min(8, H * 0.04) : 0, minH = 3;
  const left = stack(rows, "sa", H, gap, minH);
  const rightRows = order === "money" ? [...rows].sort((x, y) => y.sb - x.sb) : rows;
  const right = stack(rightRows, "sb", H, gap, minH);
  const x0 = colW, x1 = Math.max(colW + 40, w - colW);
  const label = (r, side) => {
    const s = side === "l" ? r.sa : r.sb;
    const short = r.name.split(" · ")[0];
    const nm = short.length > 2 ? short : r.name;
    if (narrow) return `${nm.split(" ")[0].slice(0, 12)} ${pct(s)}`;
    // keep the share whole and shorten the name to fit the column (about 6.2 px a character at this size)
    const room = Math.floor((colW - 16) / 6.2) - pct(s).length - 3;
    return `${nm.length > room ? `${nm.slice(0, Math.max(1, room - 1)).trimEnd()}…` : nm} · ${pct(s)}`;
  };

  return (
    <div className="flow-w" ref={ref} onClick={(e) => { if (e.target === e.currentTarget || e.target.tagName === "svg") widgetApi.resetCrossFilter(); }}>
      {w > 0 && rows.length > 0 && (
        <svg width={w} height={h} role="img" aria-label={rows.map((r) => `${r.name}: ${pct(r.sa)} of what the ad report counts, ${pct(r.sb)} of the money`).join("; ")}>
          <text x={0} y={13} fontSize="12" fontWeight="600" fill={LABEL}>{narrow ? brief(leftLabel) : leftLabel}</text>
          <text x={w} y={13} fontSize="12" fontWeight="600" fill={LABEL} textAnchor="end">{narrow ? brief(rightLabel) : rightLabel}</text>
          {rows.map((r) => {
            const L = left[r.name], R = right[r.name];
            const ya = top + L.y, yb = top + R.y, mid = (x0 + x1) / 2;
            const on = selected.has(r.value), dim = selected.size && !on;
            const ahead = r.sb >= r.sa;
            const d = `M${x0},${ya} C${mid},${ya} ${mid},${yb} ${x1},${yb} L${x1},${yb + R.h} C${mid},${yb + R.h} ${mid},${ya + L.h} ${x0},${ya + L.h} Z`;
            return (
              <g key={r.name} className="flow-band" opacity={dim ? 0.3 : 1} onClick={choose(r)} style={{ cursor: "pointer" }}>
                <title>{`${r.name}: ${pct(r.sa)} of what the ad report counts → ${pct(r.sb)} of the money. Click to filter the page.`}</title>
                <path d={d} fill={ahead ? PAID : CLAIMED} opacity={on ? 0.7 : ahead ? 0.42 : 0.5} />
                <rect x={0} y={ya} width={x0} height={L.h} rx="3" fill={CLAIMED} />
                <rect x={x1} y={yb} width={w - x1} height={R.h} rx="3" fill={ahead ? PAID : FADED} />
                {L.h >= 15 && <text x={8} y={ya + Math.min(L.h / 2 + 4, 17)} fontSize={fs} fontWeight="600" fill={INK}>{label(r, "l")}</text>}
                {R.h >= 15 && <text x={x1 + 8} y={yb + Math.min(R.h / 2 + 4, 17)} fontSize={fs} fontWeight="600" fill={ahead ? SHEET : INK}>{label(r, "r")}</text>}
                {on && <path d={d} fill="none" stroke={INK} strokeWidth="1.5" />}
              </g>
            );
          })}
        </svg>
      )}
      {stripH > 0 && (() => {
        const dd = decided[key] || {};
        return (
          <div className="flow-verdict" style={{ height: stripH }} onClick={(e) => e.stopPropagation()}>
            <div className="fv-text"><span className="fv-k">Budget agent, checked by the rule in code</span>
              {act ? <span><b className={act.change === "increase" ? "fv-up" : act.change === "keep" ? "" : "fv-down"}>{CHANGE[act.change] || act.change}</b> {firstSentence(act.reason)}</span>
                : <span>No move for this ad in the latest checked run: fewer than 3 PayPal-confirmed paid orders, or nothing to change.</span>}</div>
            {act && <div className="fv-acts">{dd.id ? <span className="fv-done">{dd.verdict === "approved" ? "Approved" : "Dismissed"} · {dd.id}</span>
              : <><button type="button" className="fv-btn go" disabled={dd.busy} onClick={decide("approved")}>Approve</button><button type="button" className="fv-btn" disabled={dd.busy} onClick={decide("dismissed")}>Dismiss</button></>}
              {dd.error && <span className="fv-err">{dd.error}</span>}</div>}
          </div>
        );
      })()}
    </div>
  );
}

export const moneyFlowWidgetDefinition = {
  id: "money-flow",
  label: "Ad report → PayPal money flow",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5c9 0 9 14 18 14M3 12c9 0 9-7 18-7M3 19h18"/></svg>',
  dataMapping: {
    category: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "The ad or ad group (one band each)." },
    reported: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.category", cardinality: "one" }, required: true, aiDescription: "What the ad report counts, e.g. leads or chats (left side)." },
    money: { type: "field", supportedRoles: ["numeric"], requires: { per: "dataMapping.category", cardinality: "one" }, required: true, aiDescription: "Money PayPal confirms, or money kept after refunds (right side)." },
  },
  form: (params) => withSection(params.createDefaults({ dataMappingItems: [{ key: "category", label: "Ad" }, { key: "reported", label: "Counted by the ad report (left)" }, { key: "money", label: "Money (right)" }] }),
    { key: "flow", label: "Flow", items: [{ type: "select", id: "format.style.rightOrder", label: "Right side order", defaultValue: "money", items: [{ value: "money", label: "Most money first (bands cross)" }, { value: "same", label: "Same order as the left" }] },
      { type: "textfield", id: "format.style.leftLabel", label: "Left heading", placeholder: "Ad report counts" },
      { type: "textfield", id: "format.style.rightLabel", label: "Right heading", placeholder: "PayPal confirms" }] }),
  formatShape: widgetFormat((s) => s.object({ rightOrder: s.enum(["money", "same"], { description: "Order of the right side: 'money' puts the ad with the most money at the top so bands cross when the report's ranking is wrong; 'same' keeps the left order. Default 'money'." }).optional(), leftLabel: s.string({ description: "Heading over the left side. Default 'Ad report counts'." }).optional(), rightLabel: s.string({ description: "Heading over the right side. Default 'PayPal confirms'." }).optional() })),
  comp: MoneyFlowWidget,
  featureConfig: { crossFilter: { supportsHighlight: true } },
  ai: { label: "Ad report → PayPal money flow", description: "One band per ad from its share of what the ad report counts (left) to its share of the money PayPal confirms (right); green bands earn more than the report credits them; clicking a band filters the page to that ad and shows the budget agent's checked verdict for it, which the owner approves or dismisses (the decision is recorded; no live ad budget changes).", usage: "Map category to the ad or group name, reported to leads or chats, money to paid revenue or money kept." },
  defaultSize: { width: 800, height: 300 },
  minSize: { width: 300, height: 180 },
};
