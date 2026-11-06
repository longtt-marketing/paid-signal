## Paid Signal in brief

**The ad report credits the free guide with 31 leads. PayPal confirms one paid order for it. Paid Signal makes AI agents act on the second number.**

For shops that close a sale in a chat or a lead form and bill by PayPal invoice (classes, tutors, coaches, small studios), Claude agents invoice the customer through PayPal's Agent Toolkit, refund a double payment, pay the ad's creator per paid order, and recommend ad budget moves only on what PayPal confirms. Code holds every price, recipient, amount and limit; a person approves every invoice, refund, payout and budget recommendation, and reminders stay within code limits.

**Try it in a few minutes ([judge path](https://paid-signal.thelongmarketing.workers.dev/judge), sandbox, no real money):** ask to book and Claude drafts a real PayPal invoice; approve it and pay it as the sandbox buyer. Then see what your payment changed: the testimonial ad gains your order (its count goes 4 → 5), the budget rule re-runs, and the ad's creator can be paid $5 through PayPal Payouts. Undo refunds it through PayPal and the count goes back to 4.

**Claude says no:** the owner asks to raise the free guide. With 1 paid order, Claude refuses and recommends the testimonial ad (4 paid orders, $2.73 of paid revenue per $1 of ads); the same raise sent straight to the rule in code is refused too. Type your own request on /judge for a live answer.

**Why it matters:** in a Vietnamese gift shop the author runs Meta ads for, the attention video brought 69% of the chats and 19% of the money kept after refunds. The shop's published book, run through Paid Signal's ledger code, gives the same 705 kept orders as its accountant's workbook and holds its 7 double payments. Split the same October spend by Paid Signal's rule and the shop's own numbers imply about 9% to 18% more revenue after refunds in one month: an estimate, see Limits.

**Links, no login:** [Judge path](https://paid-signal.thelongmarketing.workers.dev/judge) · [Audit your own ads](https://paid-signal.thelongmarketing.workers.dev/audit) · [Dashboard](https://paid-signal.thelongmarketing.workers.dev) · [Proof](https://paid-signal.thelongmarketing.workers.dev/proof) · [Code](https://github.com/longtt-marketing/paid-signal)

## What it does

The core loop, in three steps:

1. **Chat to PayPal invoice.** The revenue agent reads each lead's message and drafts the invoice with the Agent Toolkit's `create_invoice`; code sets the price and recipient inside the call. A person approves; the send agent sends; the chase agent reminds, within code limits.
2. **Payment to ledger.** Payments are matched to ads from the capture, the invoice and signature-verified webhooks. Refunds come off; likely double payments and open disputes are held out. Transaction Search cross-checks the ledger against PayPal's history.
3. **Budget by money.** The budget agent recommends moves from that ledger; an evidence gate in code checks every number, capture id and the direction of every move, and below 3 paid orders an ad's budget does not move. A person approves.

**Also on the same ledger:** the refund agent returns a held double payment once a person approves (a real sandbox refund of $49, COMPLETED; on the judge path, live Claude declines one of two look-alike double charges and refunds the other, held-out test 13 of 14); the ad's creator is paid $5 per PayPal-confirmed paid order through Payouts, not per lead (per lead, the free guide would pay $155 for 1 paid order); a confirmed payment from a Meta ad goes back to Meta as a Purchase; and [/audit](https://paid-signal.thelongmarketing.workers.dev/audit) runs the ledger on your own Ads Manager export and PayPal download in the browser, nothing uploaded.

## Built with PayPal

Agent Toolkit (`create_invoice`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `create_refund`, `get_refund`, `list_disputes`, `get_dispute`), Server SDK (APIMatic), Orders v2, Invoicing v2, Payouts v1, Webhooks with signature checks, Transaction Search, JS SDK. Six Claude agents, every tool call checked against its schema; an MCP server with six read-only tools; Cloudflare Workers and KV; 178 unit tests in CI.

## AG Grid: AG Studio as the agent workspace

Studio's agents here act on PayPal, not only read: from Studio's assistant the revenue agent drafts real PayPal sandbox invoices (each waits for approval) and the nudge agent sends PayPal reminders within code limits. Two custom agents (budget, nudge) run on Studio's Agent Framework with Claude through a custom `AgLlmAdapter`, delegate to Studio's page agent, and the budget agent's recommendation passes the same evidence gate as the app. Five custom widgets with cross-filters (claimed vs confirmed, payment timeline, leads to invoices to paid orders, who still owes, reported share vs money share), five report pages, a theme from the app's design tokens and a phone layout. Every Paid Signal tool has its own chat card, so a judge sees the invoices drafted, the reminders sent and what the gate decided. The assistant opens on three recorded real runs (the budget agent through the gate, the nudge agent's PayPal reminders, the real shop explained from its tables) that replay without calling a model; any judge can run them live again. One page runs on the real gift shop's book (two more tables: its three ad groups and 735 payments), so Studio shows the same gap on real data. Dashboard → Report · AG Studio → Studio assistant.

## How we tested it

- Revenue agent, 30 held-out leads run twice: 24/24 bookings invoiced right, 20/20 not-ready leads left alone, 0/16 prompt injections invoiced (Claude plus the code checks).
- Evidence gate: 11 kinds of planted error, 100 of each, all caught; 0 of 500 good recommendations rejected.
- Refund agent, 14 held-out pairs that differ only in what the buyer wrote: 6/6 double payments refunded, 7/8 others declined.
- Real sandbox runs: a $49 double payment refunded (COMPLETED); $15 paid to the creator for 3 paid orders (SUCCESS).
- Methods and scripts behind every number: [/proof](https://paid-signal.thelongmarketing.workers.dev/proof).

## Limits

- A demo shop: its ads and leads are fictional; PayPal is sandbox; Meta gets test events. Results are on 13 sandbox payments; the 3-order floor is a safety rule, not a significance test.
- Meta accepted a lead-form Purchase for one Meta test lead; a Messenger Purchase has not been accepted with a real chat id yet.
- Gift shop: paid by bank transfer, not PayPal; it is why Paid Signal exists, not a result of it. Chat counts are reported from the ad account, whose exports are no longer available; its order, payment and refund book is published. "Money" is revenue after refunds, before costs.
- The 9% to 18% (about $4,625 to $8,960) assumes returns flatten as an ad gets more spend; if they did not, 48% is the upper bound (`whatIf`, src/merchantCase.js). One month, three ad groups, spend moved beyond what October tested: not a measured lift.
- Judge path: your payment has no ad click, so Meta is not told; only your view changes; the creator payout runs once per browser, up to 15 judges a day. A live Undo on 5 Nov ended REFUNDED (docs/proof/judge-undo-2026-11-05.json).
- Approve records a decision; it does not change a live Meta budget. Whether a live campaign then spends better is not measured.
- Approve buttons are open in the demo; a real shop puts them behind its own login.
- Meta has no retraction: a refund after the send is subtracted here, not at Meta.
