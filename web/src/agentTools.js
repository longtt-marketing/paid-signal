// Paid Signal tools for AG Studio's lead agent. Read tools return numbers computed by the Worker; the one write tool
// only creates PayPal DRAFT invoices, which a person must send from the approvals inbox.
import { claudeAdapter } from "./claudeAdapter.js";
import { createAiHarness, directLlmRunner } from "ag-studio";

const get = async (path, signal) => { const r = await fetch(path, { signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };
const post = async (path, body, signal) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }); const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };

export const PROMPT_STARTERS = [
  { label: "Which ads bring payers?", prompt: "Using the Paid Signal tools, which ads bring paying customers and which only bring leads? Quote the numbers exactly." },
  { label: "Invoice warm leads", prompt: "List the leads that never paid, and draft PayPal invoices for the ones who asked about booking or price. Explain who you left out and why." },
  { label: "Chart paid revenue by ad", prompt: "Add a bar chart of paid revenue by ad to this page." },
  { label: "Check against PayPal", prompt: "Check the webhook ledger against PayPal's own transaction history and tell me if anything is missing." },
];

const EXTRA = `You also act for a small shop that sells through PayPal. Ad platforms report leads; PayPal confirms who paid.
Use read_paid_signal for per-ad spend, leads, payers and revenue (computed in code; quote numbers exactly, never invent or forecast).
Use list_unpaid_leads to see leads with no PayPal payment. draft_paypal_invoices creates PayPal DRAFT invoices tagged with each lead's ad click;
nothing is sent: the shop owner reviews and sends them from the approvals inbox. Draft only for leads who showed buying intent, and say why.
check_paypal_ledger compares the webhook ledger with PayPal's Transaction Search.`;

export function buildAi({ getCsv, onInvoices }) {
  const adapter = claudeAdapter({ model: "claude-sonnet-5-5" });
  return ({ api }) => {
    const custom = [
      api.defineAiTool({
        name: "read_paid_signal",
        description: "Per-ad spend, ad-reported leads, PayPal payers, refunds, net paid revenue and cost per payer, plus totals. Computed in code from the ad export and PayPal captures.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const d = await post("/api/reconcile", { csv: getCsv() }, ctx.signal);
          const r = d.reconciliation, $ = (c) => (c / 100).toFixed(2);
          return ctx.success("Reconciliation loaded.", {
            totals: { leads: r.totals.leads, payers: r.totals.paid, refunded: r.totals.refunded, spend_usd: $(r.totals.spend_cents), paid_revenue_usd: $(r.totals.revenue_cents), spend_on_ads_without_payers_usd: $(r.totals.spend_without_paid_cents) },
            ads: r.ads.map((a) => ({ ad: a.ad, spend_usd: $(a.spend_cents), leads: a.leads, payers: a.paid, refunded: a.refunded, paid_revenue_usd: $(a.revenue_cents), cost_per_payer_usd: a.cost_per_paid_cents == null ? "none paid" : $(a.cost_per_paid_cents) })),
          });
        },
      }),
      api.defineAiTool({
        name: "list_unpaid_leads",
        description: "Leads from the ad platform who have not paid through PayPal yet, with the ad they came from, what they asked about, and any invoice already drafted.",
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const [{ leads }, { invoices }] = await Promise.all([get("/api/leads", ctx.signal), get("/api/invoices", ctx.signal)]);
          return ctx.success(`${leads.length} leads.`, { leads: leads.map((l) => ({ lead: l.lead, ad: l.ad, asked_for: l.asked_for, invoice: invoices.find((i) => i.lead === l.lead)?.status || null })) });
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
    return createAiHarness(api, ({ builtIn }) => ({
      agents: Object.values(builtIn).map((def) => directLlmRunner({
        ...def, adapter,
        ...(def.id === "lead" ? {
          instructions: (...a) => `${typeof def.instructions === "function" ? def.instructions(...a) : def.instructions || ""}\n\n${EXTRA}`,
          tools: (...a) => [...(typeof def.tools === "function" ? def.tools(...a) : def.tools || []), ...custom],
        } : {}),
      })),
      primary: "lead",
      promptStarters: PROMPT_STARTERS,
      models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }, { id: "claude-opus-5-5", label: "Claude Opus 5.5" }],
    }));
  };
}
