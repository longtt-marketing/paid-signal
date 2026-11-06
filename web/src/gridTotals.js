// The PayPal ledger grid's pinned total row, kept apart from the JSX so node tests can check it.
const money = (v) => `$${Number(v || 0).toFixed(2)}`;

// totals of the rows the filters leave showing, for the pinned row at the bottom
export function totalsOf(list, short = false) {
  const n = (f) => list.filter(f).length;
  const kept = list.reduce((s, r) => s + (r.held || r.status === "Refunded" ? 0 : r.amount - Number(r.raw?.refunded_amount || 0)), 0);
  return { ad: `Total · ${list.length} shown`, amount: list.reduce((s, r) => s + r.amount, 0), via: "", meta: `${n((r) => r.meta === "Received")} received`,
    status: short ? `${money(kept)} kept` : `${money(kept)} kept · ${n((r) => r.held)} held · ${n((r) => r.status === "Refunded")} refunded`, capture_id: "",
    why: `${money(kept)} kept after refunds · ${n((r) => r.held)} held as possible double payments · ${n((r) => r.status === "Refunded")} refunded` };
}
