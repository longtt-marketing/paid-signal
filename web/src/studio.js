// AG Studio configuration: data sources built from the reconciliation the Worker computes, the default report, and a
// theme that follows the design tokens in styles.css. Money arithmetic stays on the server (src/ledger.js); Studio only
// groups and sums rows the server already settled.
import { disputeState } from "../../src/ledger.js";
import { studioTheme } from "ag-studio";

import { AD_NAMES, adName } from "./names.js";
export { AD_NAMES, adName };

// money shows as $1,234.50 everywhere in Studio, the same as on the dashboard
const USD = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };
const f = (id, name, format, hide) => ({ id, name, format, ...(format === "currencyFormat" ? { formatOptions: USD } : {}), ...(hide ? { hide } : {}) });
const sum = (id) => ({ id, aggregation: "sum" });

// The real gift shop's October (public/data/merchant-case.json and its published payment book): Vietnamese dong.
const VND = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "VND", maximumFractionDigits: 0 }) };
const fv = (id, name) => ({ id, name, format: "currencyFormat", formatOptions: VND });
const csvRows = (text) => {
  const [head, ...lines] = String(text || "").replace(/^﻿/, "").replace(/\r/g, "").split("\n").filter(Boolean);
  const keys = head ? head.split(",") : [];
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [keys[i], v])));
};
import { weekOf } from "./shopWeek.js";
/** Two tables from the real shop: its three ad groups (from the ad account and the order book), and every payment in its book. */
export function shopSources(read, paymentsCsv) {
  // Studio only takes data updates for tables it had from the start: the tables always exist, empty until the files load
  const split = Object.fromEntries((read?.paid_signal_split || []).map((x) => [x.id, x]));
  const SHORT = { A: "A · Video", B: "B · Reviews", C: "C · Occasion" };
  const groups = (read?.groups || []).map((g) => ({ id: g.id, name: `${g.id} · ${g.name}`, short: SHORT[g.id] || g.id, spendM: Math.round(g.spend / 1e6), moneyM: Math.round(g.net / 1e6), spend: g.spend, chats: g.conversations, kept: g.paid, money: g.net,
    back: Math.round(g.roas * 100) / 100, shareNow: Math.round((split[g.id]?.share_now ?? g.share_spend) * 1000) / 10, shareSplit: split[g.id] ? Math.round(split[g.id].share_proposed * 1000) / 10 : null }));
  const names = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  const pays = csvRows(paymentsCsv).map((r) => ({ id: r["Mã giao dịch nội bộ"], order: r["Số đối chiếu"], group: r["Nhóm Ads"], groupName: names[r["Nhóm Ads"]] || r["Nhóm Ads"],
    kind: r["Loại giao dịch"] === "Thu trùng" ? "Double payment" : "First payment", date: String(r["Ngày thu"] || "").slice(0, 10), week: weekOf(String(r["Ngày thu"] || "").slice(0, 10)),
    gross: Number(r["Số tiền thu"]) || 0, refunded: Number(r["Số tiền hoàn"]) || 0, net: Number(r["Số tiền ròng"]) || 0, kept: Number(r["Số tiền ròng"]) > 0 ? 1 : 0 }))
    .filter((p) => p.id);
  return {
    sources: [
      { id: "shopGroups", name: "Real shop: ad groups", description: "A Vietnamese gift shop's October 2026: three Meta ad groups, the chats the ad account reported, and the orders paid and kept after refunds from its own book (paid by bank transfer, not PayPal). Money in VND.", data: groups,
        fields: [f("id", "Group key", "textFormat", true), f("name", "Ad group", "textFormat"), f("short", "Ad group (short)", "textFormat"), f("spendM", "Ad spend, million VND", "integerFormat"), f("moneyM", "Money kept, million VND", "integerFormat"), fv("spend", "Ad spend"), f("chats", "Chats (ad account)", "integerFormat"), f("kept", "Orders kept (book)", "integerFormat"),
          fv("money", "Money kept after refunds"), f("back", "Money kept per 1 of ad spend", "decimalFormat"), f("shareNow", "Share of spend in October, %", "decimalFormat"), f("shareSplit", "Share under Paid Signal's rule, %", "decimalFormat")] },
      { id: "shopPayments", name: "Real shop: payments", description: "Every payment in the shop's published October book: 728 first payments and 7 double payments, each refunded; refunds come off.", data: pays,
        fields: [f("id", "Payment", "textFormat"), f("order", "Order", "textFormat"), f("group", "Group key", "textFormat", true), f("groupName", "Ad group", "textFormat"), f("kind", "Kind", "textFormat"),
          f("date", "Paid on", "dateFormat"), f("week", "Week", "textFormat"), fv("gross", "Paid"), fv("refunded", "Refunded"), fv("net", "Kept"), f("kept", "Is a kept order", "integerFormat")] },
    ],
    relation: { id: "shop-pay-group", source: { tableId: "shopPayments", fieldId: "group" }, target: { tableId: "shopGroups", fieldId: "id" }, type: "many-to-one" },
    expressions: [
      { id: "sChats", name: "Chats", format: "integerFormat", isMeasure: true, expression: sum("shopGroups.chats") },
      { id: "sKept", name: "Orders kept", format: "integerFormat", isMeasure: true, expression: sum("shopGroups.kept") },
      { id: "sMoney", name: "Money kept", format: "currencyFormat", formatOptions: VND, isMeasure: true, expression: sum("shopGroups.money") },
      { id: "sSpend", name: "Ad spend", format: "currencyFormat", formatOptions: VND, isMeasure: true, expression: sum("shopGroups.spend") },
      { id: "sMoneyM", name: "Kept, M VND", format: "integerFormat", isMeasure: true, expression: sum("shopGroups.moneyM") },
      { id: "sSpendM", name: "Spend, M VND", format: "integerFormat", isMeasure: true, expression: sum("shopGroups.spendM") },
      { id: "sNow", name: "October, %", format: "decimalFormat", isMeasure: true, expression: sum("shopGroups.shareNow") },
      { id: "sSplit", name: "Paid Signal's rule, %", format: "decimalFormat", isMeasure: true, expression: sum("shopGroups.shareSplit") },
      { id: "sBack", name: "Kept per 1 spent", format: "decimalFormat", isMeasure: true, expression: { operator: "divide", inputs: [sum("shopGroups.money"), sum("shopGroups.spend")] } },
      { id: "pKept", name: "Kept, VND", format: "currencyFormat", formatOptions: VND, isMeasure: true, expression: sum("shopPayments.net") },
      { id: "pOrders", name: "Kept orders", format: "integerFormat", isMeasure: true, expression: sum("shopPayments.kept") },
    ],
    dates: pays.map((p) => p.date),
  };
}

/** Two tables joined on the ad key: what each ad claims, and what PayPal captured for it and Meta received. */
export function buildData(rec, payments, invoices = [], duplicates = [], metaSends = [], shop = shopSources(null, ""), actions = []) {
  const ads = rec.ads.map((r) => ({
    ad: r.ad, name: adName(r.ad), spend: r.spend_cents / 100, leads: r.leads, payers: r.paid, refunds: r.refunded,
    revenue: r.revenue_cents / 100, noPayer: r.paid === 0 ? r.spend_cents / 100 : 0,
    invoiced: invoices.filter((i) => i.ad === r.ad && i.status !== "CANCELLED").length,
  }));
  const known = new Set(rec.ads.map((r) => r.ad));
  const held = new Set(duplicates.map((d) => d.capture_id)); // from /api/ledger: the set reconcile holds out
  const sent = Object.fromEntries(metaSends.map((m) => [m.capture_id, m]));
  const caps = payments.map((p) => {
    const gross = Number(p.amount), back = Number(p.refunded_amount || 0), hold = back < gross && held.has(p.capture_id);
    const ds = disputeState(p), disputed = ds === "open" || ds === "unclear" || ds === "lost";
    const m = sent[p.capture_id], inv = invoices.find((i) => i.id === p.order_id);
    // what the ad platform learned about this payment, in the owner's words
    const meta = m?.ok && m.events_received > 0 ? "Received by Meta" : back >= gross ? "Not sent: refunded" : disputed ? "Not sent: PayPal dispute" : hold ? "Not sent: possible double payment" : m?.held ? `Not sent: ${m.held}` : !p.click_id ? "Not sent: no ad click" : "Not sent yet";
    return {
      via: p.via === "invoice" ? "PayPal invoice" : "PayPal checkout", lead: inv ? inv.lead.replace(" (fictional)", "") : p.via === "invoice" ? "Invoice lead" : "Shop visitor", meta,
      metaAt: m?.ok ? String(m.at).slice(0, 19).replace("T", " ") : "",
      id: p.capture_id, ad: known.has(p.ad) ? p.ad : "(not in export)", adName: known.has(p.ad) ? adName(p.ad) : "No ad click", status: p.status, source: p.source === "fb" ? "Meta click" : p.source === "g" ? "Google click" : "Other",
      gross, refunded: back, net: hold || disputed ? 0 : Math.max(0, gross - back), paid: back >= gross || hold || disputed ? 0 : 1, held: hold || disputed ? 1 : 0, date: String(p.captured_at).slice(0, 10), capturedAt: p.captured_at,
    };
  });
  // every invoice the shop sent, for the "who still owes" scoreboard; drafts are not owed yet
  const DAY = 86400000;
  const owed = invoices.filter((i) => ["SENT", "UNPAID", "PARTIALLY_PAID", "PAID"].includes(i.status)).map((i) => ({
    id: i.id, who: String(i.lead || "").replace(" (fictional)", ""), adName: adName(i.ad), amount: Number(i.amount) || 0,
    status: i.status === "PAID" ? "Paid" : i.reminded_at ? "Nudged" : "Waiting",
    days: i.status === "PAID" || !i.sent_at ? 0 : Math.max(0, Math.round(((Date.now() - Date.parse(i.sent_at)) / DAY) * 10) / 10),
    nudge: i.status !== "PAID" && i.reminder?.note ? i.reminder.note : "",
  }));
  const dates = [...caps.map((c) => c.date), ...(shop?.dates || []), "2026-10-01"].filter(Boolean).sort(); // the shop's October is in range from the first render
  const today = new Date().toISOString().slice(0, 10);
  return {
    description: "A small shop's ad export (spend and leads the ad platform reports per ad) joined to PayPal sandbox captures attributed to those ads by the click id stored in each order's custom_id. Paid orders counts captures not fully refunded; a possible duplicate (same payer, same ad, minutes apart) is held: not a paid order and not net revenue until it is refunded.",
    sources: [
      {
        id: "ads", name: "Ads", description: "One row per ad from the ad platform export.", data: ads,
        fields: [f("ad", "Ad key", "textFormat", true), f("name", "Ad", "textFormat"), f("spend", "Spend", "currencyFormat"), f("leads", "Leads (ad-reported)", "integerFormat"),
          f("payers", "Paid orders (PayPal)", "integerFormat"), f("refunds", "Fully refunded", "integerFormat"), f("revenue", "Paid revenue", "currencyFormat"), f("noPayer", "Spend with no paid order", "currencyFormat"), f("invoiced", "Leads invoiced (PayPal)", "integerFormat")],
      },
      {
        id: "captures", name: "PayPal captures", description: "One row per PayPal capture, attributed to an ad by click id.", data: caps,
        fields: [f("id", "Capture", "textFormat"), f("ad", "Ad key", "textFormat", true), f("adName", "Ad", "textFormat"), f("status", "Status", "textFormat"), f("source", "Click source", "textFormat"),
          f("gross", "Captured", "currencyFormat"), f("refunded", "Refunded", "currencyFormat"), f("net", "Net paid", "currencyFormat"), f("paid", "Is paid", "integerFormat"), f("held", "Held as possible duplicate", "integerFormat"), f("date", "Capture date", "dateFormat"), f("capturedAt", "Captured at", "textFormat"),
          f("via", "Paid through", "textFormat"), f("lead", "Who paid", "textFormat"), f("meta", "Meta", "textFormat"), f("metaAt", "Meta received at (UTC)", "textFormat")],
      },
      {
        id: "invoices", name: "Invoices sent", description: "One row per PayPal invoice the shop sent: who, how much, whether it is paid, how long it has waited, and the last friendly reminder the chase agent wrote.", data: owed,
        fields: [f("id", "Invoice", "textFormat"), f("who", "Who", "textFormat"), f("adName", "Ad", "textFormat"), f("amount", "Amount", "currencyFormat"), f("status", "Status", "textFormat"), f("days", "Days waiting", "decimalFormat"), f("nudge", "Last nudge", "textFormat")],
      },
      {
        // every thing an agent wrote to PayPal, with what PayPal says about it now (read back by /api/agent-actions)
        id: "actions", name: "Agent actions on PayPal", description: "One row per thing an agent wrote to PayPal (an invoice drafted, sent or reminded; a refund; a payout), with the status PayPal returns for it when the page loads.",
        data: actions.map((a) => ({ key: a.key, date: String(a.at).slice(0, 10), when: String(a.at).slice(0, 16).replace("T", " "), whenShort: String(a.at).slice(5, 16).replace("T", " "), agentDid: `${a.agent} · ${a.did} (…${String(a.id).slice(-4)})`, agent: a.agent, did: a.did, kind: a.kind, id: a.id, amount: Number(a.amount) || 0,
          moved: a.kind === "invoice" ? 0 : Number(a.amount) || 0, paypal: a.paypal?.status || "not read", through: a.paypal?.through || "", one: 1, read: a.paypal?.status ? 1 : 0 })),
        fields: [f("key", "Action", "textFormat", true), f("date", "Date", "textFormat"), f("when", "When (UTC)", "textFormat"), f("whenShort", "When (UTC)", "textFormat"), f("agentDid", "Agent did", "textFormat"), f("agent", "Agent", "textFormat"), f("did", "Did", "textFormat"), f("kind", "PayPal object", "textFormat"),
          f("id", "PayPal id", "textFormat"), f("amount", "Amount", "currencyFormat"), f("moved", "Money moved", "currencyFormat"), f("paypal", "PayPal says now", "textFormat"), f("through", "Read through", "textFormat"),
          f("one", "Actions", "integerFormat"), f("read", "Read back from PayPal", "integerFormat")],
      },
      ...(shop ? shop.sources : []),
    ],
    relations: [...(shop ? [shop.relation] : []), { id: "captures-ad", source: { tableId: "captures", fieldId: "ad" }, target: { tableId: "ads", fieldId: "ad" }, type: "many-to-one" }],
    calendars: [{ id: "calendar", label: "Calendar", range: { from: { type: "date", value: dates[0] || today }, to: { type: "date", value: dates.at(-1) || today } }, fragments: ["month", "week", "day"] }],
    expressions: [
      // named measures, so the grid shows "Spend" rather than "Spend (sum)"
      ...[["mSpend", "Spend", "ads.spend", "currencyFormat"], ["mLeads", "Leads", "ads.leads", "integerFormat"], ["mPaid", "Paid orders", "ads.payers", "integerFormat"],
        ["mRefunds", "Refunded in full (not paid orders)", "ads.refunds", "integerFormat"], ["mRevenue", "Revenue", "ads.revenue", "currencyFormat"],
        ["cPaid", "Paid orders", "captures.paid", "integerFormat"], ["cNet", "Net paid", "captures.net", "currencyFormat"], ["cRefunded", "Refunded", "captures.refunded", "currencyFormat"]]
        .map(([id, name, field, format]) => ({ id, name, format, ...(format === "currencyFormat" ? { formatOptions: USD } : {}), isMeasure: true, expression: sum(field) })),
      { id: "costPerPayer", name: "Cost / paid order", description: "Ad spend divided by PayPal paid orders.", format: "currencyFormat", formatOptions: USD, isMeasure: true, expression: { operator: "divide", inputs: [sum("ads.spend"), sum("ads.payers")] } },
      ...(shop ? shop.expressions : []),
      { id: "revenuePerDollar", name: "Paid revenue per $1 of ads", description: "PayPal net revenue divided by ad spend.", format: "currencyFormat", formatOptions: USD, isMeasure: true, expression: { operator: "divide", inputs: [sum("ads.revenue"), sum("ads.spend")] } },
    ],
  };
}

const at = (xTrack, yTrack, xSpan, ySpan) => ({ xTrack, yTrack, xSpan, ySpan });
const kpi = (text, value) => ({ type: "value", dataMapping: { value: [value] }, format: { title: { enabled: true, text } } });

export const initialReport = {
  selectedPageId: "overview",
  panels: { filters: { collapsed: true }, data: { collapsed: true }, ai: { collapsed: true } },
  pages: [
    {
      // the first page is the path a judge follows: the report's claim against PayPal's money, every payment behind it
      // (filtered by the same click), and the agents acting on PayPal; the per-ad detail is on the next page
      id: "overview", name: "Ads vs PayPal",
      widgets: {
        flow: { type: "money-flow", dataMapping: { category: [{ id: "ads.name" }], reported: [sum("ads.leads")], money: [sum("ads.revenue")] }, format: { title: { enabled: true, text: "1 · Leads in the ad report → money PayPal confirms" } } },
        // the PayPal ledger, one row per capture; a band click in the flow narrows it to that ad (adPick.js)
        pays: { type: "paypal-ledger", dataMapping: { ad: [{ id: "captures.adName" }], id: [{ id: "captures.id" }], status: [{ id: "captures.status" }], via: [{ id: "captures.via" }], meta: [{ id: "captures.meta" }], source: [{ id: "captures.source" }], date: [{ id: "captures.date" }], gross: [sum("captures.gross")], refunded: [sum("captures.refunded")], net: [sum("captures.net")], held: [sum("captures.held")] },
          format: { title: { enabled: true, text: "2 · PayPal ledger: every payment, filtered with the page" } } },
        owes: { type: "who-still-owes", dataMapping: { who: [{ id: "invoices.who" }], status: [{ id: "invoices.status" }], amount: [sum("invoices.amount")], days: [{ id: "invoices.days", aggregation: "max" }], nudge: [{ id: "invoices.nudge" }] },
          format: { title: { enabled: true, text: "3 · Who still owes: the nudge agent sends PayPal reminders" } } },
        // beside it, the latest agent actions as PayPal reports them now: after a Nudge the new reminders come first
        recent: { type: "grid", dataMapping: { cols: [{ id: "actions.whenShort" }, { id: "actions.agentDid" }, { id: "actions.paypal" }] },
          sort: [{ field: { id: "actions.whenShort" }, direction: "desc" }], format: { title: { enabled: true, text: "4 · What the agents did, read back from PayPal" } } },
      },
      widgetLayout: { flow: at(0, 0, 24, 16), pays: at(0, 16, 24, 28), owes: at(0, 44, 11, 24), recent: at(11, 44, 13, 24) },
    },
    {
      // what the agents wrote to PayPal, each read back from PayPal: the agents act, PayPal confirms
      id: "agents", name: "Agents → PayPal",
      widgets: {
        acts: kpi("Things the agents wrote to PayPal", sum("actions.one")),
        reads: kpi("Read back from PayPal now", sum("actions.read")),
        moved: kpi("Money moved: refunds, payouts", sum("actions.moved")),
        list: { type: "grid", dataMapping: { cols: [{ id: "actions.when" }, { id: "actions.agent" }, { id: "actions.did" }, { id: "actions.kind" }, { id: "actions.id" }, { id: "actions.amount" }, { id: "actions.paypal" }, { id: "actions.through" }] },
          sort: [{ field: { id: "actions.when" }, direction: "desc" }], format: { title: { enabled: true, text: "Agent actions, newest first (up to 40), and what PayPal says about each now" }, style: { headerRow: { wrapText: true } } } },
      },
      widgetLayout: { acts: at(0, 0, 8, 7), reads: at(8, 0, 8, 7), moved: at(16, 0, 8, 7), list: at(0, 7, 24, 30) },
    },
    {
      id: "perad", name: "Per ad",
      widgets: {
        leads: kpi("Leads (ads)", sum("ads.leads")),
        payers: kpi("Paid orders", sum("ads.payers")),
        rpd: kpi("Revenue per $1 of ads", { id: "revenuePerDollar" }),
        nopayer: kpi("Ad spend per paid order", { id: "costPerPayer" }),
        claim: { type: "claim-vs-confirmed", dataMapping: { category: [{ id: "ads.name" }], claimed: [sum("ads.leads")], confirmed: [sum("ads.payers")] }, format: { title: { enabled: true, text: "What each ad claims vs what PayPal confirms" } } },
        table: {
          type: "grid",
          dataMapping: { cols: [{ id: "ads.name" }, { id: "mSpend" }, { id: "mLeads" }, { id: "mPaid" }, { id: "mRefunds" }, { id: "mRevenue" }, { id: "costPerPayer" }] },
          sort: [{ field: { id: "mSpend" }, direction: "desc" }],
          format: { title: { enabled: true, text: "Per ad" }, style: { headerRow: { wrapText: true } } },
        },
        funnel: { type: "lead-funnel", dataMapping: { category: [{ id: "ads.name" }], leads: [sum("ads.leads")], invoiced: [sum("ads.invoiced")], paid: [sum("ads.payers")] }, format: { title: { enabled: true, text: "Leads, PayPal invoices and paid orders, per ad" } } },
      },
      widgetLayout: { leads: at(0, 0, 6, 7), payers: at(6, 0, 6, 7), rpd: at(12, 0, 6, 7), nopayer: at(18, 0, 6, 7), claim: at(0, 7, 24, 13), table: at(0, 20, 24, 18), funnel: at(0, 38, 24, 13) },
    },
    {
      id: "captures", name: "PayPal captures",
      widgets: {
        net: kpi("Net paid", sum("captures.net")),
        refunded: kpi("Refunded", sum("captures.refunded")),
        timeline: { type: "payment-timeline", dataMapping: { lane: [{ id: "captures.adName" }], time: [{ id: "captures.capturedAt" }], id: [{ id: "captures.id" }], status: [{ id: "captures.status" }] }, format: { title: { enabled: true, text: "Every payment over time, by ad" } } },
        list: {
          type: "grid",
          dataMapping: { cols: [{ id: "captures.date" }, { id: "captures.id" }, { id: "captures.adName" }, { id: "captures.source" }, { id: "captures.status" }, sum("captures.gross"), sum("captures.refunded"), sum("captures.net")] },
          sort: [{ field: { id: "captures.date" }, direction: "desc" }],
          format: { title: { enabled: true, text: "Every capture, attributed by click id" } },
        },
      },
      widgetLayout: { net: at(0, 0, 12, 7), refunded: at(12, 0, 12, 7), timeline: at(0, 7, 24, 14), list: at(0, 21, 24, 20) },
    },
    {
      // the whole path per ad: how each payment came in, and whether the ad platform learned about it
      id: "ledger", name: "Ad → PayPal → Meta",
      widgets: {
        path: {
          type: "pivot-grid",
          dataMapping: { rows: [{ id: "captures.adName" }, { id: "captures.via" }, { id: "captures.meta" }], columns: [], values: [{ id: "cPaid" }, { id: "cNet" }, { id: "cRefunded" }] },
          format: { title: { enabled: true, text: "Each ad: paid through, and what Meta received" } },
        },
        ledger: {
          type: "grid",
          dataMapping: { cols: [{ id: "captures.adName" }, { id: "captures.lead" }, { id: "captures.via" }, { id: "captures.id" }, { id: "cNet" }, { id: "cRefunded" }, { id: "captures.meta" }, { id: "captures.metaAt" }] },
          sort: [{ field: { id: "captures.adName" }, direction: "asc" }],
          format: { title: { enabled: true, text: "Ledger: every payment from its ad to Meta" }, style: { headerRow: { wrapText: true } } },
        },
      },
      widgetLayout: { path: at(0, 0, 24, 16), ledger: at(0, 16, 24, 20) },
    },
    {
      // AG Grid's "nudge-bot" idea: who still owes what, as a friendly scoreboard; the Nudge agent sends the reminders
      id: "owes", name: "Who still owes",
      widgets: {
        board: { type: "who-still-owes", dataMapping: { who: [{ id: "invoices.who" }], status: [{ id: "invoices.status" }], amount: [sum("invoices.amount")], days: [{ id: "invoices.days", aggregation: "max" }], nudge: [{ id: "invoices.nudge" }] },
          format: { title: { enabled: true, text: "Who still owes" } } },
        list: { type: "grid", dataMapping: { cols: [{ id: "invoices.who" }, { id: "invoices.adName" }, { id: "invoices.status" }, sum("invoices.amount"), { id: "invoices.days", aggregation: "max" }] },
          sort: [{ field: { id: "invoices.status" }, direction: "desc" }], format: { title: { enabled: true, text: "Every invoice sent" } } },
      },
      widgetLayout: { board: at(0, 0, 24, 24), list: at(0, 24, 24, 18) },
    },
    {
      // the same question on a real shop's October book: what the ad account counted against the money kept
      id: "shop", name: "Real shop: October",
      widgets: {
        chats: kpi("Chats (ad account)", { id: "sChats" }),
        kept: kpi("Orders kept (book)", { id: "sKept" }),
        money: kpi("Money kept, million VND", { id: "sMoneyM" }),
        spend: kpi("Ad spend, million VND", { id: "sSpendM" }),
        flow: { type: "money-flow", dataMapping: { category: [{ id: "shopGroups.name" }], reported: [sum("shopGroups.chats")], money: [sum("shopGroups.money")] }, format: { title: { enabled: true, text: "Chats in the ad account → money kept" }, style: { leftLabel: "Chats (ad account)", rightLabel: "Money kept (shop's book)" } } },
        gap: { type: "share-gap", dataMapping: { category: [{ id: "shopGroups.name" }], reported: [sum("shopGroups.chats")], money: [sum("shopGroups.money")] }, format: { title: { enabled: true, text: "Each ad group: share of chats vs share of the money kept" } } },
        split: { type: "column-chart-grouped", dataMapping: { categoryKey: [{ id: "shopGroups.short" }], valueKey: [{ id: "sNow" }, { id: "sSplit" }] },
          format: { title: { enabled: true, text: "Share of spend, %: October vs Paid Signal's rule" }, style: { theme: { common: { legend: { enabled: true } } } } } },
        groups: { type: "grid", dataMapping: { cols: [{ id: "shopGroups.short" }, { id: "sSpendM" }, { id: "sChats" }, { id: "sKept" }, { id: "sMoneyM" }, { id: "sBack" }] },
          sort: [{ field: { id: "sChats" }, direction: "desc" }], format: { title: { enabled: true, text: "Per ad group" }, style: { headerRow: { wrapText: true } } } },
        daily: { type: "line-chart", dataMapping: { categoryKey: [{ id: "shopPayments.week" }], valueKey: [{ id: "pKept" }], legendKey: [{ id: "shopPayments.groupName" }] },
          format: { title: { enabled: true, text: "Money kept per week, by ad group" }, style: { theme: { common: { legend: { enabled: true } }, line: { series: { marker: { enabled: false } } } } } } },
        // the shop's whole published book (735 payments) in an AG Grid pivot: ad group and kind of payment by week
        book: { type: "pivot-grid", dataMapping: { rows: [{ id: "shopPayments.groupName" }, { id: "shopPayments.kind" }], columns: [{ id: "shopPayments.week" }], values: [{ id: "pOrders" }, { id: "pKept" }] },
          format: { title: { enabled: true, text: "The shop's book, 735 payments: kept orders and money kept per week" } } },
      },
      widgetLayout: { chats: at(0, 0, 6, 7), kept: at(6, 0, 6, 7), money: at(12, 0, 6, 7), spend: at(18, 0, 6, 7), flow: at(0, 7, 24, 15), gap: at(0, 22, 24, 11), groups: at(0, 33, 24, 14), split: at(0, 47, 10, 15), daily: at(10, 47, 14, 15), book: at(0, 62, 24, 14) },
    },
    // a blank page for the owner, or Studio's agents, to build their own views on the same tables
    { id: "mine", name: "Your page", widgets: {}, widgetLayout: {} },
  ],
};

// every widget takes part in cross-filtering: a click on an ad (or ad group) in a custom widget filters the rest of the page;
// the clicked widget itself highlights its row instead of filtering it away
const HIGHLIGHT = new Set(["claim-vs-confirmed", "share-gap", "money-flow"]);
for (const pg of initialReport.pages) for (const w of Object.values(pg.widgets)) w.format = { ...(w.format || {}), crossFilter: HIGHLIGHT.has(w.type) ? "highlight" : "filter" };

const v = (name) => `var(--${name})`;
// The "Ledger" look (Claude Design canvas https://claude.ai/artifact/BW1Dmbn5qtjd9KNfM1UHXP): warm account-book paper,
// cream sheets with a warm rule, green ink for money kept. Only what Studio's theme can set; one family, tabular numbers.
const L = { canvas: "#ECE6D6", sheet: "#FFFDF7", rule: "#B9AE92", row: "#DDD4BF", head: "#EFE8D6", ink: "#14130F", label: "#5A5242", paid: "#0B6B3A", claimed: "#C4B99D" };
const rule = (color) => ({ width: 1, color });
// green ink for money kept, the ruled grey for what the ad report counts, then amber (held), slate, rust, olive, plum, teal, sand, ink
const PALETTE = ["#0B6B3A", "#C4B99D", "#B7791F", "#3D5A80", "#9C4A2F", "#6B7B2C", "#6E4A7E", "#2F7C78", "#A88B5C", "#14130F"];
export const theme = studioTheme.withParams({
  fontFamily: v("sans"), fontSize: 14, textColor: L.ink, foregroundColor: L.ink, subtleTextColor: L.label,
  backgroundColor: L.sheet, borderColor: L.rule, accentColor: L.paid, iconColor: L.label, rowHoverColor: L.head,
  studioWrapperBorder: false, studioWrapperBorderRadius: 0, studioWrapperSpacing: 0, studioWrapperBackgroundColor: "transparent",
  studioCanvasBorder: false, studioCanvasBorderRadius: 0, studioCanvasShadow: false, studioCanvasBackgroundColor: "transparent",
  studioCanvasPadding: 16, studioCanvasRowHeight: 18, studioCanvasFontFamily: v("sans"),
  studioWidgetBackgroundColor: L.sheet, studioWidgetBorder: rule(L.rule), studioWidgetBorderRadius: 4, studioWidgetPadding: 14, studioValueWidgetFontSize: 36,
  studioWidgetTitleFontFamily: v("sans"), studioWidgetTitleFontSize: 15, studioWidgetTitleFontWeight: 700, studioWidgetTitleTextColor: L.ink,
  studioWidgetCaptionFontFamily: v("sans"), studioWidgetCaptionFontSize: 13, studioWidgetCaptionTextColor: L.label,
  gridFontFamily: v("sans"), gridFontSize: 14, gridCellTextColor: L.ink, gridHeaderBackgroundColor: L.head, gridHeaderTextColor: L.label,
  gridHeaderFontWeight: 600, gridHeaderFontSize: 12, gridRowHeight: 40, gridRowBorder: rule(L.row), gridHeaderRowBorder: rule(L.rule), gridWrapperBorder: false,
  chartFontFamily: v("sans"), chartTextColor: L.ink, chartSubtleTextColor: L.label, chartAxisLineColor: L.rule, chartGridLineColor: L.row,
  chartPaletteFills1Color: L.paid, chartPaletteStrokes1Color: L.paid, chartPaletteFills2Color: L.claimed, chartPaletteStrokes2Color: L.claimed,
  // ten ledger-ink series colours, so no chart falls back to Studio's defaults
  ...Object.fromEntries(PALETTE.flatMap((c, i) => [[`chartPaletteFills${i + 1}Color`, c], [`chartPaletteStrokes${i + 1}Color`, c]])),
  // the rest of Studio in the same ledger look: side panels, the assistant, menus, tooltips, buttons, inputs, toolbars, overlays
  studioPanelContainerBackgroundColor: L.sheet, studioPanelContainerBorder: rule(L.rule), studioPanelGroupBackgroundColor: L.head, studioPanelGroupTitleBarTextColor: L.ink,
  studioPanelSectionBorderColor: L.row, studioPanelDividerColor: L.rule, studioPanelDividerActiveColor: L.paid, studioPanelHeaderFontWeight: 700,
  studioPanelChevronButtonHoverBackgroundColor: L.head, studioPanelChevronButtonHoverColor: L.ink,
  studioAiPanelInputMessageBackgroundColor: L.head, studioAiPanelButtonHoverBackgroundColor: L.head, studioAiPanelRichTextAccentBackgroundColor: "#E4EFE6",
  studioToggleButtonActiveBackgroundColor: L.ink, studioToggleButtonActiveBorderColor: L.ink, studioToggleButtonActiveColor: L.sheet,
  menuBackgroundColor: L.sheet, menuTextColor: L.ink, menuSeparatorColor: L.row,
  tooltipBackgroundColor: L.ink, tooltipTextColor: L.sheet, tooltipBorder: rule(L.ink),
  buttonBackgroundColor: L.sheet, buttonTextColor: L.ink, buttonBorder: rule(L.rule), inputBackgroundColor: "#FFFFFF", inputBorder: rule(L.rule),
  studioWidgetToolbarBackgroundColor: L.sheet, studioWidgetToolbarBorder: rule(L.rule), studioWidgetToolbarButtonColor: L.label, studioWidgetToolbarButtonHoverBackgroundColor: L.head,
  studioWidgetLoadingOverlayBackgroundColor: "rgba(255,253,247,.7)", studioWidgetNoDataOverlayBackgroundColor: L.sheet,
  studioCanvasGridLineColor: L.row,
});

// On a phone the 24-column canvas is narrow: two KPI tiles per row, charts and grids full width, taller rows.
export const phoneReport = {
  ...initialReport,
  pages: initialReport.pages.map((pg) => ({
    ...pg,
    ...(pg.id === "perad" ? { widgets: { ...pg.widgets, rpd: kpi("Revenue per $1", { id: "revenuePerDollar" }), nopayer: kpi("Per paid order", { id: "costPerPayer" }) } } : {}),
    ...(pg.id === "shop" ? { widgets: { ...pg.widgets, chats: kpi("Chats", { id: "sChats" }), kept: kpi("Orders kept", { id: "sKept" }), money: kpi("Kept, M VND", { id: "sMoneyM" }), spend: kpi("Spend, M VND", { id: "sSpendM" }) } } : {}),
    widgetLayout: pg.id === "overview" ? { flow: at(0, 0, 24, 16), pays: at(0, 16, 24, 30), owes: at(0, 46, 24, 34), recent: at(0, 80, 24, 26) }
      : pg.id === "agents" ? { acts: at(0, 0, 12, 7), reads: at(12, 0, 12, 7), moved: at(0, 7, 24, 7), list: at(0, 14, 24, 34) }
      : pg.id === "perad"
      ? { leads: at(0, 0, 12, 7), payers: at(12, 0, 12, 7), rpd: at(0, 7, 12, 7), nopayer: at(12, 7, 12, 7), claim: at(0, 14, 24, 16), table: at(0, 30, 24, 20), funnel: at(0, 50, 24, 16) }
      : pg.id === "ledger" ? { path: at(0, 0, 24, 20), ledger: at(0, 20, 24, 24) }
      : pg.id === "owes" ? { board: at(0, 0, 24, 34), list: at(0, 34, 24, 20) }
      : pg.id === "mine" ? {}
      : pg.id === "shop" ? { chats: at(0, 0, 12, 7), kept: at(12, 0, 12, 7), money: at(0, 7, 12, 7), spend: at(12, 7, 12, 7), flow: at(0, 14, 24, 16), gap: at(0, 30, 24, 14), split: at(0, 44, 24, 16), groups: at(0, 60, 24, 18), daily: at(0, 78, 24, 16), book: at(0, 94, 24, 18) }
      : { net: at(0, 0, 12, 7), refunded: at(12, 0, 12, 7), timeline: at(0, 7, 24, 16), list: at(0, 23, 24, 22) },
  })),
};
// Studio's canvas is at least 720 px wide by default; on a phone it fits the screen instead
export const phoneTheme = theme.withParams({ studioCanvasMinWidth: 300, studioCanvasPadding: 8 });
