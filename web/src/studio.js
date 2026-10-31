// AG Studio configuration: data sources built from the reconciliation the Worker computes, the default report, and a
// theme that follows the design tokens in styles.css. Money arithmetic stays on the server (src/ledger.js); Studio only
// groups and sums rows the server already settled.
import { studioTheme } from "ag-studio";

import { AD_NAMES, adName } from "./names.js";
export { AD_NAMES, adName };

// money shows as $1,234.50 everywhere in Studio, the same as on the dashboard
const USD = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };
const f = (id, name, format, hide) => ({ id, name, format, ...(format === "currencyFormat" ? { formatOptions: USD } : {}), ...(hide ? { hide } : {}) });
const sum = (id) => ({ id, aggregation: "sum" });

/** Two tables joined on the ad key: what each ad claims, and what PayPal captured for it and Meta received. */
export function buildData(rec, payments, invoices = [], duplicates = [], metaSends = []) {
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
    const m = sent[p.capture_id], inv = invoices.find((i) => i.id === p.order_id);
    // what the ad platform learned about this payment, in the owner's words
    const meta = m?.ok && m.events_received > 0 ? "Received by Meta" : back >= gross ? "Held: fully refunded" : hold ? "Held: possible duplicate" : m?.held ? `Held: ${m.held}` : !p.click_id ? "Held: no ad click" : "Not sent yet";
    return {
      via: p.via === "invoice" ? "PayPal invoice" : "PayPal checkout", lead: inv ? inv.lead.replace(" (fictional)", "") : p.via === "invoice" ? "Invoice lead" : "Shop visitor", meta,
      metaAt: m?.ok ? String(m.at).slice(0, 19).replace("T", " ") : "",
      id: p.capture_id, ad: known.has(p.ad) ? p.ad : "(not in export)", adName: known.has(p.ad) ? adName(p.ad) : "No ad click", status: p.status, source: p.source === "fb" ? "Meta click" : p.source === "g" ? "Google click" : "Other",
      gross, refunded: back, net: hold ? 0 : Math.max(0, gross - back), paid: back >= gross || hold ? 0 : 1, held: hold ? 1 : 0, date: String(p.captured_at).slice(0, 10), capturedAt: p.captured_at,
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
  const dates = caps.map((c) => c.date).sort();
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
    ],
    relations: [{ id: "captures-ad", source: { tableId: "captures", fieldId: "ad" }, target: { tableId: "ads", fieldId: "ad" }, type: "many-to-one" }],
    calendars: [{ id: "calendar", label: "Calendar", range: { from: { type: "date", value: dates[0] || today }, to: { type: "date", value: dates.at(-1) || today } }, fragments: ["month", "week", "day"] }],
    expressions: [
      // named measures, so the grid shows "Spend" rather than "Spend (sum)"
      ...[["mSpend", "Spend", "ads.spend", "currencyFormat"], ["mLeads", "Leads", "ads.leads", "integerFormat"], ["mPaid", "Paid orders", "ads.payers", "integerFormat"],
        ["mRefunds", "Refunded in full (not paid orders)", "ads.refunds", "integerFormat"], ["mRevenue", "Revenue", "ads.revenue", "currencyFormat"],
        ["cPaid", "Paid orders", "captures.paid", "integerFormat"], ["cNet", "Net paid", "captures.net", "currencyFormat"], ["cRefunded", "Refunded", "captures.refunded", "currencyFormat"]]
        .map(([id, name, field, format]) => ({ id, name, format, ...(format === "currencyFormat" ? { formatOptions: USD } : {}), isMeasure: true, expression: sum(field) })),
      { id: "costPerPayer", name: "Cost / paid order", description: "Ad spend divided by PayPal paid orders.", format: "currencyFormat", formatOptions: USD, isMeasure: true, expression: { operator: "divide", inputs: [sum("ads.spend"), sum("ads.payers")] } },
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
      id: "overview", name: "Ads vs PayPal",
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
  ],
};

const v = (name) => `var(--${name})`;
const line = (name) => ({ width: 1, color: v(name) });
export const theme = studioTheme.withParams({
  fontFamily: v("sans"), fontSize: 14, textColor: v("ink"), foregroundColor: v("ink"), subtleTextColor: v("faint"),
  backgroundColor: v("card"), borderColor: v("line"), accentColor: v("paid"), iconColor: v("mute"), rowHoverColor: v("head"),
  studioWrapperBorder: false, studioWrapperBorderRadius: 0, studioWrapperSpacing: 0, studioWrapperBackgroundColor: v("paper"),
  studioCanvasBorder: false, studioCanvasBorderRadius: 0, studioCanvasShadow: false, studioCanvasBackgroundColor: v("paper"),
  studioCanvasPadding: 16, studioCanvasRowHeight: 18, studioCanvasFontFamily: v("sans"),
  studioWidgetBackgroundColor: v("card"), studioWidgetBorder: line("line"), studioWidgetBorderRadius: 12, studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: v("sans"), studioWidgetTitleFontSize: 15, studioWidgetTitleFontWeight: 600, studioWidgetTitleTextColor: v("ink"),
  studioWidgetCaptionFontFamily: v("sans"), studioWidgetCaptionFontSize: 13, studioWidgetCaptionTextColor: v("faint"),
  gridFontFamily: v("sans"), gridFontSize: 14, gridCellTextColor: v("ink"), gridHeaderBackgroundColor: v("head"), gridHeaderTextColor: v("mute"),
  gridHeaderFontWeight: 600, gridHeaderFontSize: 12, gridRowHeight: 40, gridRowBorder: line("line2"), gridHeaderRowBorder: line("line"), gridWrapperBorder: false,
  chartFontFamily: v("sans"), chartTextColor: v("ink"), chartSubtleTextColor: v("faint"), chartAxisLineColor: v("line"), chartGridLineColor: v("line2"),
  chartPaletteFills1Color: "#1a7a48", chartPaletteStrokes1Color: "#1a7a48", chartPaletteFills2Color: "#c9cbd2", chartPaletteStrokes2Color: "#c9cbd2",
});

// On a phone the 24-column canvas is narrow: two KPI tiles per row, charts and grids full width, taller rows.
export const phoneReport = {
  ...initialReport,
  pages: initialReport.pages.map((pg) => ({
    ...pg,
    ...(pg.id === "overview" ? { widgets: { ...pg.widgets, rpd: kpi("Revenue per $1", { id: "revenuePerDollar" }), nopayer: kpi("Per paid order", { id: "costPerPayer" }) } } : {}),
    widgetLayout: pg.id === "overview"
      ? { leads: at(0, 0, 12, 7), payers: at(12, 0, 12, 7), rpd: at(0, 7, 12, 7), nopayer: at(12, 7, 12, 7), claim: at(0, 14, 24, 16), table: at(0, 30, 24, 20), funnel: at(0, 50, 24, 16) }
      : pg.id === "ledger" ? { path: at(0, 0, 24, 20), ledger: at(0, 20, 24, 24) }
      : pg.id === "owes" ? { board: at(0, 0, 24, 34), list: at(0, 34, 24, 20) }
      : { net: at(0, 0, 12, 7), refunded: at(12, 0, 12, 7), timeline: at(0, 7, 24, 16), list: at(0, 23, 24, 22) },
  })),
};
// Studio's canvas is at least 720 px wide by default; on a phone it fits the screen instead
export const phoneTheme = theme.withParams({ studioCanvasMinWidth: 300, studioCanvasPadding: 8 });
