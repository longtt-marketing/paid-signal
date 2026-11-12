# Paid Signal: Devpost submission text

Project name: Paid Signal

Tagline (200 characters max):
Ad reports count chats. PayPal counts money. Paid Signal shows a small shop which ads really sold, and pays creators and AI agents only for sales PayPal confirms.

Built with: paypal-agent-toolkit, paypal-server-sdk, apimatic, mcp, paypal-orders-v2, paypal-invoicing, paypal-webhooks, paypal-transaction-search, paypal-js-sdk, meta-conversions-api, claude, anthropic, ag-studio, ag-grid, react, vite, cloudflare-workers, workers-kv, javascript

Try it: https://paid-signal.thelongmarketing.workers.dev · Proof: https://paid-signal.thelongmarketing.workers.dev/proof · Code: https://github.com/longtt-marketing/paid-signal

---

<!-- devpost-story -->
**Ad reports count chats. PayPal counts money.** Paid Signal shows a small shop which ads really sold, and pays the creators and AI agents who bring buyers only for sales PayPal confirms.

**[▶ Take the 60-second tour](https://paid-signal.thelongmarketing.workers.dev/studio?tour=1)** · no login · or [pay $49 as the customer](https://paid-signal.thelongmarketing.workers.dev/judge) and undo it with a PayPal refund.

## Inspiration

In October a small gift shop whose ads we run spent about $10,000 on ads. The ad report said one ad brought 69% of the chats. Matched by hand against the shop's 735 bank transfers, that ad brought 19% of the money. The owner had been paying for chats, not sales.

Bank transfers have to be matched one by one. On PayPal the same check can run by itself: every payment is confirmed, and the ad click can travel inside the order. Buyers also no longer come only from ads. Creators and AI shopping agents send them too, and each wants to be paid. So we built one rule for all of them: no PayPal-confirmed sale, no credit and no payout.

## What it does

One loop, on PayPal:

1. **The click rides inside the payment.** A buyer who comes from an ad carries the ad click (ad, source, click id) into a field of the PayPal order or invoice (`custom_id`, reference).
2. **PayPal confirms, and the ad gets the credit.** Paid Signal reads each payment back from PayPal and books it to its ad. Refunds come off; a payment that looks like a double charge, or one with an open dispute, waits for the owner. In the live demo shop (a fictional robotics club on the PayPal sandbox) the ad report counts 62 leads and PayPal confirms 9 paid orders. The ad with the most leads returns $0.41 of PayPal revenue per $1 of ads; the testimonial ad returns $2.73.
3. **The budget follows the money.** An agent proposes which ads to grow or cut. Code checks every number it quotes against the ledger, never moves an ad with fewer than 3 paid orders, and the owner approves.
4. **Whoever sent the buyer is paid per confirmed sale.** The ad's creator is paid through PayPal Payouts for each confirmed order, not each lead. Outside AI agents can sell for the shop too: over MCP (the open protocol AI agents use to call tools) an agent starts a PayPal checkout for the shop's fixed-price offer, and the buyer approves on PayPal. Once PayPal confirms the payment, the agent's $5 commission waits for the owner, then Payouts pays it. An agent with no confirmed sale is owed nothing, and code says so.

Around the loop, agents do the daily PayPal work, each behind the owner's click: invoices for leads ready to buy, kind reminders for who still owes, refunds for double charges.

**How AI is used:** agents draft, code checks, the owner approves. Claude reads what each lead wrote and drafts the invoice, the reminder or the budget plan. Code sets every price, payee and limit, and nothing goes out without a click.

### PayPal decides what counts

- **Orders v2** (Server SDK) and **Invoicing v2** carry the ad click to the payment.
- **Webhooks** (signature checked) and **Transaction Search** keep the ledger equal to PayPal's own history.
- **Payouts** pays creators and agents per confirmed sale.
- The **PayPal Agent Toolkit** gives the agents their PayPal actions (invoices, reminders, refunds, disputes), and every action is read back from PayPal.

Live in the sandbox, each read back from PayPal: a $49 double payment refunded (COMPLETED), $15 paid to an ad's creator for 3 paid orders (SUCCESS), and a $5 commission for a sale Claude made as an outside agent over MCP, paid by the sandbox buyer (SUCCESS, [the run](https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/mcp-claude-sale-2026-11-12.md)). [Proof](https://github.com/longtt-marketing/paid-signal/tree/main/docs/proof).

### Where the owner works: AG Grid and AG Studio

The same PayPal ledger is an AG Grid table inside AG Studio, where the owner and the agents work.

- **Ask the ledger in plain words.** For groups and totals, AG Grid's AI Toolkit turns the request into grid state; filters and sorts go through the grid's own API. Measured on 51 requests, 3 runs each: 149 of 153 runs right, 59 of 63 for the AI Toolkit's groups and totals; all 4 misses were on held-out requests written after the last change ([eval](https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/grid-agent-eval-2026-11-11.json)).
- **AG Studio's own agents** build a new page from one request; custom Studio tools turn invoice drafts and reminders into cards the owner approves.
- **Seven custom widgets, one cross-filter.** Click an ad and the whole page follows. The arrow on a row opens a payment's history: the ad click, the PayPal capture, what Meta was told.
- **An AG Grid pivot** of the real gift shop's 735 payments.

How each feature is wired: [docs/AG-STUDIO.md](https://github.com/longtt-marketing/paid-signal/blob/main/docs/AG-STUDIO.md).

## How we built it

Cloudflare Workers and KV; React and Vite. Six agents on Claude Sonnet 5.5, each with its own tools, every tool call checked against its schema. An MCP server with 8 read tools and 4 write tools for outside agents. Meta's Conversions API hears about confirmed purchases only (test events). 218 tests run in CI.

## Challenges we ran into

- **Agents that make up numbers.** A check in code rejects any number or payment id that is not in the ledger. In a test with 1,100 planted errors, it caught all 1,100.
- **One payment, many signals.** A PayPal payment can arrive from an order, an invoice and a webhook, sometimes twice. Each is matched to its ad once, refunds come off, and likely double charges wait for a person.
- **Letting outside agents in without letting them move money.** An agent can start a checkout that the buyer approves on PayPal, and it can ask; price, payee and commission are fixed in code. We pointed Claude at the public MCP server as a selling agent: it started a sandbox checkout, asked for its commission only after PayPal confirmed the buyer's payment, and the $5 was paid after the owner approved ([the run](https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/mcp-claude-sale-2026-11-12.md)). In another run the buyer had not paid, and Claude did not ask ([that run](https://github.com/longtt-marketing/paid-signal/blob/main/docs/proof/mcp-claude-buy-2026-11-12.md)).

## Accomplishments that we're proud of

- PayPal sandbox payments, refunds and payouts, end to end, each read back from PayPal.
- A judge can be the customer: pay $49 on PayPal's page, watch the testimonial ad gain the order, and undo it with a refund.
- The real gift shop's whole book (1,214 orders, 735 payments, 30 refunds, anonymised) is in the repo, so its numbers can be recomputed.

## What we learned

- The number that matters to a shop is the one PayPal confirms, not the one an ad platform reports.
- Agents help most with the tedious part, reading and drafting, with the decision left to a click.

## What's next

A pilot with the gift shop on PayPal; approved budget changes sent straight to the ad platform; each agent program registering its own PayPal payee (today the demo pays one sandbox account set in code).

**About the demo:** the demo shop (Kite Robotics Club) is fictional and runs on the PayPal sandbox with Meta test events. Approve is open so you can try every step; a real shop puts it behind the owner's sign-in. The gift shop's figures come from its own book; the ad figures are reported by us. Every number and the script behind it: [/proof](https://paid-signal.thelongmarketing.workers.dev/proof).

## Testing instructions (private field)

Demo: https://paid-signal.thelongmarketing.workers.dev (no login needed to look around; desktop browser recommended)
PayPal sandbox buyer: [SANDBOX BUYER EMAIL] / [PASSWORD], for the PayPal step.
Outside agent (MCP): add https://paid-signal.thelongmarketing.workers.dev/mcp as a connector in Claude (or any MCP client) and ask "buy one trial class from this shop and tell me the PayPal status".

1. Start at https://paid-signal.thelongmarketing.workers.dev/judge (no login): press "Be the customer: pay $49". Claude drafts a PayPal sandbox invoice for you, you approve it, then pay on PayPal's page with the sandbox buyer above (or press "Replay a recorded payment"). The testimonial ad gains your order; Undo refunds it through PayPal.
2. On the same page, "What the agents can't do": Ask it live (Claude refuses to raise an ad with 31 leads and 1 paid order), Send it (a prompt injection is not invoiced), Ask for an unearned commission (code returns $0 owed).
3. https://paid-signal.thelongmarketing.workers.dev/studio?tour=1: the 60-second guided tour of AG Studio (an ad filter, a payment's history, a live AG Grid AI Toolkit call, the PayPal read-back). Then open the Studio assistant and pick "Group the ledger by ad (AI Toolkit)" or "Invoice warm leads".
4. Outside agents: on /judge open "An outside AI agent buys: connect yours over MCP". "Run a sample agent" starts a sandbox order; requests an agent makes appear under Outside agents with Approve and Decline (open for judging). Claude's own end-to-end sale: docs/proof/mcp-claude-sale-2026-11-12.md in the repo.
5. https://paid-signal.thelongmarketing.workers.dev/trail follows one payment from ad click to PayPal to Meta's reply; https://paid-signal.thelongmarketing.workers.dev/audit runs the same ledger on your own Ads Manager and PayPal files, in the browser.
6. https://paid-signal.thelongmarketing.workers.dev/proof lists every measured number and the script that reproduces it.
