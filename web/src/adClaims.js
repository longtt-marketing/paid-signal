// What each ad claims (leads in the ad report) against what PayPal confirms (paid orders), by ad name, shared by the
// dashboard's reconciliation with both ledger grids, so an ad's subtotal row can show the gap in one cell.
export const AD_CLAIMS = "paid-signal:ad-claims";
let claims = {};
export const getClaims = () => claims;
export function setClaims(next) {
  claims = next || {};
  if (typeof dispatchEvent === "function") dispatchEvent(new CustomEvent(AD_CLAIMS, { detail: claims }));
}

// the cell's words and bar: "31 leads → 1 paid" and how much of the claim PayPal confirms (0 to 1)
export function claimCell(c) {
  if (!c || !Number.isFinite(c.leads)) return null;
  const paid = Number(c.paid) || 0, leads = Number(c.leads) || 0;
  return { text: `${leads} lead${leads === 1 ? "" : "s"} → ${paid} paid`, share: leads > 0 ? Math.min(1, paid / leads) : 0 };
}

// rows that match a search: any of the ad, capture id, how it was paid, status or what Meta heard
export function searchRows(rows, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => [r.ad, r.capture_id, r.via, r.status, r.meta].some((v) => String(v || "").toLowerCase().includes(s)));
}
