
**Small shops pay for ads that bring chats, but only some chats turn into money. Paid Signal ties each PayPal payment to the ad click behind it, so the shop sees which ads bring money. AI agents then act on that ledger inside AG Grid, from invoices to refunds to ad budget, and nothing goes out until the owner approves.**

**How the match works:** the ad click (ad, source, click id) rides inside the PayPal order's `custom_id` or the invoice's reference. When PayPal confirms the payment, Paid Signal reads it back and books the money to that ad; refunds come off, a look-alike double payment waits for the owner, and Meta is told only about confirmed orders.

**Try it in 90 seconds** ([open the workspace](https://paid-signal.thelongmarketing.workers.dev/studio); no login, and the Approve buttons are open so you can try every step):
1. In the chart at the top, click the Testimonial ad. The page and the PayPal ledger under it narrow to that ad, and the budget agent's suggestion waits for your Approve.
2. Open the assistant and pick **Group the ledger by ad (AI Toolkit)**, or ask in your own words. AG Grid's AI Toolkit turns the request into a grid state, and the grid groups the payments and totals the money kept.
3. Pick **Invoice warm leads**. The revenue agent drafts real PayPal sandbox invoices and puts each one in the chat as a card; nothing is sent until you press Approve.
4. Open **Agents → PayPal**: every invoice, reminder, refund and payout the agents made, with the status PayPal reports for it now.

Want to pay as a customer? The [judge path](https://paid-signal.thelongmarketing.workers.dev/judge) lets you pay a sandbox invoice the agent drafted for you, see what it changes in the ad's numbers, and undo it with a PayPal refund.

### In numbers
- **69% of the chats, 19% of the money:** in a real gift shop's October (about $10,000 of ads, 735 payments, paid by bank transfer), the ad that brought most of the chats brought little of the money. That is why we built the same check on PayPal.
- **$0.41 against $2.73** per $1 of ads, in the demo shop (fictional ads, sandbox PayPal): the ad with the most leads (31) against the testimonial ad. The budget agent proposes growing the one that pays; the owner approves.
- **117 of 120** runs right when the owner asks the ledger grid for something in plain words (40 requests, each run 3 times; the AI Toolkit's groups and totals: 27 of 30).

## Inspiration

Small shops that sell through ads live between two numbers: the leads the ad platform reports and the money that actually arrives. They rarely agree. In a real gift shop's October, with about $10,000 of ads, the ad that brought 69% of the chats brought 19% of the money. That shop takes bank transfers, so we built the same check on PayPal, where every payment is confirmed, and gave the daily money work to agents.

Agents and money are an obvious risk: an agent can quote a number that is not true, or send something it should not. So in Paid Signal the agents draft and code checks: the numbers and payment ids they quote are checked against the ledger, prices are set in code, and every action that reaches a customer or moves money waits for the owner.

## What it does

- **Ad money for the ads that sell.** Each PayPal payment is matched to the ad click behind it; refunds come off, and a possible double payment or an open dispute is put on hold. The budget agent suggests which ads to grow, keep or cut from this ledger; every number and payment id it quotes is checked in code, and an ad with fewer than 3 paid orders is never moved. In the demo, the free guide ad shows 31 leads in the ad report and 1 paid order in PayPal.
- **Invoices for buyers who are ready.** The revenue agent reads what each lead wrote, picks the ones ready to buy and drafts a PayPal invoice through the Agent Toolkit; code sets the price and the recipient. The owner approves, and the send agent reads the draft from PayPal again before it sends it.
- **Kind reminders for late payers.** The chase agent prepares reminders for unpaid invoices, at most three a run, and sends them when the owner clicks Send.
- **Refunds for double charges, payouts for creators.** The refund agent returns a double payment once the owner approves. The payout agent pays the ad's creator per PayPal-confirmed order, not per lead.

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
