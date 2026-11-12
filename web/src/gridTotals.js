// The PayPal ledger grid's pinned total row, kept apart from the JSX so node tests can check it.
const money = (v) => `$${Number(v || 0).toFixed(2)}`;

// Keep Meta receipts separate from Google conversions; an early Google backfill can exist in Meta's log.
export function signalSummary(rows) {
  const meta = rows.filter((r) => r.source === "Meta click" && String(r.meta).startsWith("Received")).length;
  const google = rows.filter((r) => r.source === "Google click" && Number(r.kept) > 0 && !r.held && !r.disputed).length;
  return `${meta} Meta Purchase events · ${google} Google ${google === 1 ? "row" : "rows"}`;
}

// totals of the rows the filters leave showing, for the pinned row at the bottom
export function totalsOf(list, short = false) {
  const n = (f) => list.filter(f).length;
  const kept = list.reduce((s, r) => s + (typeof r.kept === "number" ? r.kept : r.held || r.status === "Refunded" ? 0 : r.amount - Number(r.raw?.refunded_amount || 0)), 0);
  return { ad: `Total · ${list.length} shown`, amount: list.reduce((s, r) => s + r.amount, 0), via: "", meta: signalSummary(list),
    kept, status: short ? `${n((r) => r.held)} held · ${n((r) => r.status === "Refunded")} back` : `${n((r) => r.held)} held · ${n((r) => r.status === "Refunded")} refunded`, capture_id: "",
    why: `${money(kept)} kept after refunds · ${n((r) => r.held)} held as possible double payments · ${n((r) => r.status === "Refunded")} refunded` };
}

// rows grouped by ad for the ledger grid: one subtotal row per ad (most money kept first), then that ad's payments
export function groupByAd(rows) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.ad)) by.set(r.ad, []); by.get(r.ad).push(r); }
  const groups = [...by.entries()].map(([ad, list]) => ({
    head: { isGroup: true, groupId: `group:${ad}`, ad: `${ad} (${list.length})`, amount: list.reduce((s, r) => s + r.amount, 0), kept: list.reduce((s, r) => s + r.kept, 0),
      status: `${list.filter((r) => r.held).length} held · ${list.filter((r) => r.status === "Refunded").length} refunded`, meta: signalSummary(list) },
    list }));
  groups.sort((a, b) => b.head.kept - a.head.kept);
  return groups.flatMap((g) => [g.head, ...g.list]);
}

// one bar per ad for the AG Charts chart above the grid: money kept, money held as a possible double payment, money
// refunded (full or part), most kept first; the three parts add up to what the ad's payments brought in
export function byAdChart(rows) {
  const by = new Map();
  for (const r of rows) {
    const b = by.get(r.ad) || { ad: r.ad, kept: 0, held: 0, refunded: 0, payments: 0 };
    b.payments += 1;
    // a held payment (possible double, or a dispute): what is still held, and what was already refunded of it
    if (r.held || r.disputed) { const back = Number(r.back) || 0; b.held += r.amount - back; b.refunded += back; } else { b.kept += r.kept; b.refunded += r.amount - r.kept; }
    by.set(r.ad, b);
  }
  const round = (v) => Math.round(v * 100) / 100;
  return [...by.values()].map((b) => ({ ...b, kept: round(b.kept), held: round(b.held), refunded: round(b.refunded) })).sort((a, b) => b.kept - a.kept || a.ad.localeCompare(b.ad));
}

// a payment's path in four steps, for the row that opens under it in the grid: the ad click, the PayPal capture, what the
// ledger counts, and what Meta heard (each from the payment itself; the full trail page has the evidence)
export function trailSteps(r) {
  const ledger = r.held ? "held as a possible double payment, $0.00 kept" : r.status === "Refunded" ? "refunded, $0.00 kept" : `${r.status === "Paid" ? "a paid order" : r.status.toLowerCase()}, ${money(r.kept)} kept`;
  return [
    { k: "Ad click", v: r.ad === "No ad click" ? "no ad click on the order" : `${r.source || "a click"} on ${r.ad}` },
    { k: "PayPal", v: `${r.via}, capture ${String(r.capture_id).slice(0, 8)}…, ${money(r.amount)}${r.date ? `, ${r.date}` : ""}` },
    { k: "Ledger", v: ledger },
    { k: "Meta", v: `${r.meta}${r.metaAt ? ` (${r.metaAt} UTC)` : ""}` },
  ];
}

// the trail row's height for the grid's width: four steps in a row, wrapped in two lines, or stacked in two columns
export const trailHeight = (w) => (w > 0 && w < 560 ? 196 : w < 900 ? 110 : 74);

// the grid's rows with a trail row under each payment the owner opened
export function withTrail(list, open) {
  return list.flatMap((r) => (!r.isGroup && open.has(r.capture_id) ? [r, { isDetail: true, detailId: `trail:${r.capture_id}`, of: r }] : [r]));
}

// the owner's Decision cell: what it shows and what it may change to; a refunded row has nothing left to decide
export function decisionOf(row) {
  if (row.held) return { value: "Hold", options: ["Hold", "Separate order…"] };
  if (row.refundable) return { value: "Keep", options: ["Keep", "Refund…"] };
  return { value: row.status === "Refunded" ? "Refunded" : "", options: [] };
}
