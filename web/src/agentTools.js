// Paid Signal tools for AG Studio's lead agent. Read tools return numbers computed by the Worker; the one write tool
// only creates PayPal DRAFT invoices. A person approves each one in Approvals; only then does the send agent send it.
import { claudeAdapter } from "./claudeAdapter.js";
import { createAiHarness, directLlmRunner } from "ag-studio";
import { adName } from "./names.js";

const get = async (path, signal) => { const r = await fetch(path, { signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };
const post = async (path, body, signal) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };

export const PROMPT_STARTERS = [
  { label: "Which ads bring paid orders?", prompt: "Using the Paid Signal tools, which ads bring paying customers and which only bring leads? Quote the numbers exactly." },
  { label: "Invoice warm leads", prompt: "Have the revenue agent read what the unpaid leads wrote and draft PayPal invoices for the ones ready to pay. Tell me who it invoiced, for how much, and who it skipped or flagged and why." },
  { label: "Review ad budgets", prompt: "Ask the budget agent which ads to cut or grow, and have it show the evidence on this page." },
  { label: "Chart paid revenue by ad", prompt: "Add a bar chart of paid revenue by ad to this page." },
  { label: "Nudge who still owes", prompt: "Ask the nudge agent to remind, kindly, the people who still owe us for a sent invoice, and show who still owes on the Who still owes page." },
  { label: "Check against PayPal", prompt: "Check the webhook ledger against PayPal's own transaction history and tell me if anything is missing." },
];

const EXTRA = `You also act for a small shop that sells through PayPal. Ad platforms report leads; PayPal confirms who paid.
Use read_paid_signal for per-ad spend, leads, paid orders and revenue (computed in code; quote numbers exactly, never invent or forecast).
Use list_unpaid_leads to see leads with no PayPal payment. draft_paypal_invoices creates PayPal DRAFT invoices tagged with each lead's ad click;
nothing is sent here: each draft waits in Approvals, and only after the shop owner approves it does the send agent send it. Draft only for leads who showed buying intent, and say why.
check_paypal_ledger compares the webhook ledger with PayPal's Transaction Search.
For budget questions (which ads to cut, keep or grow), delegate to the budget agent; it checks its numbers in code.
For invoices that were sent and not paid, delegate to the nudge agent: it sends friendly PayPal reminders within code limits.`;

// AG Grid's nudge-bot idea, built on the chase agent: who still owes, and kind reminders sent through PayPal's Agent Toolkit.
const NUDGE = `You are the Paid Signal nudge agent. You help a small shop get paid for invoices it already sent, kindly: a heads-up, never a demand.
1. Call who_still_owes. Quote names and amounts exactly as given.
2. If anyone is waiting, call send_friendly_nudges once. The chase agent reads each invoice from PayPal, decides who a reminder would help and writes it; code allows only unpaid invoices, at most three a run, and no invented amount or discount.
3. Ask the page agent to show the "Who still owes" page.
4. Finish with two or three friendly sentences: who was nudged, who was skipped and why, and how much is still out. You never send anything yourself.`;

// A custom Studio agent. It proposes budget changes through the Worker's evidence gate (the same check the
// standalone budget agent passes), then hands work to Studio's page agent to put the evidence on the dashboard.
const BUDGET = `You are the Paid Signal budget agent for a small shop that sells through PayPal.
1. Call read_paid_signal. Quote numbers exactly as given; never compute, forecast or round. Write plain words, not field names.
   In anything a person reads (headline, reasons, chat), call an ad by its name (for example "Holiday camp · static"), never its key, and write money as $118.40.
   Paid revenue is already net of refunds: a refunded payment is taken out before you see it. Never suggest refunds may not be netted out.
   Call it "paid revenue minus ad spend"; do not use the word "profit" (product cost is unknown). Write money with a dollar sign ($118.40; a shortfall as "$41.50 below ad spend").
2. Call submit_budget_recommendation once with 1 to 3 actions. Evidence is "row:<ad key>" for an ad's row. An ad with fewer than 3 paid orders gets "keep" (or "fix_tracking"), never pause, reduce or increase; say it needs more paid orders. Say when an ad has a possible duplicate held out of its paid orders (if it is a real second purchase, its paid count is one higher).
   If it comes back rejected, fix exactly the listed problems and submit again (one repair).
3. Once accepted, delegate to the page agent: ask it to add one bar chart that shows the evidence behind your main action
   (for example paid revenue against spend by ad), using the fields already on the page.
4. Finish with a two-sentence summary. Keep every step short: one read, one submit, one delegation. You never change budgets yourself: the owner approves in the approvals column.`;

export function buildAi({ getCsv, onInvoices, onRecommendation, onNudge }) {
  const adapter = claudeAdapter({ model: "claude-sonnet-5-5" });
  return ({ api }) => {
    const custom = [
      api.defineAiTool({
        name: "read_paid_signal",
        description: "Per-ad spend, ad-reported leads, PayPal paid orders, refunds, net paid revenue and cost per paid order, plus totals. Computed in code from the ad export and PayPal captures.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const [d, l] = await Promise.all([post("/api/reconcile", { csv: getCsv() }, ctx.signal), get("/api/ledger", ctx.signal)]);
          const r = d.reconciliation, $ = (c) => (c / 100).toFixed(2);
          return ctx.success("Reconciliation loaded.", {
            totals: { leads: r.totals.leads, paid_orders: r.totals.paid, fully_refunded: r.totals.refunded, spend_usd: $(r.totals.spend_cents), paid_revenue_usd: $(r.totals.revenue_cents), spend_on_ads_with_no_paid_order_usd: $(r.totals.spend_without_paid_cents) },
            ads: r.ads.map((a) => ({ ad: a.ad, name: adName(a.ad), spend_usd: $(a.spend_cents), leads: a.leads, paid_orders: a.paid, fully_refunded: a.refunded, paid_revenue_usd: $(a.revenue_cents), cost_per_paid_order_usd: a.cost_per_paid_cents == null ? "none paid" : $(a.cost_per_paid_cents) })),
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
        name: "who_still_owes",
        description: "Invoices the shop sent: who, how much, paid or not, days waiting, and the last reminder sent. Read only.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const { invoices } = await get("/api/invoices", ctx.signal);
          const sent = invoices.filter((i) => ["SENT", "UNPAID", "PARTIALLY_PAID", "PAID"].includes(i.status));
          const days = (i) => (i.sent_at ? Math.floor((Date.now() - Date.parse(i.sent_at)) / 86400000) : 0);
          return ctx.success(`${sent.filter((i) => i.status !== "PAID").length} sent invoice(s) still unpaid.`, {
            invoices: sent.map((i) => ({ who: i.lead, amount_usd: i.amount, status: i.status === "PAID" ? "paid" : "waiting", days_waiting: i.status === "PAID" ? 0 : days(i), last_reminder: i.reminded_at ? i.reminder?.note || "sent" : null })) });
        },
      }),
      api.defineAiTool({
        name: "send_friendly_nudges",
        description: "Run the chase agent: it reads each sent, unpaid invoice from PayPal through the Agent Toolkit, picks who a reminder would help, writes it, and sends it with send_invoice_reminder. Code limits it to unpaid invoices, three a run, no invented amount or discount.",
        params: (s) => s.object({ reason: s.string({ description: "Why nudge now, in one sentence." }) }),
        execute: async (_args, ctx) => {
          const d = await post("/api/agent/chase", {}, ctx.signal);
          onNudge?.(d);
          return ctx.success(`${d.reminded.length} reminder(s) sent.`, { reminded: d.reminded.map((r) => ({ invoice: r.id, note: r.note })), chase_agent_summary: d.summary, waiting_before: d.eligible });
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
        onRecommendation?.({ recommendation: d.recommendation, grounded: true, source: "AG Studio budget agent", rec_id: d.rec_id });
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
          description: "Sends kind PayPal reminders for invoices that were sent and not paid, through the chase agent and PayPal's Agent Toolkit, and shows who still owes.",
          instructions: () => NUDGE,
          tools: () => [custom.find((t) => t.name === "who_still_owes"), custom.find((t) => t.name === "send_friendly_nudges"), tools.delegateTo(["page"])],
        }),
      ],
      primary: "lead",
      promptStarters: PROMPT_STARTERS,
    }));
  };
}
