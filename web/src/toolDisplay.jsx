// How Paid Signal's own tools read in AG Studio's chat panel: a plain row naming the work, a pill with the count, and a
// small body showing what the tool returned (PayPal invoices drafted, reminders sent, what the evidence gate decided).
// Without these, a custom tool shows only its name. Keyed by tool name, so a replayed chat renders the same way.
import { adName } from "./names.js";

const data = (p) => (p.result?.success ? p.result.data || {} : {});
const failed = (p) => p.status === "done" && p.result && !p.result.success;
const Rows = ({ rows }) => (
  <div className="tool-d">{rows.map(([l, v, cls], i) => <div className="tool-r" key={i}><span>{l}</span><b className={cls || ""}>{v}</b></div>)}</div>
);
const Err = ({ p }) => <div className="tool-d"><div className="tool-r"><span>{(p.result?.issues || []).map((x) => x.message).join(" ") || "The tool failed."}</span></div></div>;
const body = (fn) => function Detail(p) { if (failed(p)) return <Err p={p} />; if (p.status !== "done") return null; return <Rows rows={fn(data(p), p.args || {})} />; };
const usd = (v) => (v == null || v === "" ? "–" : `$${Number(v).toFixed(2)}`);

export const toolDisplay = {
  read_paid_signal: {
    label: (p) => ({ text: "Read what each ad claims and what PayPal confirms", pill: data(p).ads ? `${data(p).ads.length} ads` : undefined }),
    detail: body((d) => (d.ads || []).map((a) => [a.name, `${a.leads} leads → ${a.paid_orders} paid · ${usd(a.paid_revenue_usd)}`, a.paid_orders ? "" : "gap"])),
  },
  list_unpaid_leads: {
    label: (p) => ({ text: "Listed leads with no PayPal payment yet", pill: data(p).leads ? `${data(p).leads.length} leads` : undefined }),
    detail: body((d) => (d.leads || []).slice(0, 8).map((l) => [String(l.lead).replace(" (fictional)", ""), `${adName(l.ad)}${l.invoice ? ` · invoice ${l.invoice.toLowerCase()}` : ""}`])),
  },
  draft_paypal_invoices: {
    label: (p) => ({ text: p.status === "done" ? "Revenue agent drafted PayPal invoices (each waits for approval)" : "Revenue agent is reading the leads", pill: data(p).drafted ? `${data(p).drafted.filter((x) => !x.error).length} drafts` : undefined }),
    detail: body((d) => [
      ...(d.drafted || []).map((x) => [String(x.lead).replace(" (fictional)", ""), x.error ? x.error : `${usd(x.total_usd)} · draft, waits for approval`, x.error ? "gap" : "ok"]),
      ...(d.skipped || []).slice(0, 5).map((s) => [String(s.lead || "").replace(" (fictional)", ""), `skipped: ${s.reason || s.flag || "not ready"}`]),
    ]),
  },
  who_still_owes: {
    label: (p) => ({ text: "Read who still owes for a sent invoice", pill: data(p).invoices ? `${data(p).invoices.filter((i) => i.status !== "paid").length} waiting` : undefined }),
    detail: body((d) => (d.invoices || []).map((i) => [String(i.who).replace(" (fictional)", ""), i.status === "paid" ? `${usd(i.amount_usd)} · paid` : `${usd(i.amount_usd)} · waiting ${i.days_waiting} days`, i.status === "paid" ? "ok" : ""])),
  },
  send_friendly_nudges: {
    label: (p) => ({ text: p.status === "done" ? "Chase agent sent kind PayPal reminders" : "Chase agent is reading the unpaid invoices", pill: data(p).reminded ? `${data(p).reminded.length} sent` : undefined }),
    detail: body((d) => (d.reminded || []).length ? d.reminded.map((r) => [r.invoice, `“${r.note}”`]) : [["No reminder sent", d.chase_agent_summary || "nobody needed one"]]),
  },
  filter_page_to_ad: {
    label: (p) => ({ text: p.args?.clear ? "Cleared the page filter" : "Filtered the page to one ad", pill: data(p).value || undefined }),
  },
  check_paypal_ledger: {
    label: (p) => ({ text: "Checked the ledger against PayPal's Transaction Search", pill: data(p).matched ? `${data(p).matched.length} of ${data(p).ledger_count} matched` : undefined }),
    detail: body((d) => d.status !== "ok" ? [["PayPal", d.reason || "unavailable"]] : [
      ["Payments in PayPal's report", String(d.paypal_count)], ["Payments in the ledger", String(d.ledger_count)],
      ["Newer than PayPal's report", String((d.after_report_refresh || []).length)], ["Missing from PayPal's report", String((d.missing_from_paypal_report || []).length), (d.missing_from_paypal_report || []).length ? "gap" : "ok"]]),
  },
  submit_budget_recommendation: {
    label: (p) => ({ text: "Evidence gate checked the budget recommendation", pill: p.status === "done" && p.result?.success ? (data(p).grounded ? "Accepted" : "Rejected") : undefined }),
    detail: body((d, args) => [
      ...(args.actions || []).map((a) => [adName(a.ad) || a.ad, a.change, a.change === "increase" ? "ok" : a.change === "keep" ? "" : "gap"]),
      ...(d.grounded ? [["Gate", "every number and capture id found in the ledger", "ok"]] : (d.problems || []).map((x) => ["Gate", x, "gap"])),
    ]),
  },
};
