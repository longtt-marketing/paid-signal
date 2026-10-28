// AG Studio configuration: data sources built from the reconciliation the Worker computes, the default report, and a
// theme that follows the design tokens in styles.css. Money arithmetic stays on the server (src/ledger.js); Studio only
// groups and sums rows the server already settled.
import { studioTheme } from "ag-studio";

export const AD_NAMES = {
  trial_video: "Trial class · video",
  free_guide: "Free guide · lead form",
  parent_carousel: "Parent testimonial · carousel",
  holiday_static: "Holiday camp · static",
};
export const adName = (k) => AD_NAMES[k] || k;

const f = (id, name, format, hide) => ({ id, name, format, ...(hide ? { hide } : {}) });
const sum = (id) => ({ id, aggregation: "sum" });

/** Two tables joined on the ad key: what each ad claims, and what PayPal captured for it. */
export function buildData(rec, payments) {
  const ads = rec.ads.map((r) => ({
    ad: r.ad, name: adName(r.ad), spend: r.spend_cents / 100, leads: r.leads, payers: r.paid, refunds: r.refunded,
    revenue: r.revenue_cents / 100, noPayer: r.paid === 0 ? r.spend_cents / 100 : 0,
  }));
  const known = new Set(rec.ads.map((r) => r.ad));
  const caps = payments.map((p) => {
    const gross = Number(p.amount), back = Number(p.refunded_amount || 0);
    return {
      id: p.capture_id, ad: known.has(p.ad) ? p.ad : "(not in export)", status: p.status, source: p.source === "fb" ? "Meta click" : p.source === "g" ? "Google click" : "Other",
      gross, refunded: back, net: Math.max(0, gross - back), paid: back >= gross ? 0 : 1, date: String(p.captured_at).slice(0, 10), capturedAt: p.captured_at,
    };
  });
  const dates = caps.map((c) => c.date).sort();
  const today = new Date().toISOString().slice(0, 10);
  return {
    description: "A small shop's ad export (spend and leads the ad platform reports per ad) joined to PayPal sandbox captures attributed to those ads by the click id stored in each order's custom_id. Payers counts captures not fully refunded.",
    sources: [
      {
        id: "ads", name: "Ads", description: "One row per ad from the ad platform export.", data: ads,
        fields: [f("ad", "Ad key", "textFormat", true), f("name", "Ad", "textFormat"), f("spend", "Spend", "currencyFormat"), f("leads", "Leads (ad-reported)", "integerFormat"),
          f("payers", "Payers (PayPal)", "integerFormat"), f("refunds", "Refunded captures", "integerFormat"), f("revenue", "Paid revenue", "currencyFormat"), f("noPayer", "Spend with no payer", "currencyFormat")],
      },
      {
        id: "captures", name: "PayPal captures", description: "One row per PayPal capture, attributed to an ad by click id.", data: caps,
        fields: [f("id", "Capture", "textFormat"), f("ad", "Ad key", "textFormat", true), f("status", "Status", "textFormat"), f("source", "Click source", "textFormat"),
          f("gross", "Captured", "currencyFormat"), f("refunded", "Refunded", "currencyFormat"), f("net", "Net paid", "currencyFormat"), f("paid", "Is paid", "integerFormat"), f("date", "Capture date", "dateFormat")],
      },
    ],
    relations: [{ id: "captures-ad", source: { tableId: "captures", fieldId: "ad" }, target: { tableId: "ads", fieldId: "ad" }, type: "many-to-one" }],
    calendars: [{ id: "calendar", label: "Calendar", range: { from: { type: "date", value: dates[0] || today }, to: { type: "date", value: dates.at(-1) || today } }, fragments: ["month", "week", "day"] }],
    expressions: [
      { id: "costPerPayer", name: "Cost per payer", description: "Ad spend divided by PayPal payers.", format: "decimalFormat", isMeasure: true, expression: { operator: "divide", inputs: [sum("ads.spend"), sum("ads.payers")] } },
      { id: "revenuePerDollar", name: "Paid revenue per ad dollar", description: "PayPal net revenue divided by ad spend.", format: "decimalFormat", isMeasure: true, expression: { operator: "divide", inputs: [sum("ads.revenue"), sum("ads.spend")] } },
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
        leads: kpi("Ad-reported leads", sum("ads.leads")),
        payers: kpi("PayPal payers", sum("ads.payers")),
        rpd: kpi("Paid revenue per ad dollar", { id: "revenuePerDollar" }),
        nopayer: kpi("Spend with no payer", sum("ads.noPayer")),
        claim: { type: "claim-vs-confirmed", dataMapping: { category: [{ id: "ads.name" }], claimed: [sum("ads.leads")], confirmed: [sum("ads.payers")] }, format: { title: { enabled: true, text: "What each ad claims vs what PayPal confirms" } } },
        table: {
          type: "grid",
          dataMapping: { cols: [{ id: "ads.name" }, sum("ads.spend"), sum("ads.leads"), sum("ads.payers"), sum("ads.refunds"), sum("ads.revenue"), { id: "costPerPayer" }] },
          sort: [{ field: { id: "ads.spend" }, direction: "desc" }],
          format: { title: { enabled: true, text: "Per ad" }, style: { headerRow: { wrapText: true } } },
        },
      },
      widgetLayout: { leads: at(0, 0, 6, 7), payers: at(6, 0, 6, 7), rpd: at(12, 0, 6, 7), nopayer: at(18, 0, 6, 7), claim: at(0, 7, 24, 13), table: at(0, 20, 24, 18) },
    },
    {
      id: "captures", name: "PayPal captures",
      widgets: {
        net: kpi("Net paid", sum("captures.net")),
        refunded: kpi("Refunded", sum("captures.refunded")),
        list: {
          type: "grid",
          dataMapping: { cols: [{ id: "captures.date" }, { id: "captures.id" }, { id: "ads.name" }, { id: "captures.source" }, { id: "captures.status" }, sum("captures.gross"), sum("captures.refunded"), sum("captures.net")] },
          sort: [{ field: { id: "captures.date" }, direction: "desc" }],
          format: { title: { enabled: true, text: "Every capture, attributed by click id" } },
        },
      },
      widgetLayout: { net: at(0, 0, 12, 7), refunded: at(12, 0, 12, 7), list: at(0, 7, 24, 20) },
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
  chartPaletteFills1Color: "#c9cbd2", chartPaletteStrokes1Color: "#c9cbd2", chartPaletteFills2Color: "#1a7a48", chartPaletteStrokes2Color: "#1a7a48",
});
