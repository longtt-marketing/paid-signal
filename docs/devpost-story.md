## Paid Signal in brief

**An AG Studio workspace where Claude agents read the PayPal ledger in AG Grid, filter it on request, and draft PayPal invoices that go out only on the owner's click. Why it matters: the ad report says the free guide ad brought 31 leads; PayPal says that ad has 1 paid order.**

**For AG Grid judges, 90 seconds** ([/studio](https://paid-signal.thelongmarketing.workers.dev/studio), no login):
1. Click the Testimonial band: the page filters, the PayPal ledger (an AG Grid widget) narrows to that ad, and the budget agent's checked verdict waits for Approve.
2. Press ▸ on a payment: its trail opens inside the grid, from the ad click to PayPal to what Meta heard.
3. Open the assistant and pick **Show refunded or held payments**: AG Grid filters, sorts and flashes them. **Replay Studio building a page** shows Studio's own agents building a page (no model call).
4. Open **Agents → PayPal**: the invoices, reminders, refund and payout the agents made, each with the status PayPal returns for it, read back when the page loads.

**Agents that write, checked by PayPal:** invoice drafts, sends, reminders, a refund and a payout made by the agents, each read back from PayPal ([live count](https://paid-signal.thelongmarketing.workers.dev/api/agent-actions); what is counted: docs/AG-STUDIO.md).

**Real data:** in a Vietnamese gift shop with about $10,000 of October ads, the ad with 69% of the chats brought 19% of the money. The shop is paid by bank transfer, not PayPal; its published book reruns through the same ledger code to the same 705 orders ([see it run](https://paid-signal.thelongmarketing.workers.dev/audit#shop)).

**Links, no login:** [Judge path](https://paid-signal.thelongmarketing.workers.dev/judge) · [AG Studio report](https://paid-signal.thelongmarketing.workers.dev/studio) · [Audit your own ads](https://paid-signal.thelongmarketing.workers.dev/audit) · [Dashboard](https://paid-signal.thelongmarketing.workers.dev) · [Proof](https://paid-signal.thelongmarketing.workers.dev/proof) · [Code](https://github.com/longtt-marketing/paid-signal)

## AG Grid: AG Studio as the agent workspace

| What a judge sees | AG Grid / AG Studio API | Where to click |
|---|---|---|
| The assistant filters, sorts and flashes the PayPal ledger | `doesExternalFilterPass`, `applyColumnState`, `postSortRows`, `ensureIndexVisible`, `flashCells` | assistant: Show refunded or held payments |
| Studio's own agents build a page from one request | Studio AI harness: the lead delegates to the page, widget and data agents | assistant: Replay Studio building a page |
| A click on a band filters the page and the ledger | custom widget, `toggleCrossFilter`, `getCrossFilterSelections` | Ads vs PayPal: the Testimonial band |
| Invoice drafts and reminders as cards with Approve or Send | `defineAiTool` tools with their own `aiToolDisplay` cards | assistant: Invoice warm leads, Nudge who still owes |
| A payment's trail inside the grid | full-width rows (`isFullWidthRow`, `fullWidthCellRenderer`) | ▸ on a payment |
| Writes per agent by PayPal status, filtering the list | Studio stacked bar chart and cross-filter | Agents → PayPal |
| Recorded runs replayed through Studio's agent loop | a custom `AgLlmAdapter` for Claude | assistant: Replay a budget run |

Outside Studio only AG Grid Community is used; AG Grid's AI Toolkit is an Enterprise module, so the assistant drives the grid through Community APIs instead.

- **The assistant drives the grid:** ask "show me the payments that were refunded or are held, newest first". The show_payments_in_ledger tool makes the PayPal ledger (an AG Grid table) list payments flat, and AG Grid itself filters them (external filter), sorts them (column state), scrolls to them and flashes them; an open ▸ trail stays under its payment, and × goes back to the grouped ledger. An eval of 24 hand-written requests, run with real Claude against the live PayPal ledger data, checks both what the agent asked for and the rows AG Grid then shows: 24 of 24 (`scripts/eval-grid-agent.py`, docs/proof/grid-agent-eval-2026-11-07.json; its first run found that newest first sorted by day only, now fixed). A cell also flashes when a payment's kept amount or status changes.
- **PayPal writes that reach a customer wait for the owner's click:** the revenue agent drafts real PayPal sandbox invoices; the drafts, and the reminders the nudge agent proposes, come back into the chat as cards. No Studio tool sends an invoice or a reminder by itself (a test checks it): Approve runs the send agent, which re-reads the draft first; Send runs the chase agent, at most three unpaid invoices a run.
- **Proof, read back from PayPal:** the Agents → PayPal page lists each invoice draft, send, reminder, refund and payout an agent made (newest 40), with the status PayPal returns for it, the API it came through and each agent's limit as written in code (for example: unpaid only, at most 3 a run); a chart of writes per agent by PayPal status filters the list.
- **The money flow and the ledger under it:** each ad's band runs from its share of the ad report's leads to its share of PayPal-confirmed revenue (the free guide's 50% shrinks to 11%, the testimonial ad's 18% grows to 45%). A click filters the page, narrows the ledger and shows the budget agent's checked verdict, which the owner approves or dismisses (the decision is recorded; no live ad budget changes). In the ledger, ▸ opens a payment's trail (ad click → PayPal capture → ledger → what Meta heard), and the Decision cell sends Refund… or Separate order… to server routes that check it.
- **The report:** eight pages (three in the tab bar, one blank for your own views), tables joined by relations with measures, a ledger-paper theme and a phone layout; a test checks that Studio's totals equal the ledger's and the shop book's. The real-shop page adds an AG Grid pivot of the shop's 735 payments by ad group and week. The dashboard has the same ledger as an AG Grid table, with an AG Charts bar chart that filters it, search and CSV export; the dashboard's own ledger and chart use AG Grid and AG Charts Community only.
- **Studio's agents build a page:** ask Build a page with Studio's agents and the lead opens the blank Your page; Studio's page, widget and data agents add a value widget, a column chart of money refunded per ad and a grid of the captures, then read the numbers back.
- **Recorded runs:** the assistant opens on five real runs (budget, nudge, the real shop, invoicing, the page build). Replay a budget run and Replay Studio building a page play two of them back through Studio's own agent loop, so Studio carries out the recorded tool calls (the chart, the whole page) with no model call. How it is built: docs/AG-STUDIO.md.

Open it first: [AG Studio report](https://paid-signal.thelongmarketing.workers.dev/studio) (opens the report straight away and only reads). Screenshots and the agents' write limits: docs/AG-STUDIO.md.

## The judge path: one loop with PayPal

**On the [judge path](https://paid-signal.thelongmarketing.workers.dev/judge) (sandbox, a few minutes):**
1. **Claude says no.** The owner asks to raise the free guide; with 1 paid order, Claude refuses, and the rule in code refuses it too.
2. **You pay.** Ask to book: Claude drafts a real PayPal invoice through the Agent Toolkit. You came in from the testimonial ad (a test click), so when you pay as the sandbox buyer the ad gains your order (its count goes 4 → 5), the budget rule re-runs and Meta gets a Purchase test event.
3. **Undo.** PayPal refunds it and the count goes back to 4.

## What it does

The core loop, in three steps:

1. **Chat to PayPal invoice.** The revenue agent reads each lead's message and drafts the invoice with the Agent Toolkit's `create_invoice`; code sets the price and recipient inside the call. A person approves; the send agent sends; the chase agent reminds, within code limits.
2. **Payment to ledger.** Payments are matched to ads from the capture, the invoice and signature-verified webhooks. Refunds come off; likely double payments and open disputes are held out. Transaction Search cross-checks the ledger against PayPal's history.
3. **Budget by money.** The budget agent recommends moves from that ledger; an evidence gate in code checks every number, capture id and the direction of every move, and below 3 paid orders an ad's budget does not move. A person approves.

**Also on the same ledger:** the refund agent returns a held double payment once a person approves (a real sandbox refund of $49, COMPLETED; on the judge path, live Claude declines one of two look-alike double charges and refunds the other, held-out test 13 of 14); the ad's creator is paid $5 per PayPal-confirmed paid order through Payouts, not per lead (per lead, the free guide would pay $155 for 1 paid order); a confirmed payment from a Meta ad goes back to Meta as a Purchase; and [/audit](https://paid-signal.thelongmarketing.workers.dev/audit) runs the ledger on your own Ads Manager export and PayPal download in the browser, nothing uploaded.

## Built with PayPal

Agent Toolkit (`create_invoice`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `create_refund`, `get_refund`, `list_disputes`, `get_dispute`), Server SDK (APIMatic), Orders v2, Invoicing v2, Payouts v1, Webhooks with signature checks, Transaction Search, JS SDK. Six Claude agents, every tool call checked against its schema; an MCP server with six read-only tools; Cloudflare Workers and KV; 198 unit tests in CI.

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
