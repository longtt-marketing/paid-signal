// The signature view: each ad flows from what the ad platform reports, through PayPal, back to the ad platform.
// Three stages per ad: leads the ad export reports, orders PayPal confirms paid, Purchase events Meta says it received.
// Bar heights share one scale, so the drop from 31 leads to 1 paid order is seen, not read. The caption says how the
// orders were paid (checkout or invoice) and how the events reached Meta (at capture or in the one-time backfill).
import { useEffect, useState } from "react";
import { adName } from "./names.js";

const STAGES = [["leads", "Leads the ads report", "Leads"], ["paid", "Paid, PayPal confirms", "Paid"], ["sent", "Received by Meta", "Meta got"]];
const short = (ad) => adName(ad).split(" · ")[0];
const narrowQuery = "(max-width: 520px)";

export default function FlowChart({ ads, payments, sends, held, worst }) {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(narrowQuery).matches);
  useEffect(() => { const m = matchMedia(narrowQuery); const on = () => setNarrow(m.matches); m.addEventListener("change", on); return () => m.removeEventListener("change", on); }, []);
  // on a phone the drawing gets a smaller canvas, so its text is not scaled down to unreadable
  const W = narrow ? 340 : 560, H = narrow ? 210 : 236, top = 30, colW = 18, gap = 6;
  const pay = Object.fromEntries((payments || []).map((p) => [p.capture_id, p]));
  const received = (sends || []).filter((m) => m.ok && m.events_received > 0 && pay[m.capture_id] && !m.superseded);
  const google = (payments || []).filter((p) => p.source === "g" && Number(p.refunded_amount || 0) < Number(p.amount) && !(held || []).includes(p.capture_id)).length;
  const rows = ads.map((a) => ({ ad: a.ad, leads: a.leads, paid: a.paid, sent: received.filter((m) => pay[m.capture_id].ad === a.ad).length }));
  const totals = Object.fromEntries(STAGES.map(([k]) => [k, rows.reduce((n, r) => n + r[k], 0)]));
  const max = Math.max(1, ...STAGES.map(([k]) => totals[k]));
  const unit = (H - top - gap * rows.length) / max;
  const xs = STAGES.map((_, i) => 8 + i * ((W - 16 - colW) / (STAGES.length - 1)));
  const seg = STAGES.map(([k]) => { let y = top; return rows.map((r) => { const h = Math.max(r[k] ? 2 : 0, r[k] * unit); const s = { y, h }; y += h + gap; return s; }); });
  const ribbon = (i, j) => {
    const a = seg[i][j], b = seg[i + 1][j];
    if (!a.h || !b.h) return null;
    const x1 = xs[i] + colW, x2 = xs[i + 1], m = (x1 + x2) / 2;
    return `M${x1},${a.y} C${m},${a.y} ${m},${b.y} ${x2},${b.y} L${x2},${b.y + b.h} C${m},${b.y + b.h} ${m},${a.y + a.h} ${x1},${a.y + a.h} Z`;
  };
  // paid orders that count: not fully refunded, not held as a possible duplicate
  const counted = (payments || []).filter((p) => Number(p.refunded_amount || 0) < Number(p.amount) && !(held || []).includes(p.capture_id));
  const byInvoice = counted.filter((p) => p.via === "invoice").length;
  const live = received.filter((m) => !m.backfill).length;
  const end = (i) => (i === STAGES.length - 1 ? "end" : "start");
  return (
    <figure className="flow" aria-label={`Leads ${totals.leads}, paid ${totals.paid}, received by Meta ${totals.sent}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {STAGES.map(([k, label, shortLabel], i) => (
          <g key={k}>
            <text x={xs[i] + (i === STAGES.length - 1 ? colW : 0)} y={12} className={`fl-n ${k}`} textAnchor={end(i)}>{totals[k]}</text>
            <text x={xs[i] + (i === STAGES.length - 1 ? colW : 0)} y={24} className="fl-l" textAnchor={end(i)}>{narrow ? shortLabel : label}</text>
          </g>
        ))}
        {rows.map((r, j) => STAGES.slice(0, -1).map((_, i) => {
          const d = ribbon(i, j);
          return d && <path key={`${r.ad}${i}`} d={d} className={`fl-rib s${i + 1} ${r.ad === worst ? "worst" : ""}`} />;
        }))}
        {rows.map((r, j) => STAGES.map(([k], i) => seg[i][j].h > 0 && (
          <rect key={`${r.ad}${k}`} x={xs[i]} y={seg[i][j].y} width={colW} height={seg[i][j].h} rx="3" className={`fl-bar ${k} ${r.ad === worst ? "worst" : ""}`}>
            <title>{`${adName(r.ad)}: ${r[k]} ${STAGES[i][1].toLowerCase()}`}</title>
          </rect>
        )))}
        {rows.map((r, j) => (
          <text key={`lbl${r.ad}`} x={xs[0] + colW + 6} y={seg[0][j].y + Math.min(seg[0][j].h, 22) / 2 + 4} className={`fl-ad ${r.ad === worst ? "worst" : ""}`}>{short(r.ad)} · {r.leads}</text>
        ))}
      </svg>
      <figcaption className="fl-cap">
        Paid: {totals.paid - byInvoice} at checkout, {byInvoice} by invoice. Meta received {totals.sent}: {live} sent at capture{totals.sent - live > 0 ? `, ${totals.sent - live} sent later for payments made before the live link` : ""}.{google ? ` ${google} from a Google click ${google === 1 ? "goes" : "go"} to Google instead.` : ""}
      </figcaption>
    </figure>
  );
}
