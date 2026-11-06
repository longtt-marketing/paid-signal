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
