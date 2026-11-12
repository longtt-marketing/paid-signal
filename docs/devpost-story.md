
**Ad reports count chats. PayPal counts money.** Paid Signal shows a small shop which ads really sold, and pays the creators and AI agents who bring buyers only for sales PayPal confirms.

**[▶ Take the 60-second tour](https://paid-signal.thelongmarketing.workers.dev/studio?tour=1)** · no login · or [pay $49 as the customer](https://paid-signal.thelongmarketing.workers.dev/judge) and undo it with a PayPal refund.

## Inspiration

In October a small gift shop whose ads we run spent about $10,000 on ads. The ad report said one ad brought 69% of the chats. Matched by hand against the shop's 735 bank transfers, that ad brought 19% of the money. The owner had been paying for chats, not sales.

On the shop's own numbers, splitting the same budget by money instead of chats is worth 9% to 18% more revenue in a month ([how it is computed](https://paid-signal.thelongmarketing.workers.dev/judge#gap)). Finding that took a person matching transfers one by one. That is the problem Paid Signal removes: on PayPal every payment is already confirmed, and the ad click can ride inside the order, so the same check runs by itself, every day, for every ad.

> "Ads Manager says a campaign brought plenty of enquiries, but only my payment history shows who actually paid, and the two never line up. Seeing paid orders next to each ad, before I raise a budget, is what I need."
> A friend who runs an online shop and buys their own Facebook ads (paraphrased from our conversation, shared with their permission, name withheld).

The gap is getting wider. Buyers no longer come only from ads: creators and AI shopping agents send them too, and each wants to be paid. So we built one rule for all of them: no PayPal-confirmed sale, no credit and no payout.

**Who it is for:** small shops that sell through chat and click-to-message ads, where the ad platform sees the conversation but never the payment. They are the shops that can least afford to pay for chats that never buy, and they already take PayPal.

## What it does

One loop, on PayPal:

1. **The click rides inside the payment.** A buyer who comes from an ad carries the ad click (ad, source, click id) into the PayPal order's `custom_id`; for an invoice, Paid Signal keeps the click beside the PayPal invoice id in its ledger. No tracking pixel and no modelled guess: for a checkout, PayPal's own record of the payment carries the click.
2. **PayPal confirms, and the ad gets the credit.** Paid Signal reads each payment back from PayPal and books it to its ad. Refunds come off; a payment that looks like a double charge, or one with an open dispute, waits for the owner. In the live demo shop (a fictional robotics club on the PayPal sandbox) the ad report counts 62 leads and PayPal confirms 9 paid orders. The ad with the most leads returns $0.41 of PayPal revenue per $1 of ads; the testimonial ad returns $2.73.
3. **The budget follows the money.** An agent proposes which ads to grow or cut. Code checks every number it quotes against the ledger, never moves an ad with fewer than 3 paid orders, and the owner approves.
4. **Whoever sent the buyer is paid per confirmed sale.** The ad's creator is paid through PayPal Payouts for each confirmed order, not each lead. The same rule covers outside AI agents that sell for the shop over MCP (the open protocol AI agents use to call tools): the buyer approves on PayPal, and the agent's $5 commission is paid only after PayPal confirms the sale and the owner approves.

Around the loop, agents do the daily PayPal work: invoices for leads ready to buy and refunds for double charges wait for the owner's click; kind reminders go out after the owner presses Chase, capped in code.

**How AI is used:** agents draft, code checks, the owner approves. Claude reads what each lead wrote and drafts the invoice, the reminder or the budget plan. Code sets every price, payee and limit; invoices, refunds and payouts wait for the owner's click.

### PayPal decides what counts

- **Orders v2** (Server SDK) and **Invoicing v2** carry the ad click to the payment.
- **Webhooks** (signature checked) and **Transaction Search** check the ledger against PayPal's own history.
- **Payouts** pays creators and agents per confirmed sale.
- The **PayPal Agent Toolkit** gives the agents their PayPal actions (invoices, reminders, refunds, disputes), and every action is read back from PayPal.

Live in the sandbox, each read back from PayPal: a $49 double payment refunded (COMPLETED), $15 paid to an ad's creator for 3 paid orders (SUCCESS), and a $5 commission for a sale Claude made as an outside agent over MCP, paid by the sandbox buyer (SUCCESS, [the run](https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/mcp-claude-sale-2026-11-12.md)). [Proof](https://github.com/longtt-marketing/paid-signal/tree/main/docs/proof).

### Where the owner works: AG Grid and AG Studio

The same PayPal ledger is an AG Grid table inside AG Studio, where the owner and the agents work.

- **Ask the ledger in plain words.** For groups and totals, AG Grid's AI Toolkit turns the request into grid state; filters and sorts go through the grid's own API. Measured: 59 of 63 runs right for the AI Toolkit's groups and totals; the misses were on held-out requests written after the last change ([eval](https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/grid-agent-eval-2026-11-11.json)).
- **AG Studio's own agents** build a new page from one request; custom Studio tools turn invoice drafts and reminders into cards the owner approves.
- **Seven custom widgets, one cross-filter.** Click an ad and the whole page follows. The arrow on a row opens a payment's history: the ad click, the PayPal capture, what Meta was told.
- **An AG Grid pivot** of the real gift shop's 735 payments.

How each feature is wired: [docs/AG-STUDIO.md](https://github.com/longtt-marketing/paid-signal/blob/main/docs/AG-STUDIO.md).

## How we built it

Cloudflare Workers and KV; React and Vite. Six agents on Claude Sonnet 5.5, each with its own tools, every tool call checked against its schema. An MCP server with 8 read tools and 4 write tools for outside agents. Meta's Conversions API hears about confirmed purchases only (test events). Tests run in CI.

## Challenges we ran into

- **Agents that make up numbers.** For budget plans, a check in code rejects any number or payment id that is not in the ledger, before the owner sees the plan.
- **One payment, many signals.** A PayPal payment can arrive from an order, an invoice and a webhook, sometimes twice. Each is matched to its ad once, refunds come off, and likely double charges wait for a person.
- **Letting outside agents in without letting them move money.** An agent can start a checkout that the buyer approves on PayPal, and it can ask; price, payee and commission are fixed in code. We pointed Claude at the public MCP server as a selling agent: it started a sandbox checkout, asked for its commission only after PayPal confirmed the buyer's payment, and the $5 was paid after the owner approved ([the run](https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/mcp-claude-sale-2026-11-12.md)). In another run the buyer had not paid, and Claude did not ask ([that run](https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/mcp-claude-buy-2026-11-12.md)).

## Accomplishments that we're proud of

- PayPal sandbox payments, refunds and payouts, end to end, each read back from PayPal.
- A judge can be the customer: pay $49 on PayPal's page, watch the testimonial ad gain the order, and undo it with a refund.
- The real gift shop's whole book, anonymised, is in the repo, so its numbers can be recomputed.

## What we learned

- The number that matters to a shop is the one PayPal confirms, not the one an ad platform reports.
- Agents help most with the tedious part, reading and drafting, with the decision left to a click.

## What's next

Move the gift shop's checkout to PayPal and run Paid Signal on its live ads, so the October check runs every day by itself; send approved budget changes straight to the ad platform; let each agent program register its own PayPal payee (today the demo pays one sandbox account set in code).

**About the demo:** the demo shop (Kite Robotics Club) is fictional and runs on the PayPal sandbox with Meta test events. Approve is open so you can try every step; a real shop puts it behind the owner's sign-in. The gift shop's figures come from its own book; the ad figures are reported by us. Every number and the script behind it: [/proof](https://paid-signal.thelongmarketing.workers.dev/proof).
