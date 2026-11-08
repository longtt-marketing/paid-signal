// The Studio ledger widget registers here once its AG Grid is ready, and unregisters when it unmounts; the assistant's
// tools wait for it (the widget mounts only when its page is on screen) instead of sending events until one is heard.
// Studio can keep more than one copy of a widget mounted (a hidden one among them), so every copy registers and a
// request goes to all of them: the copy whose grid is on screen answers first.
const all = new Set();
const waiters = new Set();

function combined() {
  const list = [...all];
  const first = (calls) => Promise.any(calls.map((p) => Promise.resolve(p).then((x) => (x == null ? Promise.reject(new Error("no answer")) : x)))).catch(() => null);
  const apply = (view) => first(list.map((a) => a(view)));
  apply.toolkit = () => list.some((a) => a.toolkit?.());
  apply.schema = () => first(list.filter((a) => a.toolkit?.()).map((a) => a.schema()));
  apply.setGridState = (state, label) => first(list.filter((a) => a.setGridState && a.toolkit?.()).map((a) => a.setGridState(state, label)));
  return apply;
}

/** @param {(view: object) => Promise<any>} apply @returns {() => void} unregister */
export function registerLedger(apply) {
  all.add(apply);
  for (const w of waiters) w(combined());
  waiters.clear();
  return () => { all.delete(apply); };
}

/** A function that sends a view to every registered ledger grid, or null after `ms` when none is on screen. */
export function whenLedger(ms = 8000) {
  if (all.size) return Promise.resolve(combined());
  return new Promise((resolve) => {
    const w = (a) => { clearTimeout(t); resolve(a); };
    waiters.add(w);
    const t = setTimeout(() => { waiters.delete(w); resolve(null); }, ms);
  });
}

// What the agent asks for, as AG Grid's own filter model on the Status and Ad columns (text filters): it shows in the
// column headers and getFilterModel() reads it back. Status texts are the widget's: "Paid", "Paid, $9.00 back",
// "Refunded", "Held: double?", "Held: dispute".
export function filterModelFor(view) {
  if (!view) return null;
  const model = {};
  const t = (type, filter) => ({ filterType: "text", type, filter });
  if (view.status === "refunded") model.status = { filterType: "text", operator: "OR", conditions: [t("equals", "Refunded"), t("contains", " back")] };
  if (view.status === "held") model.status = t("startsWith", "Held");
  if (view.status === "refunded_or_held") model.status = { filterType: "text", operator: "OR", conditions: [t("equals", "Refunded"), t("contains", " back"), t("startsWith", "Held")] };
  if (view.status === "paid") model.status = { filterType: "text", operator: "AND", conditions: [t("notContains", "Held"), t("notEqual", "Refunded")] };
  if (view.ad) model.ad = t("equals", view.ad);
  return model;
}

// for the browser checks: how many ledger grids are registered right now
if (typeof window !== "undefined") window.__psLedgerRegistered = () => all.size;
