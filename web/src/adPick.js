// The ad picked on the report page, shared by the money flow and the PayPal ledger widget. Studio's cross-filter on the
// ads table does not reach the captures table, so the two widgets also tell each other which ads are picked; `from`
// says which widget picked, so the money flow can filter the page for a pick made in the ledger.
export const AD_PICK = "paid-signal:ad-pick";
let current = [];
export const getPick = () => current;
export function setPick(list, from = "") {
  current = [...new Set((list || []).map(String))].sort();
  if (typeof dispatchEvent === "function") dispatchEvent(new CustomEvent(AD_PICK, { detail: { list: current, from } }));
}
// a click on an ad: the only pick becomes none, anything else becomes that ad alone
export const nextPick = (cur, ad) => (cur.length === 1 && cur[0] === String(ad) ? [] : [String(ad)]);
