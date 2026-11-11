# Paid Signal: Devpost submission text

Project name: Paid Signal

Tagline (200 characters max):
Paid Signal shows a small shop which ads bring money PayPal confirms, and lets AI agents in AG Grid do the money work behind the owner's approval.

Built with: paypal-agent-toolkit, paypal-server-sdk, apimatic, mcp, paypal-orders-v2, paypal-invoicing, paypal-webhooks, paypal-transaction-search, paypal-js-sdk, meta-conversions-api, claude, anthropic, ag-studio, ag-grid, react, vite, cloudflare-workers, workers-kv, javascript

Try it: https://paid-signal.thelongmarketing.workers.dev · Proof: https://paid-signal.thelongmarketing.workers.dev/proof · Code: https://github.com/longtt-marketing/paid-signal

---

<!-- devpost-story -->
**Paid Signal shows a small shop which ads bring money PayPal confirms, and lets AI agents in AG Grid do the money work behind the owner's approval.**

**[▶ Start the 60-second guided tour](https://paid-signal.thelongmarketing.workers.dev/studio?tour=1)** · no login · it clicks through four steps by itself (an ad filter, a payment's history, a live AG Grid AI Toolkit call, the PayPal read-back); you press Next between them. Or [pay as a customer](https://paid-signal.thelongmarketing.workers.dev/judge): a sandbox invoice the agent drafts for you, then undo it with a PayPal refund.

### In numbers
- **149 of 153** runs right when the owner asks the ledger grid for something in plain words (51 requests, each run 3 times: filters and sorts 72 of 72, refusals 18 of 18, AI Toolkit groups and totals 59 of 63). All 4 misses came from 2 of the 6 requests written after the last fix and held out from it: once the assistant did not act, three times it left out a filter, so a partly refunded payment counted. No invoice, reminder or payment went out.
- **1,100 of 1,100** planted errors (made-up numbers, fake payment ids, budget moves on thin evidence) caught by the code that checks the budget agent; **0 of 500** correct recommendations rejected.
- **0** invoices or reminders sent without the owner's click: the assistant's tools can only draft them (a test checks the list), and sending runs only after Approve or Send.

## Inspiration

In October a small gift shop spent about $10,000 on ads. Matched by hand against its bank transfers, the ad that brought 69% of its chats brought 19% of its money. The ad report counted chats, and chats are not money.

That shop is paid by bank transfer, so its 735 payments had to be matched by hand. On PayPal the same check can run by itself: every payment is confirmed, and the ad click can travel with it. We built that check, then gave the daily money work around it to agents, with one rule: agents draft, code checks, the owner approves.

## What it does

Paid Signal runs one loop on PayPal, and an agent works each step:

1. **PayPal confirms the sale.** The ad click (ad, source, click id) rides inside the PayPal order's `custom_id` or the invoice's reference. When PayPal confirms the payment, Paid Signal reads it back and books the money to that ad. Refunds come off, a look-alike double payment or an open PayPal dispute is put on hold, and a payment with no ad click stays unattributed: it counts for no ad and is not reported to Meta.
2. **The ad gets the credit.** An ad is credited with confirmed orders only. In the demo shop (Kite Robotics Club: fictional ads, sandbox PayPal) the ad report counts 62 leads and PayPal confirms 9 paid orders; Meta hears only about the confirmed purchases from its own ads.
3. **The creator is paid by the sale.** After the owner approves, the payout agent pays the ad's creator through PayPal Payouts per eligible confirmed order (refunded, disputed, held or already-paid orders do not count), not per lead.
4. **Ad money moves to what sells.** The budget agent proposes which ads to grow, keep or cut from this ledger. Every number and payment id it quotes is checked in code, an ad with fewer than 3 paid orders is never moved, and the owner approves. In the demo, the ad with the most leads (31) brings $0.41 of PayPal revenue per $1 of ads; the testimonial ad brings $2.73.

Around the loop, three more agents keep the money moving: the revenue agent drafts PayPal invoices for the leads who are ready to buy (code sets the price and the recipient, and the send agent reads each draft from PayPal again after the owner approves), the chase agent prepares kind reminders (at most three a run, sent on the owner's click), and the refund agent returns double charges once the owner approves.

**Why agents and not rules:** deciding who is ready to buy means reading what each lead actually wrote, in free text, which is the part an agent is for. The rules that touch money (the price, the recipient, whether an ad has enough paid orders to move its budget) are code, and the owner approves every action.

### PayPal: the source of truth

A lead or an ad platform event never counts as a sale here; only PayPal's record does. Each PayPal piece closes one gap in the money trail:
- **Orders v2** (through the Server SDK) and **Invoicing v2** carry the ad click from the click to the payment request.
- **Webhooks**, with signature checks, report captures and refunds as they happen; **Transaction Search** reconciles the ledger against PayPal's own history.
- **Payouts v1** pays creators per confirmed order.
- The **PayPal Agent Toolkit** gives the agents their PayPal hands: `create_invoice`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `create_refund`, `get_refund`, `list_disputes`, `get_dispute`. Agent writes are read back from PayPal; the Agents → PayPal page lists each one with the status PayPal last reported.

### AG Grid and AG Studio: the workspace

AG Studio is the shop's workspace, and the PayPal ledger is an AG Grid table the agents work in.

| What you see | AG Grid / AG Studio feature | Where |
|---|---|---|
| Ask for groups and totals; the grid builds them | AG Grid AI Toolkit: `getStructuredSchema()` goes to the model, and the grid state it returns is applied with `setState()` (row grouping, sums, filters) | assistant: Group the ledger by ad (AI Toolkit) |
| Ask for some payments; the grid filters, sorts and flashes them | `setFilterModel` (filters show in the column headers), `applyColumnState`, `flashCells` | assistant: Show refunded or held payments |
| Studio's own agents build a page from one request | Studio Agent Framework: the lead agent hands the work to Studio's page, widget and data agents | assistant: Replay Studio building a page |
| Invoice drafts and reminders as cards with Approve or Send | custom Studio tools with their own chat cards | assistant: Invoice warm leads, Nudge who still owes |

- Seven custom widgets read the same data, and a click on an ad filters the whole page through Studio's cross-filter.
- In the ledger, ▸ opens a payment's history (ad click, PayPal capture, ledger, what Meta was told), and the owner decides each payment in its Decision cell.
- Also in the workspace: an AG Grid pivot of the real shop's 735 payments. How it is built: docs/AG-STUDIO.md.

## How we built it

- **AI:** six agents on Claude Sonnet 5.5, each with its own tools, every tool call checked against its schema; inside AG Studio they run through a custom model adapter. The model has one job: read free text and draft. It cannot set a price or a recipient, cite a number the ledger does not hold, send an invoice by itself or change an ad budget. A read-only MCP server exposes the ledger.
- **PayPal** and **AG Grid / AG Studio** as above; AG Grid Community and AG Charts on the dashboard.
- **Runs on** Cloudflare Workers and KV, with 204 tests passing in CI.

## Challenges we ran into

- **Agents that make up numbers.** We let agents draft and code decide: a check rejects any number or payment id that is not in the ledger (the 1,100 of 1,100 above).
- **Matching money to ads.** A PayPal payment arrives from an order, an invoice or a webhook, sometimes twice. We match each one to its ad click, take refunds off and hold look-alike double payments until a person decides.
- **An assistant you can trust on the grid.** Only measuring caught it: the grid evals found two silent failures (a hidden widget copy that never answered, and an empty AI Toolkit schema while the ledger showed its ad groups). Both are fixed, and the eval was rerun after each fix.
- **A demo judges can run without a merchant account.** So the demo shop's ads and leads are fictional, PayPal runs in the sandbox and Meta receives test events (the ledger holds 13 sandbox payments, all carrying their click). The Approve buttons are open so judges can try every step; a real shop would sign in first. The gift shop's figures are its own bank-transfer records, the reason Paid Signal exists, not a result of it.

## Accomplishments that we're proud of

- Real sandbox money, end to end: a $49 double payment refunded (PayPal: COMPLETED) and $15 paid to the ad's creator for 3 paid orders (PayPal: SUCCESS), each read back from PayPal.
- In each of two runs on a held-out set of leads, the revenue agent invoiced 12 of 12 ready buyers, left 10 of 10 not-ready leads alone and invoiced 0 of 8 prompt-injection attempts; a browser check of both ledgers passes 7 of 7.
- 0 accessibility violations on nine pages, phone and desktop (axe-core).

## What we learned

- Agents are most useful on the tedious part, reading messages and drafting, with the decision left to a click.
- The number that matters to a shop is the one PayPal confirms, not the one an ad platform reports.

## What's next

Today Paid Signal runs on a fictional shop in the PayPal sandbox, with AG Grid Enterprise on a trial licence. Next: a pilot with a real shop on PayPal, and budget changes that reach the ad platform after the owner approves.

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
