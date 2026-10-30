// Custom AG Studio widget: who still owes the shop money, as a friendly scoreboard rather than a collections report.
// One card per invoice the shop sent: who, how much, how long it has waited, and the last nudge the chase agent wrote.
// Reads rows through the widget API, so page filters and cross-filters apply.
import { useEffect, useState } from "react";

const pick = (row, field, i) => row[field?.key] ?? row[field?.id] ?? Object.values(row)[i];
const usd = (n) => "$" + Number(n || 0).toFixed(2);

export function OwesWidget({ dataMapping, widgetApi, context }) {
  const [rows, setRows] = useState([]);
  const who = dataMapping?.who?.[0], status = dataMapping?.status?.[0], amount = dataMapping?.amount?.[0], days = dataMapping?.days?.[0], nudge = dataMapping?.nudge?.[0];

  useEffect(() => {
    if (!who || !status || !amount || !days) { widgetApi.setDisplayState("incompleteDataMapping"); return; }
    let live = true;
    const fields = [who, status, amount, days, ...(nudge ? [nudge] : [])];
    widgetApi.setDisplayState("loading");
    widgetApi.getData({ fields }).then((res) => {
      if (!live) return;
      const order = { Waiting: 0, Nudged: 1, Paid: 2 };
      const out = (res.results?.rows || []).map((r) => ({ who: String(pick(r, who, 0)), status: String(pick(r, status, 1)), amount: Number(pick(r, amount, 2)) || 0, days: Number(pick(r, days, 3)) || 0, nudge: nudge ? String(pick(r, nudge, 4) || "") : "" }))
        .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.days - a.days);
      setRows(out);
      widgetApi.setDisplayState(out.length ? "displayed" : "noData");
    }).catch(() => live && widgetApi.setDisplayState("noData"));
    return () => { live = false; };
  }, [who, status, amount, days, nudge, widgetApi, context?.dataVersion]);

  const out = rows.filter((r) => r.status !== "Paid"), paid = rows.filter((r) => r.status === "Paid");
  return (
    <div className="owes">
      <div className="owes-score">
        <div><b>{usd(out.reduce((n, r) => n + r.amount, 0))}</b><span>still out, {out.length} invoice{out.length === 1 ? "" : "s"}</span></div>
        <div><b className="ok">{usd(paid.reduce((n, r) => n + r.amount, 0))}</b><span>paid, {paid.length} invoice{paid.length === 1 ? "" : "s"}</span></div>
        <div><b className="soft">{out.filter((r) => r.status === "Nudged").length}</b><span>nudged kindly</span></div>
      </div>
      <ol className="owes-list">
        {rows.map((r, i) => (
          <li key={`${r.who}-${i}`} className={`owes-${r.status.toLowerCase()}`}>
            <span className="owes-who"><b>{r.who}</b><small>{r.status === "Paid" ? "Paid, thank you" : r.status === "Nudged" ? `Nudged · waiting ${r.days} day${r.days === 1 ? "" : "s"}` : `Waiting ${r.days} day${r.days === 1 ? "" : "s"}`}</small></span>
            <span className="owes-amt">{usd(r.amount)}</span>
            {r.nudge && r.status !== "Paid" && <span className="owes-note">“{r.nudge}”</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export const owesWidgetDefinition = {
  id: "who-still-owes",
  label: "Who still owes",
  icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/></svg>',
  dataMapping: {
    who: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "Who was invoiced, e.g. the lead." },
    status: { type: "field", supportedRoles: ["category"], required: true, aiDescription: "Waiting, Nudged or Paid." },
    amount: { type: "field", supportedRoles: ["measure"], required: true, aiDescription: "Invoice total in USD." },
    days: { type: "field", supportedRoles: ["measure"], required: true, aiDescription: "Days since the invoice was sent." },
    nudge: { type: "field", supportedRoles: ["category"], required: false, aiDescription: "The last friendly reminder the chase agent wrote." },
  },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: "who", label: "Who" }, { key: "status", label: "Status" }, { key: "amount", label: "Amount" }, { key: "days", label: "Days waiting" }, { key: "nudge", label: "Last nudge" }] }),
  comp: OwesWidget,
  defaultSize: { width: 800, height: 420 },
  minSize: { width: 320, height: 240 },
};
