// The signature view: each ad flows from what the ad platform reports, through PayPal, back to the ad platform.
// Four stages per ad: leads the ad export reports, leads invoiced, orders PayPal confirms paid, Purchase events sent to Meta.
// Bar heights share one scale, so the drop from 31 leads to 1 paid order is seen, not read.
import { adName } from "./names.js";

const STAGES = [["leads", "Leads the ads report"], ["invoiced", "Invoiced via PayPal"], ["paid", "Paid, PayPal confirms"], ["sent", "Sent to Meta"]];
const short = (ad) => adName(ad).split(" · ")[0];

export default function FlowChart({ ads, invoices, payments, events, worst }) {
  const W = 560, H = 236, top = 30, colW = 18, gap = 6;
  const capAd = Object.fromEntries((payments || []).map((p) => [p.capture_id, p.ad]));
  const rows = ads.map((a) => ({
    ad: a.ad,
    leads: a.leads,
    invoiced: (invoices || []).filter((i) => i.ad === a.ad && i.status !== "CANCELLED").length,
    paid: a.paid,
    sent: (events || []).filter((e) => capAd[String(e.event_id).replace("paypal:", "")] === a.ad).length,
  }));
  const totals = Object.fromEntries(STAGES.map(([k]) => [k, rows.reduce((n, r) => n + r[k], 0)]));
  const max = Math.max(1, ...STAGES.map(([k]) => totals[k]));
  const unit = (H - top - gap * rows.length) / max;
  const xs = STAGES.map((_, i) => 8 + i * ((W - 16 - colW) / (STAGES.length - 1)));
  // stacked segments per stage, ads in the same order in every column
  const seg = STAGES.map(([k]) => { let y = top; return rows.map((r) => { const h = Math.max(r[k] ? 2 : 0, r[k] * unit); const s = { y, h }; y += h + gap; return s; }); });
  const ribbon = (i, j) => {
    const a = seg[i][j], b = seg[i + 1][j];
    if (!a.h || !b.h) return null;
    const x1 = xs[i] + colW, x2 = xs[i + 1], m = (x1 + x2) / 2;
    return `M${x1},${a.y} C${m},${a.y} ${m},${b.y} ${x2},${b.y} L${x2},${b.y + b.h} C${m},${b.y + b.h} ${m},${a.y + a.h} ${x1},${a.y + a.h} Z`;
  };
  return (
    <figure className="flow" aria-label={`Leads ${totals.leads}, invoiced ${totals.invoiced}, paid ${totals.paid}, sent to Meta ${totals.sent}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {STAGES.map(([k, label], i) => (
          <g key={k}>
            <text x={xs[i] + (i === STAGES.length - 1 ? colW : 0)} y={12} className={`fl-n ${k}`} textAnchor={i === STAGES.length - 1 ? "end" : "start"}>{totals[k]}</text>
            <text x={xs[i] + (i === STAGES.length - 1 ? colW : 0)} y={24} className="fl-l" textAnchor={i === STAGES.length - 1 ? "end" : "start"}>{label}</text>
          </g>
        ))}
        {rows.map((r, j) => STAGES.slice(0, -1).map((_, i) => {
          const d = ribbon(i, j);
          return d && <path key={`${r.ad}${i}`} d={d} className={`fl-rib s${i} ${r.ad === worst ? "worst" : ""}`} />;
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
    </figure>
  );
}
