# Paid Signal

**Teach your ads what a paid customer looks like.**

Ad platforms optimise for what they can see: clicks, leads, chat taps. For a small business that gets paid through
PayPal, the thing that matters, a payment, never reaches the ad platform. So budgets drift toward ads that produce
leads nobody pays for.

Paid Signal closes that loop on the PayPal developer platform:

1. **Click → order.** The ad click (`fbclid` / `gclid`, ad key, click time) is written into the PayPal order's
   `custom_id` (or an invoice's private memo).
2. **Order → money.** PayPal captures the payment. A **signature-verified webhook** (`PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.REFUNDED`, `INVOICING.INVOICE.PAID`) records it, attributed to the ad.
3. **Money → decision.** An AG Studio dashboard puts what each ad *claims* (leads) next to what PayPal *confirms*
   (payers, net revenue). A Claude budget agent proposes changes; every number it writes is checked in code against
   the reconciliation. Inside AG Studio, Claude can draft PayPal invoices for warm leads; sending one, refunding and
   approving are clicks a person makes.
4. **Decision → ad platform.** Confirmed payments are prepared as Meta Conversions API `Purchase` events (deduplicated
   by `event_id = paypal:<capture>`) and Google Ads offline conversion rows; refunds become retractions. The demo shows
   and downloads these payloads; it does not send them.

Live demo (PayPal sandbox): **https://paid-signal.thelongmarketing.workers.dev**

## Try it in three minutes

1. Open the demo. The dashboard reconciles a demo ad export (fictional shop, labelled) against **real PayPal sandbox
   captures**.
2. In **Ad links**, open an ad link. The shop page keeps the click id. Pay with the PayPal sandbox buyer (login in the
   Devpost testing notes). Back on the dashboard, the capture appears under the ad it came from.
3. Press **Ask the agent**: Claude reads the reconciliation and captures and proposes changes, each with evidence ids
   and an Approve / Dismiss.
4. Press **Open the Studio assistant** and choose **Invoice warm leads**. Claude, running inside AG Studio's agent
   framework, lists leads who never paid and drafts PayPal invoices for those who showed intent. Send one from
   **PayPal invoices**; when it is paid, the payment is attributed to the lead's ad.
5. Refund a capture in **Captures & refunds**: the ad's numbers drop and its Google row becomes a retraction.

## PayPal developer platform used

| API | Where |
| --- | --- |
| Orders v2: create (with `custom_id`, `invoice_id`, `PayPal-Request-Id` idempotency), capture | `src/paypal.js`, `/api/checkout`, `/api/capture` |
| Payments v2: refund a capture | `/api/refund` |
| Invoicing v2: create draft (click in the private memo), send, get | `/api/invoices/*`, agent tool `draft_paypal_invoices` |
| Webhooks: registered by `scripts/register-webhook.py`, **verify-webhook-signature** for every delivery | `/api/webhook` |
| Reporting: Transaction Search, to cross-check the webhook ledger | `/api/paypal-check`, agent tool `check_paypal_ledger` |
| JavaScript SDK buttons, plus a full-page approval fallback | `public/shop.html` |

## AI

- **Budget agent** (`src/agent.js`): Claude with tool use (`read_reconciliation`, `read_captures`,
  `submit_recommendation`). A code gate rejects any number that is not in the reconciliation and any evidence id that
  does not exist, allows one repair, then flags. Tested in `test/agent.test.js`. (The Studio assistant below has no
  such gate; its tools return computed numbers and it is instructed to quote them.)
- **Studio assistant** (`web/src/claudeAdapter.js`, `web/src/agentTools.js`): AG Studio's Studio Agent Framework with
  a custom `AgLlmAdapter` for Claude (the Anthropic key stays in the Worker proxy). Studio's five built-in agents run on
  Claude; the lead agent gains four Paid Signal tools: `read_paid_signal`, `list_unpaid_leads`,
  `draft_paypal_invoices`, `check_paypal_ledger`.

## AG Studio

`web/` is a React app on AG Studio: data sources for ads and PayPal captures joined on the ad key, calculated measures
(cost per payer, paid revenue per ad dollar), a themed report, and a custom widget, **Claimed vs confirmed**
(`web/src/ClaimWidget.jsx`), that reads through Studio's widget API so page filters and cross-filters apply to it.

## Architecture

```
Cloudflare Worker (src/worker.js)
  ├─ PayPal REST: orders, captures, refunds, invoicing, webhooks, transaction search   (src/paypal.js)
  ├─ ledger in Workers KV: captures (payer email kept only as a SHA-256 hash), invoices
  ├─ reconciliation + Meta/Google payloads, in cents                                    (src/ledger.js)
  ├─ budget agent with evidence gate                                                    (src/agent.js)
  └─ Claude proxy for the Studio assistant                                              (/api/ai/turn)
public/  built React + AG Studio app, demo shop, demo data
web/     app source (Vite)
```

## Run it yourself

```bash
cp .dev.vars.example .dev.vars        # PayPal sandbox client id/secret, Anthropic key, webhook id
npm test                              # ledger, attribution and agent-gate tests
cd web && npm install && npm run build
npx wrangler dev                      # or: npx wrangler deploy
```

## Honest limits

- The ad export and the leads are **demo data for a fictional shop**; the PayPal captures, refunds and invoices are
  real **sandbox** transactions. No live ad account was used and no Conversions API event is sent: the payloads are
  previews to download.
- This is a public sandbox demo: refunds, invoice drafts and assistant turns are open to visitors and limited per
  visitor and per day. The AG Studio trial key is a front-end key and is served to the browser.
- Matching relies on the click id reaching checkout. Payments without one are shown as unmatched rather than guessed.
- Small numbers are weak evidence; the agent is told to say so, and does.
- Transaction Search can lag new transactions by up to three hours.

Built by Trần Thế Long, a performance marketer, with Claude Code. MIT licensed.
