# Paid Signal: Devpost submission text

Project name: Paid Signal

Tagline (200 characters max):
AI agents run the money side of a chat sale, checked against PayPal's records. In a shop the author runs ads for, the ad with 69% of chats brought 19% of the money. Claude invoices, refunds, says no.

Built with: paypal-agent-toolkit, paypal-server-sdk, apimatic, mcp, paypal-orders-v2, paypal-invoicing, paypal-webhooks, paypal-transaction-search, paypal-js-sdk, meta-conversions-api, claude, anthropic, ag-studio, ag-grid, react, vite, cloudflare-workers, workers-kv, javascript

Try it: https://paid-signal.thelongmarketing.workers.dev · Proof: https://paid-signal.thelongmarketing.workers.dev/proof · Code: https://github.com/longtt-marketing/paid-signal

---

## Paid Signal in brief

**The ad report credits the free guide with 31 leads. PayPal confirms one paid order for it.**

Paid Signal is for shops that close a sale in a chat or a lead form and bill by PayPal invoice: classes, tutors, coaches, small studios. Claude agents invoice the customer through PayPal's Agent Toolkit, chase the payment, refund a double payment, pay the ad's creator per paid order, and tell Meta and the budget agent only what PayPal confirms. Code holds every price, recipient, amount and limit; a person approves every invoice, refund, payout and budget change, and reminders go out within code limits.

**Follow your own payment (judge path, a few minutes with the sandbox buyer from the testing instructions, no real money):** write as a customer and Claude drafts a real PayPal sandbox invoice. Approve it; the send agent sends it; pay it on PayPal. Then see what your payment changed: the carousel ad gains your order (its count goes 4 → 5) and its paid revenue rises by $49 on the same ad spend, the budget rule is re-run (the carousel raise stays supported, the free guide stays blocked), and the ad's creator can be paid $5 through PayPal Payouts, once per browser (up to 15 judges a day). Meta is not told: your payment came with no ad click, so the page shows it held. Undo refunds that payment through PayPal (a live run on 5 Nov: REFUNDED, docs/proof/judge-undo-2026-11-05.json); then the carousel count goes back to 4 and a payout already made shows as $5 owed back. Only your view changes; other judges see the frozen ledger.

**Claude says no:** in a recorded live run, the owner asks to raise the free guide. PayPal shows 1 paid order, so Claude refuses and recommends the carousel instead (4 paid orders, $2.73 of paid revenue per $1 of ads). The same raise sent straight to the evidence gate in code is refused live.

**A real problem:** in a Vietnamese gift shop the author runs Meta ads for, the attention video brought 69% of the chats (reported from the ad account) and 19% of the money kept after refunds; the customer-review ad brought 21% of the chats and 56% of the money. Run through Paid Signal's own ledger code, the shop's published book gives the same 705 kept orders as its accountant's workbook, and its 7 double payments (same amount, same order code) are held. The shop was paid by bank transfer, not PayPal: it is why Paid Signal exists, not a result of it.

**Check your own shop:** [/audit](https://paid-signal.thelongmarketing.workers.dev/audit) reads an Ads Manager export and a PayPal activity download in the browser, nothing uploaded. It links each payment to an ad by the tag in the order, by the customer's email in a Meta lead-form export, or by the ad name in the invoice, and says how many payments it could not link. A shop paid by bank transfer can drop its own order book instead.

**Try it, no login:** [Judge path](https://paid-signal.thelongmarketing.workers.dev/judge) · [Audit your own ads](https://paid-signal.thelongmarketing.workers.dev/audit) · [Dashboard](https://paid-signal.thelongmarketing.workers.dev) · [Proof](https://paid-signal.thelongmarketing.workers.dev/proof) · [Code](https://github.com/longtt-marketing/paid-signal)

## What it does

1. **Chat to invoice.** The revenue agent reads each lead's message and drafts the invoice with `create_invoice`; code sets the price and recipient inside the call. A person approves; the send agent sends; the chase agent reminds.
2. **Payment to ledger.** Payments are matched to ads from the capture, the invoice and signature-verified webhooks. Refunds come off; likely double payments and open disputes are held out. Transaction Search cross-checks the ledger against PayPal's history.
3. **Money back.** For a held double payment, the refund agent reads what the buyer wrote and refunds the second payment with `create_refund` once a person approves (a real sandbox refund of $49, COMPLETED). On the judge path, give live Claude the same double charge from two buyers, one who paid for a second child and one whose page froze: it declines one and refunds the other, with the refund tool simulated (held-out test: 13 of 14 right).
4. **Creator paid per paid order.** The parent who made the testimonial earns $5 per PayPal-confirmed paid order, not per lead (per lead, the free guide would pay $155 for 1 paid order). The commission agent pays through PayPal Payouts; code fixes the recipient and checks every order. A refund after a payout shows as owed back.
5. **Budget by money.** An evidence gate in code checks every number, capture id and the direction of every move; below 3 paid orders an ad's budget does not move.
6. **Back to Meta.** A PayPal-confirmed payment from a Meta ad is built as a Purchase in the form Meta documents for a website click, a Messenger chat or a lead form.

## Built with PayPal

Agent Toolkit (`create_invoice`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `create_refund`, `get_refund`, `list_disputes`, `get_dispute`), Server SDK (APIMatic), Orders v2, Invoicing v2, Payouts v1, Webhooks with signature checks, Transaction Search, JS SDK. Six Claude agents, every tool call checked against its schema; an MCP server with six read-only tools; Cloudflare Workers and KV; 178 unit tests in CI.

## AG Grid: AG Studio as the agent workspace

Three data sources (captures joined to ads on the ad key, plus sent invoices), four custom widgets with cross-filters (claimed vs confirmed, payment timeline, leads to invoices to paid orders, who still owes), and Claude running Studio's agent framework through a custom `AgLlmAdapter`. The budget agent's Studio recommendation passes the same evidence gate; the chase agent, as Studio's nudge agent, sends PayPal reminders within code limits. Dashboard → Report · AG Studio → Studio assistant.

## How we tested it

- Revenue agent, 30 held-out leads run twice: 24/24 bookings invoiced right, 20/20 not-ready leads left alone, 0/16 prompt injections invoiced (Claude plus the code checks).
- Evidence gate: 11 kinds of planted error, 100 of each, all caught; 0 of 500 good recommendations rejected.
- Refund agent, 14 held-out pairs that differ only in what the buyer wrote: 6/6 double payments refunded, 7/8 others declined.
- Real sandbox runs: a $49 double payment refunded (COMPLETED); $15 paid to the creator for 3 paid orders (SUCCESS).
- Methods and scripts behind every number: [/proof](https://paid-signal.thelongmarketing.workers.dev/proof).

## Limits

- A demo shop: its ads and leads are fictional; PayPal is sandbox; Meta gets test events. Results are on 13 sandbox payments; the 3-order floor is a safety rule, not a significance test.
- Meta accepted a lead-form Purchase for one Meta test lead; a Messenger Purchase has not been accepted with a real chat id yet.
- Gift shop: chat counts reported from the ad account, whose exports are no longer available; its order, payment and refund book is published.
- Approve records a decision; it does not change a live Meta budget. Whether a live campaign then spends better is not measured.
- Approve buttons are open in the demo; a real shop puts them behind its own login.
- Meta has no retraction: a refund after the send is subtracted here, not at Meta.

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
