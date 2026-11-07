## Paid Signal in brief

**Your ad report says the free guide brought 31 leads. PayPal says 1 paid order. Paid Signal's AI agents act on PayPal's number, inside AG Studio, and write to PayPal only within limits set in code.**

**For AG Grid judges, 90 seconds** ([/studio](https://paid-signal.thelongmarketing.workers.dev/studio), no login):
1. Click the Testimonial band: the page filters, the PayPal ledger (an AG Grid widget) narrows to that ad, and the budget agent's checked verdict waits for Approve.
2. Press ▸ on a payment: its trail opens inside the grid, from the ad click to PayPal to what Meta heard.
3. Open **Agents → PayPal**: the invoices, reminders, refund and payout the agents made, each with the status PayPal returns for it, read back when the page loads.

**One loop, on the [judge path](https://paid-signal.thelongmarketing.workers.dev/judge) (sandbox, a few minutes):**
1. **Claude says no.** The owner asks to raise the free guide; with 1 paid order, Claude refuses, and the rule in code refuses it too.
2. **You pay.** Ask to book: Claude drafts a real PayPal invoice through the Agent Toolkit. You came in from the testimonial ad (a test click), so when you pay as the sandbox buyer the ad gains your order (its count goes 4 → 5), the budget rule re-runs and Meta gets a Purchase test event.
3. **Undo.** PayPal refunds it and the count goes back to 4.

**Agents that write, checked by PayPal:** invoice drafts, sends, reminders, a refund and a payout made by the agents, each read back from PayPal ([live count](https://paid-signal.thelongmarketing.workers.dev/api/agent-actions); what is counted: docs/AG-STUDIO.md).

**Real data:** in a Vietnamese gift shop with about $10,000 of October ads, the ad with 69% of the chats brought 19% of the money. The shop is paid by bank transfer, not PayPal; its published book reruns through the same ledger code to the same 705 orders ([see it run](https://paid-signal.thelongmarketing.workers.dev/audit#shop)).

**Also:** double payments refunded, the ad's creator paid per paid order, Meta told only what PayPal confirms, /audit for your own files, AG Studio where the agents act on PayPal, and a Verify with PayPal button that reads every ledger payment back from PayPal at click time. A person approves every money move; code holds every amount.

**Links, no login:** [Judge path](https://paid-signal.thelongmarketing.workers.dev/judge) · [AG Studio report](https://paid-signal.thelongmarketing.workers.dev/studio) · [Audit your own ads](https://paid-signal.thelongmarketing.workers.dev/audit) · [Dashboard](https://paid-signal.thelongmarketing.workers.dev) · [Proof](https://paid-signal.thelongmarketing.workers.dev/proof) · [Code](https://github.com/longtt-marketing/paid-signal)

## What it does

The core loop, in three steps:

1. **Chat to PayPal invoice.** The revenue agent reads each lead's message and drafts the invoice with the Agent Toolkit's `create_invoice`; code sets the price and recipient inside the call. A person approves; the send agent sends; the chase agent reminds, within code limits.
2. **Payment to ledger.** Payments are matched to ads from the capture, the invoice and signature-verified webhooks. Refunds come off; likely double payments and open disputes are held out. Transaction Search cross-checks the ledger against PayPal's history.
3. **Budget by money.** The budget agent recommends moves from that ledger; an evidence gate in code checks every number, capture id and the direction of every move, and below 3 paid orders an ad's budget does not move. A person approves.

**Also on the same ledger:** the refund agent returns a held double payment once a person approves (a real sandbox refund of $49, COMPLETED; on the judge path, live Claude declines one of two look-alike double charges and refunds the other, held-out test 13 of 14); the ad's creator is paid $5 per PayPal-confirmed paid order through Payouts, not per lead (per lead, the free guide would pay $155 for 1 paid order); a confirmed payment from a Meta ad goes back to Meta as a Purchase; and [/audit](https://paid-signal.thelongmarketing.workers.dev/audit) runs the ledger on your own Ads Manager export and PayPal download in the browser, nothing uploaded.

## Built with PayPal

Agent Toolkit (`create_invoice`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `create_refund`, `get_refund`, `list_disputes`, `get_dispute`), Server SDK (APIMatic), Orders v2, Invoicing v2, Payouts v1, Webhooks with signature checks, Transaction Search, JS SDK. Six Claude agents, every tool call checked against its schema; an MCP server with six read-only tools; Cloudflare Workers and KV; 198 unit tests in CI.

## AG Grid: AG Studio as the agent workspace

- **Agents that write to PayPal, not only read:** from Studio's assistant the revenue agent drafts real PayPal sandbox invoices and the nudge agent sends PayPal reminders within code limits. The drafts come back into the chat as cards; the agent cannot approve them, and only the owner's Approve sends one, after the send agent checks it.
- **Proof, read back from PayPal:** Studio's second page, Agents → PayPal, lists each invoice draft, send, reminder (the latest per invoice; each one kept for reminders sent after the 7 Nov 10:40 UTC update), refund and payout an agent made in the shared demo ledger (newest 40), each read back from PayPal when the page loads (cached ten minutes), with PayPal's status and the API it came through.
- **A 60-second path:** /studio opens on four widgets: the money flow, the PayPal ledger under it, then Who still owes beside the latest agent actions read back from PayPal. Press "Nudge who is waiting" and confirm; when the chase agent sends reminders, the page reads PayPal again within seconds, so the new reminders come first. The per-ad detail is under More pages.
- **Studio Agent Framework:** Claude through a custom `AgLlmAdapter`; two custom agents (budget, nudge) delegate to Studio's page agent, and the budget agent's answer passes the same evidence gate as the app. Every Paid Signal tool has its own chat card.
- **Widgets and report:** seven custom widgets, three with their own settings in Studio's edit panel. The lead one is a money flow: each ad's band runs from its share of the ad report's leads to its share of PayPal-confirmed revenue, so the free guide's band shrinks from 50% to 11% while the testimonial ad's grows from 18% to 45%. A click on a band filters the whole page and shows the budget agent's checked verdict for that ad, which the owner approves or dismisses (the decision is recorded; no live ad budget changes). A click on an ad in the other widgets filters the page too, and the Who still owes widget's Nudge button sends PayPal reminders after the owner's click. Eight pages: three in the tab bar (Ads vs PayPal, Agents → PayPal, and Real shop: October with the gift shop's three ad groups and 735 payments) and five under More pages, among them a blank one for your own views; a ledger-paper theme and a phone layout. A test checks that Studio's totals equal the ledger's and the shop book's.
- **The PayPal ledger inside Studio:** a custom widget right under the money flow, an AG Grid table (Community) of every PayPal payment grouped by ad. A click on a band narrows it to that ad; a click on an ad's subtotal row filters the page back and shows that ad's verdict. ▸ on a payment opens its trail in the grid: ad click → PayPal capture → ledger → what Meta heard. Each payment has the owner's Decision (Refund… or Separate order…), sent to the same server routes as the dashboard.
- **AG Grid tables:** on the dashboard the PayPal ledger is an AG Grid table (Community; its grouping, subtotal and trail rows are built in our code, no Enterprise features), grouped by ad with a subtotal row per ad (money kept, held, refunded), a pinned total row that follows the filters, and CSV export. Above it an AG Charts bar chart (Community) shows money kept, held and refunded per ad; a click on a bar filters the grid to that ad. The last column is the owner's Decision, edited in the cell: Refund… on a paid payment, or Separate order… on a held double payment; each calls the server's refund or separate-order route, which checks it (on the demo's seeded payments a refund is only previewed). ▸ opens a payment's trail there too. Both ledger tables have a search box and, on each ad's subtotal row (wider screens), an "Ad report → PayPal" cell (for example 31 leads → 1 paid); a payment under an open PayPal dispute is held out of the money kept. Both export CSV with the refunded amount, why a payment is held, the capture date and the click source. Ungroup to sort and filter every payment, see why a payment is held, or open a payment's money trail.
- **The real shop in a pivot:** Studio's real-shop page adds an AG Grid pivot of the shop's whole published book (735 payments): ad group and kind of payment by week, kept orders and money kept.
- **Recorded runs:** the assistant opens on four real runs (budget, nudge, the real shop, and invoicing, where the revenue agent drafted one PayPal invoice, INV2-2EJR-A4ZY-BNZU-XVYK, now on the Agents → PayPal page, and flagged a lead's prompt injection), and Replay a budget run plays one back through Studio's own agent loop, so Studio carries out the recorded tool calls (the page agent adds the chart) with no model call. How it is built: docs/AG-STUDIO.md.

Open it first: [AG Studio report](https://paid-signal.thelongmarketing.workers.dev/studio) (opens the report straight away and only reads). Screenshots and the agents' write limits: docs/AG-STUDIO.md.

## How we tested it

- Accessibility: axe-core 4.10.2 (WCAG 2.1 A and AA rules) reported 0 violations on nine pages of the live site at 390 px and 1440 px wide on 2026-11-07 (docs/proof/axe-2026-11-07.json, scripts/axe-check.py); the money-flow bands work from the keyboard.
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
- Judge path: your ad click is a test click made in your browser, and Meta gets test events only; only your view changes; the creator payout runs once per browser, up to 15 judges a day. A live run on 6 Nov: Meta received the Purchase test event (events_received 1), then Undo ended REFUNDED (docs/proof/judge-click-meta-2026-11-06.json).
- Approve records a decision; it does not change a live Meta budget. Whether a live campaign then spends better is not measured.
- Approve buttons are open in the demo; a real shop puts them behind its own login.
- Meta has no retraction: a refund after the send is subtracted here, not at Meta.
