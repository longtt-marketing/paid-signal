# Paid Signal: Devpost submission text

Project name: Paid Signal

Tagline (200 characters max):
See which ads bring PayPal money, not just chats, and let AI agents act on it. Nothing goes out until the owner approves.

Built with: paypal-agent-toolkit, paypal-server-sdk, apimatic, mcp, paypal-orders-v2, paypal-invoicing, paypal-webhooks, paypal-transaction-search, paypal-js-sdk, meta-conversions-api, claude, anthropic, ag-studio, ag-grid, react, vite, cloudflare-workers, workers-kv, javascript

Try it: https://paid-signal.thelongmarketing.workers.dev · Proof: https://paid-signal.thelongmarketing.workers.dev/proof · Code: https://github.com/longtt-marketing/paid-signal

---

<!-- devpost-story -->
**In October a small gift shop spent about $10,000 on ads. Matched by hand against its bank transfers, the ad that brought 69% of its chats brought 19% of its money. Paid Signal makes that check automatic on PayPal: a payment that carries the ad click is tied to that ad, so the owner sees which ads bring money, not just messages. AI agents then do the daily money work inside AG Grid: they draft invoices and reminders, refund double charges and recommend ad budgets, and nothing reaches a customer or moves money until the owner clicks Approve or Send.**

**Try it in 90 seconds** ([open the workspace](https://paid-signal.thelongmarketing.workers.dev/studio); no login, and the Approve buttons are open so you can try every step):
1. In the chart at the top, click the Testimonial ad. The page and the PayPal ledger under it narrow to that ad, and the budget agent's suggestion waits for your Approve.
2. Open the assistant and pick **Group the ledger by ad (AI Toolkit)**, or ask in your own words. AG Grid's AI Toolkit turns the request into a grid state, and the grid groups the payments and totals the money kept.
3. Pick **Invoice warm leads**. The revenue agent drafts real PayPal sandbox invoices and puts each one in the chat as a card; nothing is sent until you press Approve.
4. Open **Agents → PayPal**: every invoice, reminder, refund and payout the agents made, with the status PayPal reports for it now.

Want to pay as a customer? The [judge path](https://paid-signal.thelongmarketing.workers.dev/judge) lets you pay a sandbox invoice the agent drafted for you, see what it changes in the ad's numbers, and undo it with a PayPal refund.

### In numbers
- **117 of 120** runs right when the owner asks the ledger grid for something in plain words (40 requests, each run 3 times). The 3 misses were the same request, refunded payments totalled per ad: the assistant filtered the grid but did not group and total it. No invoice, reminder or payment went out.
- **0** invoices or reminders sent without the owner's click: the assistant's tools can only draft them (a test checks the list), and sending runs only after Approve or Send.
- **1,100 of 1,100** planted errors (made-up numbers, fake payment ids, budget moves on thin evidence) caught by the code that checks the budget agent; **0 of 500** correct recommendations rejected.
- **$0.41 against $2.73** per $1 of ads, in the demo shop (fictional ads, sandbox PayPal): the ad with the most leads against the testimonial ad. The budget agent proposes growing the one that pays; the owner approves.

## Inspiration

Small shops that sell through ads live between two numbers: the leads the ad platform reports and the money that actually arrives. They rarely agree. The gift shop above is paid by bank transfer, so we ran the check on its own records (735 payments). Then we built the same check on PayPal, where every payment is confirmed, and gave the daily money work to agents.

Agents and money are an obvious risk: an agent can quote a number that is not true, or send something it should not. So in Paid Signal the agents draft and code checks: the numbers and payment ids they quote are checked against the ledger, prices are set in code, and every action that reaches a customer or moves money waits for the owner.

## What it does

- **Ad money for the ads that sell.** Each PayPal payment is matched to the ad click behind it; refunds come off, and a possible double payment or an open dispute is put on hold. The budget agent suggests which ads to grow, keep or cut from this ledger; every number and payment id it quotes is checked in code, and an ad with fewer than 3 paid orders is never moved. In the demo, the free guide ad shows 31 leads in the ad report and 1 paid order in PayPal.
- **How the match works.** The ad click (ad, source, click id) rides inside the PayPal order's `custom_id` or the invoice's reference. When PayPal confirms the payment, Paid Signal reads it back and books the money to that ad; refunds come off, a look-alike double payment waits for the owner, and Meta is told only about confirmed orders. Invoices the agents draft carry the click automatically. A payment that arrives with no ad click is booked as direct: it is not credited to any ad and is not reported to Meta. In the demo, all 13 sandbox payments carry their click.
- **Invoices for buyers who are ready.** The revenue agent reads what each lead wrote, picks the ones ready to buy and drafts a PayPal invoice through the Agent Toolkit; code sets the price and the recipient. The owner approves, and the send agent reads the draft from PayPal again before it sends it.
- **Kind reminders for late payers.** The chase agent prepares reminders for unpaid invoices, at most three a run, and sends them when the owner clicks Send.
- **Refunds for double charges, payouts for creators.** The refund agent returns a double payment once the owner approves. The payout agent pays the ad's creator per PayPal-confirmed order, not per lead.

**Why agents and not rules:** deciding who is ready to buy means reading what each lead actually wrote, in free text, which an agent does well and simple rules do not. The rules that touch money (the price, the recipient, whether an ad has enough paid orders to move its budget) are code, and the owner approves every action.

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

- **PayPal** is the source of truth: a payment counts only when PayPal confirms it. Agent Toolkit (`create_invoice`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `create_refund`, `get_refund`, `list_disputes`, `get_dispute`), Orders v2 through the Server SDK (APIMatic), Invoicing v2, Payouts v1, Webhooks with signature checks, Transaction Search, JS SDK.
- **AI:** six agents on Claude Sonnet 5.5, each with its own tools, every tool call checked against its schema; inside AG Studio they run through a custom model adapter. A read-only MCP server exposes the ledger.
- **AG Grid:** AG Studio for the workspace, AG Grid Enterprise (AI Toolkit, row grouping) on the Studio ledger, AG Grid Community and AG Charts on the dashboard.
- **Runs on** Cloudflare Workers and KV, with 204 tests in CI.

## Challenges we ran into

- **Agents that make up numbers.** The fix was to let agents draft and code decide: a check rejects any number or payment id that is not in the ledger. Against 11 kinds of planted error, 100 of each, it caught all of them, and it rejected 0 of 500 correct recommendations.
- **Matching money to ads.** A PayPal payment arrives from an order, an invoice or a webhook, sometimes twice. We match each one to its ad click, take refunds off and hold look-alike double payments until a person decides.
- **An assistant you can trust on the grid.** Only measuring caught it: the grid evals found two silent failures (a hidden widget copy that never answered, and an empty AI Toolkit schema while the ledger showed its ad groups). Both are fixed, and the eval was rerun after each fix.

## Accomplishments that we're proud of

- Real sandbox money, end to end: a $49 double payment refunded (COMPLETED), $15 paid to the ad's creator for 3 paid orders (SUCCESS), and every agent action found again in PayPal.
- Over two runs of a held-out set of leads, the revenue agent invoiced 24 of 24 ready-to-buy decisions, left 20 of 20 not-ready leads alone and invoiced 0 of 16 prompt-injection attempts; a browser check of both ledgers passes 7 of 7.
- 0 accessibility violations on nine pages, phone and desktop (axe-core).

## What we learned

- Agents are most useful on the tedious part, reading messages and drafting, with the decision left to a click.
- The number that matters to a shop is the one PayPal confirms, not the one an ad platform reports.

## What's next

- A pilot with a real shop on PayPal, and budget changes that reach the ad platform after the owner approves.

## Limits

- The demo shop's ads and leads are fictional, PayPal runs in the sandbox, and Meta receives test events. The ledger holds 13 sandbox payments.
- A real shop would sign in before its Approve buttons work; they are open here for judges.
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
