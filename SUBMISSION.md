# Paid Signal: Devpost submission text

Project name: Paid Signal

Tagline (200 characters max):
A PayPal back office for small shops, run by agents in AG Grid: they invoice ready buyers, chase late payers, refund double charges and find ads that sell. Nothing goes out until the owner approves.

Built with: paypal-agent-toolkit, paypal-server-sdk, apimatic, mcp, paypal-orders-v2, paypal-invoicing, paypal-webhooks, paypal-transaction-search, paypal-js-sdk, meta-conversions-api, claude, anthropic, ag-studio, ag-grid, react, vite, cloudflare-workers, workers-kv, javascript

Try it: https://paid-signal.thelongmarketing.workers.dev · Proof: https://paid-signal.thelongmarketing.workers.dev/proof · Code: https://github.com/longtt-marketing/paid-signal

---

<!-- devpost-story -->
**A PayPal back office for small shops, run by agents in AG Grid: one invoices the buyers who are ready, one chases late payers, one refunds double charges, one finds the ads that sell. Each agent drafts its step; the owner approves, and every action is checked against PayPal.**

**Try it in 90 seconds** ([open the workspace](https://paid-signal.thelongmarketing.workers.dev/studio), no login):
1. In the chart at the top, click the Testimonial ad. The page and the PayPal ledger under it narrow to that ad, and the budget agent's suggestion waits for your Approve.
2. Open the assistant and pick **Group the ledger by ad (AI Toolkit)**, or ask in your own words. AG Grid's AI Toolkit turns the request into a grid state, and the grid groups the payments and totals the money kept.
3. Pick **Invoice warm leads**. The revenue agent drafts real PayPal sandbox invoices and puts each one in the chat as a card; nothing is sent until you press Approve.
4. Open **Agents → PayPal**: every invoice, reminder, refund and payout the agents made, with the status PayPal reports for it now.

Want to pay as a customer? The [judge path](https://paid-signal.thelongmarketing.workers.dev/judge) lets you pay a sandbox invoice the agent drafted for you, see what it changes in the ad's numbers, and undo it with a PayPal refund.

### In numbers
- **36 of 36** PayPal actions the agents took (invoices, reminders, a refund, a payout) found again in PayPal on 8 Nov, each with the status PayPal reports ([live count](https://paid-signal.thelongmarketing.workers.dev/api/agent-actions)).
- Over two runs of a held-out set of leads: **24 of 24** ready-to-buy decisions invoiced, **20 of 20** not-ready leads left alone, **0 of 16** prompt-injection attempts invoiced.
- **117 of 120** runs right when the owner asks the assistant, in plain words, to filter, sort, group or total the PayPal ledger grid: 40 hand-written requests (10 of them groups and totals through AG Grid's AI Toolkit, 6 it must not act on), each run 3 times; the check reads what the grid itself shows.
- **0** invoices or reminders sent without the owner's click: no agent tool can send one, and a test checks it.

### Why it fits each prize
- **PayPal + AI:** six AI agents do invoicing, reminders, refunds and creator payouts through the PayPal Agent Toolkit and APIs, and code checks what they hand over: the budget agent's numbers and payment ids against the PayPal ledger, invoice prices and recipients set in code.
- **Agentic commerce:** agents act on a shop's money, within limits written in code, and hand the final click to the owner.
- **AG Grid:** the agents work inside an AG Studio workspace and drive the PayPal ledger grid with AG Grid's AI Toolkit.

## Inspiration

Small shops that sell through ads live between two numbers: the leads the ad platform reports and the money that actually arrives. They rarely agree. In a real gift shop's October, with about $10,000 of ads, the ad that brought 69% of the chats brought 19% of the money. That shop takes bank transfers, so we built the same check on PayPal, where every payment is confirmed, and gave the daily money work to agents.

Agents and money are an obvious risk: an agent can quote a number that is not true, or send something it should not. So in Paid Signal the agents draft and code checks: the numbers and payment ids they quote are checked against the ledger, prices are set in code, and every action that reaches a customer or moves money waits for the owner.

## What it does

- **Invoices for buyers who are ready.** The revenue agent reads what each lead wrote, picks the ones ready to buy and drafts a PayPal invoice through the Agent Toolkit; code sets the price and the recipient. The owner approves, and the send agent reads the draft from PayPal again before it sends it.
- **Kind reminders for late payers.** The chase agent prepares reminders for unpaid invoices, at most three a run, and sends them when the owner clicks Send.
- **Refunds for double charges, payouts for creators.** The refund agent returns a double payment once the owner approves. The payout agent pays the ad's creator per PayPal-confirmed order, not per lead.
- **Ad money for the ads that sell.** Each PayPal payment is matched to the ad click behind it; refunds come off, and a possible double payment or an open dispute is put on hold. The budget agent suggests which ads to grow, keep or cut from this ledger; every number and payment id it quotes is checked in code, and an ad with fewer than 3 paid orders is never moved. On the demo shop, the free guide ad has 31 leads in the ad report and 1 paid order in PayPal.

## AG Grid and AG Studio

AG Studio is the shop's workspace, and the PayPal ledger is an AG Grid table the agents work in.

| What you see | AG Grid / AG Studio feature | Where |
|---|---|---|
| Ask for groups and totals; the grid builds them | AG Grid AI Toolkit: `getStructuredSchema()` goes to the model, and the grid state it returns is applied with `setState()` (row grouping, sums, filters) | assistant: Group the ledger by ad (AI Toolkit) |
| Ask for some payments; the grid filters, sorts and flashes them | `setFilterModel` (filters show in the column headers), `applyColumnState`, `flashCells` | assistant: Show refunded or held payments |
| Studio's own agents build a page from one request | Studio's AI framework: the lead agent hands the work to its page, widget and data agents | assistant: Replay Studio building a page |
| Invoice drafts and reminders as cards with Approve or Send | custom Studio tools with their own chat cards | assistant: Invoice warm leads, Nudge who still owes |

- A click on an ad in the chart filters the whole page through Studio's cross-filter; seven custom widgets read the same data.
- In the ledger, ▸ opens a payment's history (ad click, PayPal capture, ledger, what Meta was told), and the owner decides each payment in its Decision cell: refund it, or count it as a separate order.
- Also in the workspace: an AG Grid pivot of the real shop's 735 payments, a page Studio's agents build on request, and recorded runs replayed with no model call. How it is built: docs/AG-STUDIO.md.

## How we built it

- **PayPal:** Agent Toolkit (`create_invoice`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `create_refund`, `get_refund`, `list_disputes`, `get_dispute`), Orders v2 through the Server SDK (APIMatic), Invoicing v2, Payouts v1, Webhooks with signature checks, Transaction Search, JS SDK.
- **AI:** six agents on Claude, each with its own tools, every tool call checked against its schema; inside AG Studio they run through a custom model adapter. A read-only MCP server exposes the ledger.
- **AG Grid:** AG Studio for the workspace, AG Grid Enterprise (AI Toolkit, row grouping) on the Studio ledger, AG Grid Community and AG Charts on the dashboard.
- **Runs on** Cloudflare Workers and KV, with 204 tests in CI.

## Challenges we ran into

- **Agents that make up numbers.** The fix was to let agents draft and code decide: a check rejects any number or payment id that is not in the ledger. Against 11 kinds of planted error, 100 of each, it caught all of them, and it rejected 0 of 500 correct recommendations.
- **Matching money to ads.** A PayPal payment arrives from an order, an invoice or a webhook, sometimes twice. We match each one to its ad click, take refunds off and hold look-alike double payments until a person decides.
- **An assistant that must reach the right grid.** AG Studio can keep a hidden copy of a widget, so a request sent to one copy could go unanswered; every copy now listens and the one on screen answers. And while the ledger shows its own ad groups, its columns cannot group or filter, so the AI Toolkit's schema came back empty and the model had to guess; the grid now switches to its flat view before the schema is read. The grid evals found both.

## Accomplishments that we're proud of

- Real sandbox money, end to end: a $49 double payment refunded (COMPLETED), $15 paid to the ad's creator for 3 paid orders (SUCCESS), and every agent action found again in PayPal.
- 117 of 120 runs right when the assistant drives the ledger grid (filters, sorts, AI Toolkit groups and totals, refusals), and a browser check of both ledgers that passes 7 of 7.
- 0 accessibility violations on nine pages, phone and desktop (axe-core).

## What we learned

- Agents are most useful on the tedious part, reading messages and drafting, with the decision left to a click.
- The number that matters to a shop is the one PayPal confirms, not the one an ad platform reports.

## What's next

- A pilot with a real shop on PayPal, and budget changes that reach the ad platform after the owner approves.

## Limits

- The demo shop's ads and leads are fictional, PayPal runs in the sandbox, and Meta receives test events. The ledger holds 13 sandbox payments.
- Approve buttons are open in the demo; a real shop would put them behind its own login.
- The gift shop was paid by bank transfer, not PayPal: it is why Paid Signal exists, not a result of it.
- AG Grid Enterprise runs on a trial licence.

Methods and scripts behind every number: [/proof](https://paid-signal.thelongmarketing.workers.dev/proof).

## Testing instructions (private field)

Demo: https://paid-signal.thelongmarketing.workers.dev (no login for anything except paying).
PayPal sandbox buyer: [SANDBOX BUYER EMAIL] / [PASSWORD], for the PayPal step in the demo shop.
0. Start at /judge: the read-only path (owner request, Claude's answer, the rule in code, the PayPal capture behind it, one lead's invoice loop), no login and no AI quota. /audit runs the same ledger on your own Ads Manager and PayPal files, in the browser.
1. Press **Ask the revenue agent**: it drafts for any lead ready to pay that has no invoice yet (drafts it made earlier wait under Invoices), leaves the rest, and flags the prompt injection.
2. Under Invoices, press **Approve** on a draft: the send agent checks it and sends it. **Chase unpaid** runs the chase agent on sent invoices that are still unpaid.
3. **Report · AG Studio** tab, then open the Studio assistant, then *Review ad budgets*.
4. Open an ad link from Ad links and pay with the sandbox buyer: the receipt shows Meta's answer, and the dashboard counts it under that ad within 15 seconds.
5. Under Payments, Refund previews on the seeded payments; a payment you made can be refunded for real.
6. /proof lists every measured number and the script that reproduces it.
