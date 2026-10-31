# Paid Signal

[![CI](https://github.com/longtt-marketing/paid-signal/actions/workflows/ci.yml/badge.svg)](https://github.com/longtt-marketing/paid-signal/actions/workflows/ci.yml) [![Live demo check](https://github.com/longtt-marketing/paid-signal/actions/workflows/live-demo.yml/badge.svg)](https://github.com/longtt-marketing/paid-signal/actions/workflows/live-demo.yml)

**Tell your ads who actually paid.**

Live demo (no login): https://paid-signal.thelongmarketing.workers.dev · [Money trail](https://paid-signal.thelongmarketing.workers.dev/trail) (one payment from ad click to PayPal to Meta) · Video (2:37): https://www.youtube.com/watch?v=NIo5Dtqikzo · Every measured number: [/proof](https://paid-signal.thelongmarketing.workers.dev/proof)

Ad platforms optimise for what they can see: clicks, leads, chat taps. For a small business that gets paid through
PayPal, the thing that matters, a payment, never reaches the ad platform. So budgets drift toward ads that produce
leads nobody pays for.

> "Ads Manager says a campaign brought plenty of enquiries, but only my payment history shows who actually paid, and the
> two never line up." (a friend who runs an online shop and buys their own ads; paraphrased, shared with permission)

Paid Signal closes that loop on the PayPal developer platform:

1. **Click → order.** The ad click (`fbclid` / `gclid`, ad key, click time) is written into the PayPal order's
   `custom_id` (for an invoice, the lead's click is kept with the invoice in the ledger).
2. **Order → money.** PayPal captures the payment. A **signature-verified webhook** (`PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.REFUNDED`, `INVOICING.INVOICE.PAID`) records it, attributed to the ad.
3. **Money → decision.** An AG Studio dashboard puts what each ad *claims* (leads) next to what PayPal *confirms*
   (paid orders, net revenue). A Claude budget agent proposes changes; every number it writes is checked in code against
   the reconciliation. Inside AG Studio, Claude can draft PayPal invoices for warm leads. A person approves a draft;
   then a send agent (Claude with **PayPal's Agent Toolkit**) reads that invoice from PayPal, checks it and sends it.
   Code pins the agent to the approved invoice and refuses a send unless that invoice is still a draft for the approved amount in USD.
   For sent invoices still unpaid, a chase agent (Claude with the Agent Toolkit) reads each, chooses whom to remind and writes
   the note; `send_invoice_reminder` sends it, within code limits. Budget changes and refunds stay clicks a person makes.
4. **Decision → ad platform.** Confirmed payments are prepared as Meta Conversions API `Purchase` events (deduplicated
   by `event_id = paypal:<capture>`) and Google Ads offline conversion rows. A refund becomes a Google retraction or restatement; a Meta event not yet sent is held back, and one already sent stays (Meta's Conversions API has no retraction), so the refund is taken off here;
   a possible duplicate payment is held back from both, and is not counted as a paid order, until it is refunded.
   Meta gets the paid orders that came from a Meta click (fbclid) or from a chat lead's invoice; a buyer who came from a
   Google click (gclid) goes to Google only, so Meta cannot take credit for it. The demo shows
   and downloads these payloads. The Purchase events were also sent to a real Meta dataset as **test events**: Meta's
   Test Events tab shows them processed and a resent copy deduplicated by `event_id`
   ([`scripts/meta-test-event.mjs`](scripts/meta-test-event.mjs), [screenshot](docs/proof/meta-test-events.png)).

Live demo (PayPal sandbox): **https://paid-signal.thelongmarketing.workers.dev** · Test scenarios: https://paid-signal.thelongmarketing.workers.dev/scenarios.html (nine cases: duplicates, partial refunds, payments with no click, late payments; marked live in the sandbox or automated test)

## Judge it in 60 seconds

No login is needed for any of this; only paying in the demo shop needs the sandbox buyer from the testing notes.

1. Open the [dashboard](https://paid-signal.thelongmarketing.workers.dev): the ads report 62 leads, PayPal confirms 6 paid orders; the flow chart follows each ad from the ad report, through PayPal, back to Meta.
2. Press **Ask the revenue agent**: Claude reads what each unpaid lead wrote and drafts PayPal invoices (Agent Toolkit) for the ones ready to pay; code sets every price; a lead whose message tries to rewrite the price and recipient is flagged, never invoiced.
3. Under **Invoices**, press **Approve** on a draft: the send agent (Claude + PayPal Agent Toolkit) re-reads it in code and sends it. **Chase unpaid** lets the chase agent decide which sent invoices get a reminder and write it.
4. **Report · AG Studio** tab: open the assistant, choose **Review ad budgets**; a custom Studio agent on Claude submits through the evidence gate and its change lands in Approvals.
5. [Proof](https://paid-signal.thelongmarketing.workers.dev/proof): held-out evals (12 bookings, 10 not-ready leads and 8 prompt injections, each run twice: 24 of 24, 20 of 20, 0 of 16), the evidence gate under attack (11 kinds of planted error, 100 of each: all caught), a budget simulation with its uncertainty ($1,181 vs $847 paid revenue minus ad spend over 8 weeks; ahead in 1,365 of 2,000 runs), live PayPal and Meta checks.
6. Any MCP client: `https://paid-signal.thelongmarketing.workers.dev/mcp` (six read-only tools; see [MCP server](#mcp-server)).

## Try it in three minutes

1. Open the demo. The dashboard reconciles a demo ad export (fictional shop, labelled) against **real PayPal sandbox
   captures**.
2. In **Ad links**, open an ad link. The shop page keeps the click id. Pay with the PayPal sandbox buyer (login in the
   Devpost testing notes). Back on the dashboard, the capture appears under the ad it came from.
3. Press **Ask the agent**: Claude reads the reconciliation and captures and proposes changes, each with evidence ids
   and an Approve / Dismiss.
4. Press **Open the Studio assistant** and choose **Invoice warm leads**. Claude, running inside AG Studio's agent
   framework, lists leads who never paid and drafts PayPal invoices for those who showed intent. **Approve** one under
   **Invoices**; the send agent sends it through the Agent Toolkit, and when it is paid the payment is attributed to the lead's ad.
5. Refund a capture under **Payments** (a smaller amount makes it partial): the ad's numbers drop, and its Google row becomes a retraction or a restatement. The seeded demo payments only preview a refund, so the demo stays intact through judging; pay in the demo shop first to refund a payment of your own for real.

API checks without the UI: import [`postman/paid-signal.postman_collection.json`](postman/paid-signal.postman_collection.json) into Postman (read-only requests, 20 tests, including the MCP server). To add Paid Signal to a real shop: [docs/INTEGRATE.md](docs/INTEGRATE.md).

## PayPal developer platform used

| API | Where |
| --- | --- |
| **PayPal Agent Toolkit** (`@paypal/agent-toolkit`): `create_invoice` called by the revenue agent itself (code prices it and sets the recipient inside the call, then returns PayPal's draft id to the agent); `get_invoice`, `send_invoice` for the send agent, pinned to the approved invoice; `get_invoice`, `send_invoice_reminder` called by the chase agent with its own note, limited to eligible unpaid invoices | `src/revenue.js`, `src/sendAgent.js`, `src/chaseAgent.js`, `/api/agent/revenue`, `/api/invoices/approve`, `/api/agent/chase` |
| Orders v2: create, read and capture through **PayPal's server SDK** (`@paypal/paypal-server-sdk`, generated with APIMatic; reviewed with [APIMatic's PayPal Context Plugin](docs/development-with-ai.md): one safe retry, one reused client, PayPal `debug_id` on errors), with `custom_id`, `invoice_id`, `PayPal-Request-Id` idempotency | `src/paypalSdk.js`, `/api/checkout`, `/api/capture` |
| Payments v2: refund a capture (full or partial), through the server SDK | `src/paypalSdk.js`, `/api/refund` |
| Invoicing v2: create draft (the lead's click kept with the invoice in the ledger), send, get; sent invoices are re-checked with PayPal on Refresh, because the sandbox does not always emit `INVOICING.INVOICE.PAID` | `/api/invoices/*`, agent tool `draft_paypal_invoices` |
| Webhooks: registered by `scripts/register-webhook.py`, **verify-webhook-signature** for every delivery | `/api/webhook` |
| Disputes: `CUSTOMER.DISPUTE.*` webhooks, plus the Agent Toolkit's `list_disputes` and `get_dispute` on every PayPal check and every night. An open dispute takes the payment out of paid orders and out of what Meta and Google are told; a dispute the buyer wins counts as refunded (Google gets a retraction) | `src/ledger.js` (`disputeState`), `/api/webhook`, `/api/paypal-check` |
| Reporting: Transaction Search, to cross-check the webhook ledger against PayPal's own history (payments only) | `/api/paypal-check`, agent tool `check_paypal_ledger` |
| JavaScript SDK buttons, plus a full-page approval fallback | `public/shop.html` |

## AI

- **Budget agent** (`src/agent.js`): Claude with tool use (`read_reconciliation`, `read_captures`,
  `submit_recommendation`). A code gate rejects any number that is not in the reconciliation and any evidence id that
  does not exist, allows one repair, then flags. Tested in `test/agent.test.js`; measured in [`docs/proof`](docs/proof)
  (`scripts/eval-gate.mjs`, `scripts/eval-agent.mjs`).
- **Small samples** (`paybackOdds` in `src/ledger.js`): with fewer than 3 paid orders no budget moves, but each ad still gets
  a number: the chance its paid revenue covers its ad spend, a 90% range for its cost per paid order, and the spend with no
  paid order that would make "below its ad spend" 90% likely (Gamma-Poisson, prior worth one order at the shop's own cost
  per paid order). The agent quotes them through the gate; the dashboard shows them as "Covers its spend?".
- **Direction of a move** (`supportedMoves` in `src/ledger.js`): on an ad with 3+ paid orders the gate refuses a raise unless
  what its paid revenue leaves after the shop's costs and PayPal's fees covers its spend and it is at or above the average of
  those ads; it refuses a cut or pause of an ad that covers its spend, and refuses keeping as it is an ad that does not. The
  shop's 30% cost of delivery is the fictional shop's stated assumption (`SHOP_COSTS`); PayPal's fee is the one PayPal
  reports on each capture (read at capture, `fee` on the record), and PayPal's published 2.99% + $0.49 only where none was
  reported (invoice payments). The owner can add a request (`instruction` on `/api/agent`, also on the live ledger from the
  dashboard); the agent weighs it, and the gate still refuses a move the payments do not support.
- **Is the rule right?** (`scripts/eval-blind-scenarios.mjs`): a separate analyst agent that never read this code wrote
  synthetic weeks with its own answers from first principles. The first set exposed two places where the rule disagreed with
  the analyst (it allowed cutting a profitable ad below the average, and keeping a money-losing one); the rule was changed,
  and a second set, written afterwards, tests the changed rule (the rule itself agrees with the analyst on 5 of 6 weeks; the
  agent on 12 of 12 runs). A third set, frozen before it was run and run once: agent 11 of 12 runs, rule 6 of 6, leads per
  dollar 1 of 6. The answers are an AI analyst's, not human ground truth. Results in `docs/proof/blind-scenarios-run-*.json`.
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
(cost per paid order, paid revenue per ad dollar), a themed report, and three custom widgets, **Claimed vs confirmed**
(`web/src/ClaimWidget.jsx`), a **payment timeline** (`web/src/TimelineWidget.jsx`: paid, partly refunded and refunded
payments per ad) and **leads, PayPal invoices and paid orders per ad** (`web/src/FunnelWidget.jsx`), that read through
Studio's widget API so page filters and cross-filters apply to them.

## MCP server

`POST /mcp` speaks the Model Context Protocol (streamable HTTP, JSON responses; `src/mcp.js`). Read-only tools:
`read_paid_signal`, `get_ad_truth`, `propose_budget` (proposes, changes nothing), `list_unpaid_leads`, `list_payments`, `check_paypal_ledger`: the same numbers the dashboard shows.
Claude used it through the Anthropic API's MCP connector: [`docs/proof/mcp-claude-run.md`](docs/proof/mcp-claude-run.md).
For Claude Desktop: `npx mcp-remote https://paid-signal.thelongmarketing.workers.dev/mcp`.

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

**Speed.** The dashboard is server-rendered at the edge with the live totals, then hydrates from a 67 KB (gzip) bundle;
AG Studio (1.5 MB gzip) is its own chunk, loaded when its section scrolls near or the assistant is opened. Measured on
the live site (Playwright, 2026-10-29): ready in 1.7 s on desktop and 2.3 s on a throttled phone (4G, 4x CPU), down
from 5 s and 18 s with one bundle.

**Security.** Every write must be JSON from this origin, with a per-visitor burst limit and daily caps; ad keys and
click ids are allow-listed; the Claude proxy serves only AG Studio's own tools; PayPal webhooks are signature-verified;
pages carry a Content Security Policy and `frame-ancestors 'none'`; server errors never return PayPal or Claude details.

## Run it yourself

```bash
cp .dev.vars.example .dev.vars        # PayPal sandbox client id/secret, Anthropic key, webhook id
npm install                           # PayPal Agent Toolkit and server SDK for the Worker
npm test                              # 110 tests: money rules, gate, the four agents, schema checks, MCP, AG Studio tool names
node scripts/e2e.mjs                  # browser run against the live demo (also daily in CI)
cd web && npm install && npm run build
npx wrangler dev                      # or: npx wrangler deploy
```

## Honest limits

- The ad export and the leads are **demo data for a fictional shop**; the PayPal captures, refunds and invoices are
  real **sandbox** transactions. No live ad account was used. Meta events went only to a test dataset with a test event code;
  Google rows are previews to download.
- This is a public sandbox demo: refunds, invoice drafts and assistant turns are open to visitors and limited per
  visitor and per day. The AG Studio trial key is a front-end key and is served to the browser.
- Matching relies on the click id reaching checkout. PayPal verifies the payment, not the click. Payments without one are shown as unmatched rather than guessed.
- The evidence gate checks that numbers and ids exist and that a budget move goes the way the payments point (after the fictional shop's stated costs and PayPal fees), not every step of the reasoning; that rule is itself a choice, tested on synthetic weeks (including an independent analyst's), not proven on a real shop. On real public ads (Bunq's, 2017, `scripts/study-public-ads.mjs`) sign-ups were a fair stand-in for customers, so the case for the paid signal there is small; it is larger where lead quality varies. Approvals are demo approvals: logged on the server but, in this public demo, not tied to an owner login.
- Small numbers are weak evidence; the agent is told to say so, and does.
- Transaction Search reports how current it is (the sandbox refreshes about daily); payments newer than that are listed as pending, not missing.

Built by Trần Thế Long, a performance marketer, with Claude Code. MIT licensed.
