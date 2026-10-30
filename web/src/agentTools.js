// Paid Signal tools for AG Studio's lead agent. Read tools return numbers computed by the Worker; the one write tool
// only creates PayPal DRAFT invoices, which a person must send from the approvals inbox.
import { claudeAdapter } from "./claudeAdapter.js";
import { createAiHarness, directLlmRunner } from "ag-studio";

const get = async (path, signal) => { const r = await fetch(path, { signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };
const post = async (path, body, signal) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };

export const PROMPT_STARTERS = [
  { label: "Which ads bring paid orders?", prompt: "Using the Paid Signal tools, which ads bring paying customers and which only bring leads? Quote the numbers exactly." },
  { label: "Invoice warm leads", prompt: "List the leads that never paid, and draft PayPal invoices for the ones who asked about booking or price. Explain who you left out and why." },
  { label: "Review ad budgets", prompt: "Ask the budget agent which ads to cut or grow, and have it show the evidence on this page." },
  { label: "Chart paid revenue by ad", prompt: "Add a bar chart of paid revenue by ad to this page." },
  { label: "Check against PayPal", prompt: "Check the webhook ledger against PayPal's own transaction history and tell me if anything is missing." },
];

const EXTRA = `You also act for a small shop that sells through PayPal. Ad platforms report leads; PayPal confirms who paid.
Use read_paid_signal for per-ad spend, leads, paid orders and revenue (computed in code; quote numbers exactly, never invent or forecast).
Use list_unpaid_leads to see leads with no PayPal payment. draft_paypal_invoices creates PayPal DRAFT invoices tagged with each lead's ad click;
nothing is sent: the shop owner reviews and sends them from the approvals inbox. Draft only for leads who showed buying intent, and say why.
check_paypal_ledger compares the webhook ledger with PayPal's Transaction Search.
For budget questions (which ads to cut, keep or grow), delegate to the budget agent; it checks its numbers in code.`;

// A custom Studio agent. It proposes budget changes through the Worker's evidence gate (the same check the
// standalone budget agent passes), then hands work to Studio's page agent to put the evidence on the dashboard.
const BUDGET = `You are the Paid Signal budget agent for a small shop that sells through PayPal.
1. Call read_paid_signal. Quote numbers exactly as given; never compute, forecast or round. Write plain words, not field names.
2. Call submit_budget_recommendation once with 1 to 3 actions. Evidence is "row:<ad key>" for an ad's row. Say when a sample is under 3 paid orders, and when an ad has a possible duplicate held out of its paid orders (if it is a real second purchase, its paid count is one higher).
   If it comes back rejected, fix exactly the listed problems and submit again (one repair).
3. Once accepted, delegate to the page agent: ask it to add one bar chart that shows the evidence behind your main action
   (for example paid revenue against spend by ad), using the fields already on the page.
4. Finish with a two-sentence summary. Keep every step short: one read, one submit, one delegation. You never change budgets yourself: the owner approves in the approvals column.`;

export function buildAi({ getCsv, onInvoices, onRecommendation }) {
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
            ads: r.ads.map((a) => ({ ad: a.ad, spend_usd: $(a.spend_cents), leads: a.leads, paid_orders: a.paid, fully_refunded: a.refunded, paid_revenue_usd: $(a.revenue_cents), cost_per_paid_order_usd: a.cost_per_paid_cents == null ? "none paid" : $(a.cost_per_paid_cents) })),
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
        description: "Create PayPal DRAFT invoices for the named leads (exact names from list_unpaid_leads), each tagged with the lead's ad click so a payment is attributed to that ad. Drafts are not sent.",
        params: (s) => s.object({ leads: s.array(s.string({ description: "Exact lead name." })), reason: s.string({ description: "Why these leads, in one sentence." }) }),
        execute: async (args, ctx) => {
          const d = await post("/api/invoices/draft", { leads: args.leads }, ctx.signal);
          onInvoices?.();
          return ctx.success(`Drafted ${d.invoices.length} PayPal invoice(s); the owner must send them from the approvals inbox.`, { invoices: d.invoices.map((i) => ({ id: i.id, lead: i.lead, ad: i.ad, status: i.status })) });
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
        onRecommendation?.({ recommendation: d.recommendation, grounded: true, source: "AG Studio budget agent" });
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
              tools.delegateTo(["data", "page", "planning", "widget", "budget"]), ...custom],
          } : {}),
        })),
        directLlmRunner({
          id: "budget", name: "Budget agent", adapter, maxTurns: 14,
          description: "Reviews PayPal-confirmed results per ad and proposes budget changes; every number is checked in code. Asks the page agent to put the evidence on the dashboard.",
          instructions: () => BUDGET,
          tools: () => [custom[0], submit, tools.delegateTo(["page"])],
        }),
      ],
      primary: "lead",
      promptStarters: PROMPT_STARTERS,
    }));
  };
}
