// Paid Signal tools for AG Studio's lead agent. Read tools return numbers computed by the Worker; the one write tool
// only creates PayPal DRAFT invoices. A person approves each one in Approvals; only then does the send agent send it.
import { claudeAdapter } from "./claudeAdapter.js";
import { createAiHarness, directLlmRunner } from "ag-studio";
import { adName, AD_NAMES } from "./names.js";
import { seededHistory } from "./history.js";
import { REPLAY_PROMPT, HAS_REPLAY, PAGE_REPLAY_PROMPT, HAS_PAGE_REPLAY } from "./claudeAdapter.js";
import { eligibleForReminder } from "../../src/chaseAgent.js";
import { whenLedger } from "./ledgerView.js";

const get = async (path, signal) => { const r = await fetch(path, { signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };
const post = async (path, body, signal) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };

const BUILD_PAGE = "Open Your page (it is blank) and have Studio's page and widget agents build it from the PayPal captures table: a value widget of money refunded (captures.refunded), a column chart of money refunded per ad (captures.adName, sum of captures.refunded), and a grid of the captures with ad, capture, status, captured and refunded. Then tell me in two lines what the page shows.";

export const PROMPT_STARTERS = [
  // shown only once a recorded run is bundled (web/src/replay-budget.json)
  ...(HAS_REPLAY ? [{ label: "Replay a budget run (no model call)", prompt: `${REPLAY_PROMPT}: ask the budget agent which ads to cut or grow, and have it show the evidence on this page.` }] : []),
  ...(HAS_PAGE_REPLAY ? [{ label: "Replay Studio building a page (no model call)", prompt: `${PAGE_REPLAY_PROMPT}: ${BUILD_PAGE}` }] : []),
  { label: "Which ads bring paid orders?", prompt: "Using the Paid Signal tools, which ads bring paying customers and which only bring leads? Quote the numbers exactly." },
  { label: "Group the ledger by ad (AI Toolkit)", prompt: "In the PayPal ledger, group the payments by ad and show the money kept per ad." },
  { label: "Invoice warm leads", prompt: "Have the revenue agent read what the unpaid leads wrote and draft PayPal invoices for the ones ready to pay. Tell me who it invoiced, for how much, and who it skipped or flagged and why, then show me the drafts here to approve." },
  { label: "Review ad budgets", prompt: "Ask the budget agent which ads to cut or grow, and have it show the evidence on this page." },
  { label: "Chart paid revenue by ad", prompt: "Add a bar chart of paid revenue by ad to this page." },
  { label: "Nudge who still owes", prompt: "Get kind PayPal reminders ready for the people who still owe us for a sent invoice, so I can send them from here, and open the Who still owes page." },
  { label: "Explain the real shop", prompt: "Open the Real shop: October page. Using its tables (Real shop: ad groups, Real shop: payments), explain in three sentences which ad group the ad account overrated: its share of chats against its share of the money kept. Quote the numbers exactly and say the shop was paid by bank transfer." },
  { label: "Show refunded or held payments", prompt: "In the PayPal ledger, show me the payments that were refunded or are held, newest first, then tell me in two lines what they are." },
  { label: "Build a page with Studio's agents", prompt: BUILD_PAGE },
  { label: "Show only the free guide", prompt: "Filter the Ads vs PayPal page to the free guide, then tell me in two lines what PayPal confirms for it against what the ad report claims." },
  { label: "Check against PayPal", prompt: "Check the webhook ledger against PayPal's own transaction history and tell me if anything is missing." },
];

const EXTRA = `You also act for a small shop that sells through PayPal. Ad platforms report leads; PayPal confirms who paid.
Use read_paid_signal for per-ad spend, leads, paid orders and revenue (computed in code; quote numbers exactly, never invent or forecast).
Use list_unpaid_leads to see leads with no PayPal payment. draft_paypal_invoices creates PayPal DRAFT invoices tagged with each lead's ad click;
nothing is sent here: each draft waits in Approvals, and only after the shop owner approves it does the send agent send it. Draft only for leads who showed buying intent, and say why. Draft only when the owner asks to invoice leads: the people in the PayPal ledger have already paid, so a request to invoice or bill them is declined, and nothing is drafted.
After drafting, or when the owner asks what waits for approval, call show_drafts_for_approval: it puts each draft in this chat as a card with an Approve button. You cannot approve or send; only the owner's click does, and the send agent checks the draft again first.
check_paypal_ledger compares the webhook ledger with PayPal's Transaction Search.
For budget questions (which ads to cut, keep or grow), delegate to the budget agent; it checks its numbers in code.
For invoices that were sent and not paid, call who_still_owes, then propose_nudges yourself (not through another agent), so its card shows in this chat: the chase agent sends the reminders, within code limits, only when the owner presses Send on it. It also opens the "Who still owes" page.
To show particular payments (refunded, held, one ad's, biggest first), call show_payments_in_ledger: the PayPal ledger grid filters, sorts and flashes them. To group or total payments (money kept per ad, payments grouped by status), use AG Grid's AI Toolkit: call get_ledger_grid_schema, then set_ledger_grid_state with a state that matches it (a total per group is a rowGroup plus a sum aggregation on the column the owner named, picked by the column descriptions; when the owner limits the rows, for example refunded payments only, put that limit in the same state's filter, never in show_payments_in_ledger); if the toolkit is not available, use show_payments_in_ledger. If the owner names an ad that is not one of the four in the export (Free guide, Trial class, Testimonial, Holiday camp), say there is no such ad and name the four; never pick a similar-sounding one. To show one ad (or one shop ad group) across a page, call filter_page_to_ad; to build a new view, use the blank "Your page".
The tables "Real shop: ad groups" and "Real shop: payments" are a real Vietnamese gift shop's October book (VND, paid by bank transfer, not PayPal): the same gap between what the ad account counts and the money kept. Say so whenever you use them.
Every amount in the PayPal tables is in US dollars: write $156.00, never a bare number.
Answer the owner briefly: at most six short lines (for budgets: Grow, Keep, Cut, then one line on what the evidence gate decided). Never pass on widget health-check notes (Studio's check can flag "data mapping unmapped" on a widget that renders fine) or layout chatter, and never ask the owner to check the page.`;

// AG Grid's nudge-bot idea, built on the chase agent: who still owes, and kind reminders sent through PayPal's Agent Toolkit.
const NUDGE = `You are the Paid Signal nudge agent. You help a small shop get paid for invoices it already sent, kindly: a heads-up, never a demand.
1. Call who_still_owes. Quote names and amounts exactly as given.
2. If anyone is waiting, call propose_nudges once. It puts a card in this chat listing who a reminder may go to; nothing is sent until the owner presses Send on it. Then the chase agent reads each invoice from PayPal, decides who a reminder would help and writes it; code allows only unpaid invoices, at most three a run, and no invented amount or discount.
3. Ask the page agent to show the "Who still owes" page.
4. Finish with two or three friendly sentences: who is waiting and for how much, and that the reminders go only when the owner presses Send on the card. You never send anything yourself.`;

// A custom Studio agent. It proposes budget changes through the Worker's evidence gate (the same check the
// standalone budget agent passes), then hands work to Studio's page agent to put the evidence on the dashboard.
const BUDGET = `You are the Paid Signal budget agent for a small shop that sells through PayPal.
1. Call read_paid_signal. Quote numbers exactly as given; never compute, forecast or round. Write plain words, not field names.
   In anything a person reads (headline, reasons, chat), call an ad by its name (for example "Holiday camp · static"), never its key, and write money as $118.40.
   Paid revenue is already net of refunds: a refunded payment is taken out before you see it. Never suggest refunds may not be netted out.
   Call it "paid revenue minus ad spend"; do not use the word "profit" (product cost is unknown). Write money with a dollar sign ($118.40; a shortfall as "$41.50 below ad spend").
2. Call submit_budget_recommendation once with 1 to 3 actions. Evidence is "row:<ad key>" for an ad's row. An ad with fewer than 3 paid orders gets "keep" (or "fix_tracking"), never pause, reduce or increase; say it needs more paid orders. Say when an ad has a possible duplicate held out of its paid orders (if it is a real second purchase, its paid count is one higher).
   If it comes back rejected, fix exactly the listed problems and submit again (one repair).
3. Once accepted, delegate to the page agent once: ask it to add one grouped column chart titled "Paid revenue vs spend, by ad",
   with category field ads.name and two values, the measures mRevenue (Revenue) and mSpend (Spend). Name these field ids in your request.
4. Finish with a short summary in three lines: Grow, Keep, Cut (name the ad and one PayPal number each), then whether the gate accepted it. Keep every step short: one read, one submit, one delegation. You never change budgets yourself: the owner approves in the approvals column.`;

export function buildAi({ getCsv, onInvoices, onRecommendation, onNudge }) {
  const adapter = claudeAdapter({ model: "claude-sonnet-5-5" });
  return ({ api }) => {
    const custom = [
      api.defineAiTool({
        name: "read_paid_signal",
        description: "Per-ad spend, ad-reported leads, PayPal paid orders, net paid revenue and cost per paid order, plus totals. other_payments_refunded_in_full counts separate payments refunded in full: they are not among paid_orders, and a paid order may still carry a partial refund. Computed in code from the ad export and PayPal captures.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const [d, l] = await Promise.all([post("/api/reconcile", { csv: getCsv() }, ctx.signal), get("/api/ledger", ctx.signal)]);
          const r = d.reconciliation, $ = (c) => (c / 100).toFixed(2);
          return ctx.success("Reconciliation loaded.", {
            totals: { leads: r.totals.leads, paid_orders: r.totals.paid, other_payments_refunded_in_full: r.totals.refunded, spend_usd: $(r.totals.spend_cents), paid_revenue_usd: $(r.totals.revenue_cents), spend_on_ads_with_no_paid_order_usd: $(r.totals.spend_without_paid_cents) },
            ads: r.ads.map((a) => ({ ad: a.ad, name: adName(a.ad), spend_usd: $(a.spend_cents), leads: a.leads, paid_orders: a.paid, other_payments_refunded_in_full: a.refunded, paid_revenue_usd: $(a.revenue_cents), cost_per_paid_order_usd: a.cost_per_paid_cents == null ? "none paid" : $(a.cost_per_paid_cents) })),
            // same payer, same ad, minutes apart: held out of paid orders until refunded, and the agent must say so
            possible_duplicates: l.duplicates.map((x) => ({ capture_id: x.capture_id, same_payer_and_ad_as: x.first, seconds_apart: x.seconds, ad: l.payments.find((p) => p.capture_id === x.capture_id)?.ad })),
          });
        },
      }),
      api.defineAiTool({
        name: "list_unpaid_leads",
        description: "Leads from the ad platform who have not paid through PayPal yet, with the ad they came from, what they asked about, and any invoice already drafted.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const [{ leads }, { invoices }] = await Promise.all([get("/api/leads", ctx.signal), get("/api/invoices", ctx.signal)]);
          const status = (l) => invoices.find((i) => i.lead === l.lead && i.status === "PAID")?.status || invoices.find((i) => i.lead === l.lead)?.status || null;
          const unpaid = leads.filter((l) => status(l) !== "PAID"); // a lead who paid an invoice is a customer, not an unpaid lead
          return ctx.success(`${unpaid.length} unpaid leads.`, { leads: unpaid.map((l) => ({ lead: l.lead, ad: l.ad, asked_for: l.asked_for, invoice: status(l) })) });
        },
      }),
      api.defineAiTool({
        name: "draft_paypal_invoices",
        description: "Run the revenue agent: it reads what each unpaid lead wrote, decides who is ready to pay, and proposes items; code prices them from the price list and checks every rule, and PayPal's Agent Toolkit creates the DRAFT invoices. Nothing is sent: each draft waits for the owner's approval.",
        params: (s) => s.object({ reason: s.string({ description: "Why run it now, in one sentence." }) }),
        execute: async (_args, ctx) => {
          const d = await post("/api/agent/revenue", {}, ctx.signal);
          onInvoices?.(d);
          return ctx.success(`${d.drafts.filter((x) => x.id).length} draft(s) created; ${d.skips.length} lead(s) skipped.`, {
            drafted: d.drafts.map((x) => ({ lead: x.lead, total_usd: x.amount, lines: (x.lines || []).map((l) => l.name), reason: x.reason, error: x.error })),
            skipped: d.skips, refused_by_code: d.refusals, agent_summary: d.summary });
        },
      }),
      api.defineAiTool({
        name: "show_drafts_for_approval",
        description: "Show the PayPal DRAFT invoices that wait for the owner, as cards with Approve buttons in this chat. Read only: it approves and sends nothing. Only the owner's click on Approve sends a draft, through the send agent, which checks it against what was approved.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const { invoices } = await get("/api/invoices", ctx.signal);
          const drafts = invoices.filter((i) => i.status === "DRAFT").slice(0, 6);
          return ctx.success(`${drafts.length} draft(s) wait for the owner's approval.`, { drafts: drafts.map((i) => ({ id: i.id, who: i.lead, amount_usd: i.amount, ad_name: adName(i.ad) || "no ad" })) });
        },
      }),
      api.defineAiTool({
        name: "who_still_owes",
        description: "Invoices the shop sent: who, how much, paid or not, days waiting, and the last reminder sent. Read only.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const { invoices } = await get("/api/invoices", ctx.signal);
          const sent = invoices.filter((i) => ["SENT", "UNPAID", "PARTIALLY_PAID", "PAID"].includes(i.status));
          const days = (i) => (i.sent_at ? Math.floor((Date.now() - Date.parse(i.sent_at)) / 86400000) : 0);
          const paid = sent.filter((i) => i.status === "PAID").length;
          return ctx.success(`${sent.length - paid} sent invoice(s) still waiting, ${paid} paid.`, {
            invoices: sent.map((i) => ({ who: i.lead, amount_usd: i.amount, status: i.status === "PAID" ? "paid" : "waiting", days_waiting: i.status === "PAID" ? 0 : days(i), last_reminder: i.reminded_at ? i.reminder?.note || "sent" : null })) });
        },
      }),
      // a reminder reaches a real (sandbox) customer, and the agent reads text leads wrote: so the agent only proposes,
      // and the owner's Send on the card runs the chase agent (no Studio tool can write to PayPal without a click)
      api.defineAiTool({
        name: "propose_nudges",
        description: "Open the Who still owes page and put a card in this chat listing the sent, unpaid invoices a kind PayPal reminder may go to (the same eligibility the chase agent uses: sent over an hour ago, not reminded in the last day). Sends nothing: only the owner's Send on the card runs the chase agent, which reads each invoice from PayPal and reminds at most three.",
        params: (s) => s.object({ reason: s.string({ description: "Why nudge now, in one sentence." }) }),
        execute: async (_args, ctx) => {
          const { invoices } = await get("/api/invoices", ctx.signal);
          const ready = eligibleForReminder(invoices);
          // open the Who still owes page beside the card, so the owner sees who it is about
          const studio = typeof window !== "undefined" ? window.__studio : null; if (studio) studio.setState({ ...studio.getState(), selectedPageId: "owes" });
          return ctx.success(`${ready.length} invoice(s) a reminder may go to; nothing sent until the owner presses Send.`, { ready: ready.map((i) => ({ id: i.id, who: i.lead, amount_usd: i.amount, sent_at: i.sent_at })) });
        },
      }),
      api.defineAiTool({
        name: "filter_page_to_ad",
        description: "Filter the report page to one ad (or, on the Real shop page, one ad group), the same cross-filter a click on that ad in the custom widget applies. Pass the ad key (free_guide, trial_video, parent_carousel, holiday_static) or the group letter (A, B, C); pass clear: true to remove the filter.",
        params: (s) => s.object({ ad: s.string({ description: "Ad key or shop group letter." }).optional(), clear: s.boolean().optional() }),
        execute: async (args, ctx) => {
          const studio = typeof window !== "undefined" ? window.__studio : null;
          if (!studio) return ctx.success("The report is not open.", { applied: false });
          const st = studio.getState(), shop = /^[ABC]$/.test(String(args.ad || "").toUpperCase());
          const pageId = shop ? "shop" : "overview", widgetId = shop ? "gap" : "flow", field = shop ? "shopGroups.name" : "ads.name";
          const SHOP = { A: "A · Attention video", B: "B · Customer reviews", C: "C · Personalised for an occasion" };
          const value = shop ? SHOP[String(args.ad).toUpperCase()] : adName(String(args.ad || ""));
          // only this widget's own selection changes: a filter a person set on another widget of the page stays
          const keepOthers = (pg) => Object.fromEntries(Object.entries(pg.crossFilter?.values || {}).filter(([w]) => w !== widgetId));
          const pages = st.pages.map((pg) => pg.id !== pageId ? pg : { ...pg, crossFilter: { ...(pg.crossFilter || {}), values: args.clear ? keepOthers(pg) : { ...keepOthers(pg), [widgetId]: [{ type: "value", field: { id: field }, group: 0, values: [value] }] } } });
          studio.setState({ ...st, pages, selectedPageId: pageId });
          return ctx.success(args.clear ? "This tool's filter is cleared; filters set on other widgets stay." : `The ${pageId === "shop" ? "Real shop" : "Ads vs PayPal"} page now shows only ${value}.`, { applied: true, page: pageId, value: args.clear ? null : value });
        },
      }),
      // the agent drives the AG Grid ledger itself: AG Grid filters, sorts, scrolls to and flashes what was asked for
      api.defineAiTool({
        name: "show_payments_in_ledger",
        description: "Show payments in the PayPal ledger grid on the Ads vs PayPal page (not for totals: any request to total, sum or add up payments per ad or per status, even for some payments only, goes to get_ledger_grid_schema and set_ledger_grid_state): the grid lists payments flat, filtered and sorted by AG Grid as asked, scrolls to them and flashes them; returns how many it shows and the first five (capture, ad, captured, kept, status). Read only. status: all, refunded, held (a possible double payment or an open PayPal dispute: kept out of paid orders and revenue until the owner counts it as a separate order, or it is refunded or the dispute is won), refunded_or_held, paid. ad: an ad key (free_guide, trial_video, parent_carousel, holiday_static), optional. sort: amount_desc, amount_asc, kept_desc, date_desc. reset: true goes back to the grouped ledger.",
        params: (s) => s.object({
          status: s.enum(["all", "refunded", "held", "refunded_or_held", "paid"]).optional(),
          ad: s.string({ description: "Ad key, optional." }).optional(),
          sort: s.enum(["amount_desc", "amount_asc", "kept_desc", "date_desc"]).optional(),
          reset: s.boolean().optional(),
        }),
        execute: async (args, ctx) => {
          const studio = typeof window !== "undefined" ? window.__studio : null;
          if (!studio) return ctx.success("The report is not open.", { applied: false });
          const st = studio.getState(); if (st.selectedPageId !== "overview") studio.setState({ ...st, selectedPageId: "overview" });
          // an ad that is not in the export (a typo, an ad from another platform) changes nothing: the agent is told which ads exist
          const want = String(args.ad || "").trim(), low = want.toLowerCase();
          const match = want ? Object.entries(AD_NAMES).find(([k, n]) => k === low || n.toLowerCase() === low || n.toLowerCase().startsWith(low) || low.includes(n.toLowerCase().split(" · ")[0]) || low.includes(k)) : null;
          if (want && !match) return ctx.success(`There is no ad called "${want}" in this ad export; the grid is unchanged. The ads are: ${Object.values(AD_NAMES).join(", ")}.`, { applied: false, ads: AD_NAMES });
          const ad = match ? match[1] : "";
          const words = { refunded: "refunded", held: "held", refunded_or_held: "refunded or held", paid: "paid" }[args.status] || "every payment";
          const order = { amount_desc: "biggest first", amount_asc: "smallest first", kept_desc: "most kept first", date_desc: "newest first" }[args.sort] || "";
          const label = [words, ad && `on ${ad}`, order].filter(Boolean).join(", ");
          // the ledger widget registers once its grid is ready (it may still be mounting after the page switch)
          const apply = await whenLedger(8000);
          const out = apply ? await Promise.race([apply(args.reset ? { reset: true } : { status: args.status, ad, sort: args.sort, label }), new Promise((r) => setTimeout(() => r(null), 8000))]) : null;
          if (args.reset) return ctx.success("The ledger is back to every payment, grouped by ad.", { applied: true });
          if (!out) return ctx.success("The ledger grid did not answer; it may not be on screen.", { applied: false });
          const { ids, ...rest } = out; // every capture id the grid now shows, in its order (the eval compares them with the ledger)
          return ctx.success(`The ledger grid now shows ${out.shown} payment(s): ${label}. AG Grid's filter model: ${JSON.stringify(out.filter_model)}.`, { applied: true, view: label, ...rest, capture_ids: ids });
        },
      }),
      // AG Grid's AI Toolkit on the PayPal ledger: the grid describes the states it accepts (getStructuredSchema), Claude
      // writes one, and the grid applies it (setState). Read only: it changes what the grid shows, never the ledger.
      api.defineAiTool({
        name: "get_ledger_grid_schema",
        description: "AG Grid AI Toolkit: the PayPal ledger grid's structured schema from api.getStructuredSchema(): its columns, their values, and the JSON shape of the grid states it accepts (filter, sort, row grouping, aggregation). Call it before set_ledger_grid_state, for requests that group or total the payments (for example money kept per ad, or payments grouped by status). Read only.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const st = window.__studio; if (st && st.getState().selectedPageId !== "overview") st.setState({ ...st.getState(), selectedPageId: "overview" });
          const apply = await whenLedger(8000);
          const schema = apply?.toolkit?.() ? await Promise.race([apply.schema(), new Promise((r) => setTimeout(() => r(null), 8000))]) : null;
          if (!schema) return ctx.success("The AG Grid AI Toolkit is not available in this build; use show_payments_in_ledger instead.", { available: false });
          return ctx.success("Here is the ledger grid's schema. Write a grid state that matches it and pass it to set_ledger_grid_state as JSON.", { available: true, schema });
        },
      }),
      api.defineAiTool({
        name: "set_ledger_grid_state",
        description: "AG Grid AI Toolkit: apply a grid state to the PayPal ledger grid with api.setState(). Pass state_json, a JSON object that matches the schema from get_ledger_grid_schema (for example a rowGroup and an aggregation, a filter, a sort). Returns the rows and groups the grid then shows and the state it holds. Read only; it never changes the ledger.",
        params: (s) => s.object({ state_json: s.string({ description: "The grid state as a JSON object, matching the schema." }), label: s.string({ description: "A few words for the owner, for example 'money kept per ad'." }).optional() }),
        execute: async (args, ctx) => {
          let state;
          try { state = JSON.parse(args.state_json); } catch { return ctx.success("state_json is not valid JSON; nothing changed.", { applied: false }); }
          if (!state || typeof state !== "object" || Array.isArray(state)) return ctx.success("The state must be a JSON object; nothing changed.", { applied: false });
          const apply = await whenLedger(8000);
          if (!apply?.setGridState || !apply.toolkit?.()) return ctx.success("The AG Grid AI Toolkit is not available in this build; nothing changed.", { applied: false });
          const out = await Promise.race([apply.setGridState(state, args.label), new Promise((r) => setTimeout(() => r(null), 8000))]);
          if (!out) return ctx.success("The ledger grid did not answer; it may not be on screen.", { applied: false });
          const { ids, ...rest } = out;
          return ctx.success(`The ledger grid now shows ${out.shown} payment(s)${out.groups?.length ? ` in ${out.groups.length} group(s)` : ""}.`, { applied: true, ...rest, capture_ids: ids });
        },
      }),
      api.defineAiTool({
        name: "open_page",
        description: "Show one page of the report: overview (Ads vs PayPal), agents (Agents → PayPal), shop (Real shop: October), owes (Who still owes), perad, captures, ledger, or mine (Your page, blank for new views). Do this before asking the page agent to build on a page.",
        params: (s) => s.object({ page: s.enum(["overview", "agents", "perad", "captures", "ledger", "owes", "shop", "mine"]) }),
        execute: async (args, ctx) => {
          const studio = typeof window !== "undefined" ? window.__studio : null;
          if (!studio) return ctx.success("The report is not open.", { applied: false });
          const st = studio.getState(), pg = st.pages.find((p) => p.id === args.page);
          if (!pg) return ctx.success(`No page ${args.page}.`, { applied: false });
          studio.setState({ ...st, selectedPageId: args.page });
          return ctx.success(`Now showing ${pg.name} (page id ${args.page}).`, { applied: true, page: args.page, name: pg.name, widgets: Object.keys(pg.widgets || {}).length });
        },
      }),
      api.defineAiTool({
        name: "check_paypal_ledger",
        description: "Compare the captures recorded from PayPal webhooks with PayPal's own Transaction Search for the last 30 days.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => ctx.success("Checked.", await get("/api/paypal-check", ctx.signal)),
      }),
    ];
    const submit = api.defineAiTool({
      name: "submit_budget_recommendation",
      description: "Submit budget changes. Accepted only if every number and evidence id is in the reconciliation; otherwise the problems come back for one repair. Accepted changes wait for the owner's approval.",
      params: (s) => s.object({
        headline: s.string({ description: "One sentence quoting only tool numbers." }),
        actions: s.array(s.object({ ad: s.string(), change: s.enum(["pause", "reduce", "increase", "keep", "fix_tracking"]), reason: s.string(), evidence: s.array(s.string()) })),
        caveats: s.string(),
      }),
      execute: async (args, ctx) => {
        const d = await post("/api/agent/check", { csv: getCsv(), recommendation: args }, ctx.signal);
        if (!d.grounded) return ctx.success(`Rejected by the evidence gate. Fix these and submit again: ${d.problems.join(" ")}`, { grounded: false, problems: d.problems });
        onRecommendation?.({ recommendation: d.recommendation, grounded: true, source: "AG Studio budget agent", rec_id: d.rec_id, saved: d.saved, mine: true });
        return ctx.success("Accepted by the evidence gate. It now waits for the owner's approval in the approvals column.", { grounded: true });
      },
    });
    return createAiHarness(api, ({ builtIn, tools }) => ({
      agents: [
        ...Object.values(builtIn).map((def) => directLlmRunner({
          ...def, adapter,
          ...(def.id === "lead" ? {
            instructions: (...a) => `${typeof def.instructions === "function" ? def.instructions(...a) : def.instructions || ""}\n\n${EXTRA}`,
            // keep Studio's own tools, but let the lead hand work to the budget agent as well as to Studio's agents
            tools: (...a) => [...(typeof def.tools === "function" ? def.tools(...a) : def.tools || []).filter((t) => t.name !== "delegate_to"),
              tools.delegateTo(["data", "page", "planning", "widget", "budget", "nudge"]), ...custom],
          } : {}),
        })),
        directLlmRunner({
          id: "budget", name: "Budget agent", adapter, maxTurns: 14,
          description: "Reviews PayPal-confirmed results per ad and proposes budget changes; every number is checked in code. Asks the page agent to put the evidence on the dashboard.",
          instructions: () => BUDGET,
          tools: () => [custom[0], submit, tools.delegateTo(["page"])],
        }),
        directLlmRunner({
          id: "nudge", name: "Nudge agent", adapter, maxTurns: 10,
          description: "Proposes kind PayPal reminders for invoices that were sent and not paid, as a card in the chat; the owner's Send runs the chase agent (PayPal's Agent Toolkit). Shows who still owes.",
          instructions: () => NUDGE,
          tools: () => [custom.find((t) => t.name === "who_still_owes"), custom.find((t) => t.name === "propose_nudges"), tools.delegateTo(["page"])],
        }),
      ],
      primary: "lead",
      promptStarters: PROMPT_STARTERS,
      history: seededHistory(),
    }));
  };
}
