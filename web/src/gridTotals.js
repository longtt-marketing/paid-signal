// The PayPal ledger grid's pinned total row, kept apart from the JSX so node tests can check it.
const money = (v) => `$${Number(v || 0).toFixed(2)}`;

// totals of the rows the filters leave showing, for the pinned row at the bottom
export function totalsOf(list, short = false) {
  const n = (f) => list.filter(f).length;
  const kept = list.reduce((s, r) => s + (r.held || r.status === "Refunded" ? 0 : r.amount - Number(r.raw?.refunded_amount || 0)), 0);
  return { ad: `Total · ${list.length} shown`, amount: list.reduce((s, r) => s + r.amount, 0), via: "", meta: `${n((r) => r.meta === "Received")} received`,
    kept, status: short ? `${n((r) => r.held)} held · ${n((r) => r.status === "Refunded")} back` : `${n((r) => r.held)} held · ${n((r) => r.status === "Refunded")} refunded`, capture_id: "",
    why: `${money(kept)} kept after refunds · ${n((r) => r.held)} held as possible double payments · ${n((r) => r.status === "Refunded")} refunded` };
}

// rows grouped by ad for the ledger grid: one subtotal row per ad (most money kept first), then that ad's payments
export function groupByAd(rows) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.ad)) by.set(r.ad, []); by.get(r.ad).push(r); }
  const groups = [...by.entries()].map(([ad, list]) => ({
    head: { isGroup: true, groupId: `group:${ad}`, ad: `${ad} (${list.length})`, amount: list.reduce((s, r) => s + r.amount, 0), kept: list.reduce((s, r) => s + r.kept, 0),
      status: `${list.filter((r) => r.held).length} held · ${list.filter((r) => r.status === "Refunded").length} refunded`, meta: `${list.filter((r) => r.meta === "Received").length} received` },
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
    if (r.held) b.held += r.amount; else { b.kept += r.kept; b.refunded += r.amount - r.kept; }
    by.set(r.ad, b);
  }
  const round = (v) => Math.round(v * 100) / 100;
  return [...by.values()].map((b) => ({ ...b, kept: round(b.kept), held: round(b.held), refunded: round(b.refunded) })).sort((a, b) => b.kept - a.kept || a.ad.localeCompare(b.ad));
}

// the owner's Decision cell: what it shows and what it may change to; a refunded row has nothing left to decide
export function decisionOf(row) {
  if (row.held) return { value: "Hold", options: ["Hold", "Separate order…"] };
  if (row.refundable) return { value: "Keep", options: ["Keep", "Refund…"] };
  return { value: row.status === "Refunded" ? "Refunded" : "", options: [] };
}
