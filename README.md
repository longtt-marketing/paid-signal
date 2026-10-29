# Paid Signal

[![CI](https://github.com/longtt-marketing/paid-signal/actions/workflows/ci.yml/badge.svg)](https://github.com/longtt-marketing/paid-signal/actions/workflows/ci.yml) [![Live demo check](https://github.com/longtt-marketing/paid-signal/actions/workflows/live-demo.yml/badge.svg)](https://github.com/longtt-marketing/paid-signal/actions/workflows/live-demo.yml)

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
   (paid orders, net revenue). A Claude budget agent proposes changes; every number it writes is checked in code against
   the reconciliation. Inside AG Studio, Claude can draft PayPal invoices for warm leads; sending one, refunding and
   approving are clicks a person makes.
4. **Decision → ad platform.** Confirmed payments are prepared as Meta Conversions API `Purchase` events (deduplicated
   by `event_id = paypal:<capture>`) and Google Ads offline conversion rows; refunds become retractions. The demo shows
   and downloads these payloads; it does not send them.

Live demo (PayPal sandbox): **https://paid-signal.thelongmarketing.workers.dev** · Test scenarios: https://paid-signal.thelongmarketing.workers.dev/scenarios.html (nine cases: duplicates, partial refunds, payments with no click, late payments; marked live in the sandbox or automated test)

## Judge it in 60 seconds

No login is needed for any of this; only paying in the demo shop needs the sandbox buyer from the testing notes.

1. Open the [dashboard](https://paid-signal.thelongmarketing.workers.dev): 62 leads claimed by the ads, the paid orders PayPal confirms, per ad.
2. Open the Studio assistant and choose **Review ad budgets**: the Budget agent (a custom Studio agent on Claude) passes the evidence gate, its change lands in the approvals column, and it asks Studio's page agent to add the evidence chart.
3. Open [Test scenarios](https://paid-signal.thelongmarketing.workers.dev/scenarios.html): nine cases and the measured proof (499 of 500 planted errors caught, 10 of 10 live agent runs grounded first time).

## Try it in three minutes

1. Open the demo. The dashboard reconciles a demo ad export (fictional shop, labelled) against **real PayPal sandbox
   captures**.
2. In **Ad links**, open an ad link. The shop page keeps the click id. Pay with the PayPal sandbox buyer (login in the
   Devpost testing notes). Back on the dashboard, the capture appears under the ad it came from.
3. Press **Ask the agent**: Claude reads the reconciliation and captures and proposes changes, each with evidence ids
   and an Approve / Dismiss.
4. Press **Open the Studio assistant** and choose **Invoice warm leads**. Claude, running inside AG Studio's agent
   framework, lists leads who never paid and drafts PayPal invoices for those who showed intent. Send one from
   **Invoices**; when it is paid, the payment is attributed to the lead's ad.
5. Refund a capture under **Payments** (a smaller amount makes it partial): the ad's numbers drop, and its Google row becomes a retraction or a restatement.

API checks without the UI: import [`postman/paid-signal.postman_collection.json`](postman/paid-signal.postman_collection.json) into Postman (read-only requests, 15 tests). To add Paid Signal to a real shop: [docs/INTEGRATE.md](docs/INTEGRATE.md).

## PayPal developer platform used

| API | Where |
| --- | --- |
| Orders v2: create (with `custom_id`, `invoice_id`, `PayPal-Request-Id` idempotency), capture | `src/paypal.js`, `/api/checkout`, `/api/capture` |
| Payments v2: refund a capture | `/api/refund` |
| Invoicing v2: create draft (click in the private memo), send, get; sent invoices are re-checked with PayPal on Refresh, because the sandbox does not always emit `INVOICING.INVOICE.PAID` | `/api/invoices/*`, agent tool `draft_paypal_invoices` |
| Webhooks: registered by `scripts/register-webhook.py`, **verify-webhook-signature** for every delivery | `/api/webhook` |
| Reporting: Transaction Search, to cross-check the webhook ledger against PayPal's own history (payments only) | `/api/paypal-check`, agent tool `check_paypal_ledger` |
| JavaScript SDK buttons, plus a full-page approval fallback | `public/shop.html` |

## AI

- **Budget agent** (`src/agent.js`): Claude with tool use (`read_reconciliation`, `read_captures`,
  `submit_recommendation`). A code gate rejects any number that is not in the reconciliation and any evidence id that
  does not exist, allows one repair, then flags. Tested in `test/agent.test.js`; measured in [`docs/proof`](docs/proof)
  (`scripts/eval-gate.mjs`, `scripts/eval-agent.mjs`).
- **Budget agent inside AG Studio** (`web/src/agentTools.js`): a custom Studio agent. Studio's lead agent delegates budget
  questions to it; it reads the ledger, submits through the same gate (`/api/agent/check`), and delegates to Studio's
  built-in page agent to add the evidence chart. Its accepted change lands in the approvals column.
- **Studio assistant** (`web/src/claudeAdapter.js`, `web/src/agentTools.js`): AG Studio's Studio Agent Framework with
  a custom `AgLlmAdapter` for Claude (the Anthropic key stays in the Worker proxy). Studio's five built-in agents run on
  Claude; the lead agent gains four Paid Signal tools: `read_paid_signal`, `list_unpaid_leads`,
  `draft_paypal_invoices`, `check_paypal_ledger`. The lead's own free text is not gated; its tools return numbers
  computed in code.

## AG Studio

`web/` is a React app on AG Studio: data sources for ads and PayPal captures joined on the ad key, calculated measures
(cost per paid order, paid revenue per ad dollar), a themed report, and two custom widgets, **Claimed vs confirmed**
(`web/src/ClaimWidget.jsx`) and a **payment timeline** (`web/src/TimelineWidget.jsx`: paid, partly refunded and refunded
payments per ad), that read through Studio's widget API so page filters and cross-filters apply to them.

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
- Matching relies on the click id reaching checkout. PayPal verifies the payment, not the click. Payments without one are shown as unmatched rather than guessed.
- The evidence gate checks that numbers and ids exist, not that the reasoning is right. Approvals are logged on the server but, in this public demo, not tied to an owner login.
- Small numbers are weak evidence; the agent is told to say so, and does.
- Transaction Search reports how current it is (the sandbox refreshes about daily); payments newer than that are listed as pending, not missing.

Built by Trần Thế Long, a performance marketer, with Claude Code. MIT licensed.
