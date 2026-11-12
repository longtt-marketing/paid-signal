# Paid Signal demo video (V36, final cut)

Video V36 (2:53), built 12 Nov: https://youtu.be/CvNtEokRDf4. Every product scene was re-recorded on 12 Nov on the rebuilt judge path and
the current workspace (1920x1080; the AI Toolkit step and the customer's invoice are live calls). It opens on the identity
sentence and the real gift shop (paid by bank transfer, matched by hand), follows one payment (be the customer, PayPal
confirms), then the owner's AG Studio workspace, live PayPal sandbox money, Claude selling over MCP (the commission it asked
for only after PayPal confirmed, approved by the owner and paid by PayPal Payouts; an unearned ask refused in code) and the
budget agent's refusal. Narration is synthetic. The grid numbers are the 11 Nov eval
(docs/proof/grid-agent-eval-2026-11-11.json). Earlier cuts: V35, https://youtu.be/TcTbjGlja0A; V33,
https://youtu.be/-3opY9SNwhQ.

Built with `scripts/record.py` (cust36 tour31a tour31b tour31c tour31d money36 agent36 says36, plus paidpage from an earlier
recording), `scripts/film-plan-v36.py` and `scripts/build-film.py` (PS_FILM=scripts/film-v36.json).

| Time | Scene | Narration |
| --- | --- | --- |
| 0:00 | hook | Ad reports count chats. PayPal counts money. In a real gift shop's October, matched by hand against its bank transfers, the ad with sixty nine percent of the chats brought nineteen percent of the money. And now AI agents send buyers too. Paid Signal credits ads and agents only with sales PayPal confirms, and refunds and payouts wait for the owner's click. |
| 0:23 | 01 · Be the customer | Start as the customer. Ask to book, and the revenue agent drafts a PayPal sandbox invoice; code sets the price. The owner approves, and the send agent sends it on PayPal; the pay link opens here. |
| 0:37 | 02 · PayPal confirms | Payment happens on PayPal's own page, as the sandbox buyer; here is one a sandbox buyer paid. No real money moves. |
| 0:46 | 03 · Ads vs PayPal | Now the owner's side: the shop's workspace, in AG Studio. One click on the testimonial ad filters the page: the PayPal ledger under it, an AG Grid table, narrows to that ad, and the budget agent's suggestion waits for the owner's approval. |
| 1:02 | 04 · A payment's history | Open a payment and its history unfolds inside the grid: the ad click, the PayPal capture, and what Meta was told. |
| 1:10 | 05 · AG Grid AI Toolkit | Ask in plain words. AG Grid's AI Toolkit hands the assistant the grid's schema, and the grid groups the payments by ad and totals the money kept. We measured it: fifty nine of sixty three grouping requests came out right, a hundred and forty nine of a hundred and fifty three overall. |
| 1:29 | 06 · Read back from PayPal | The agents act too. They draft invoices, send reminders, refund double charges and pay creators, each inside a limit set in code, and every action is read back from PayPal. Here, the refund PayPal reports as completed. |
| 1:45 | 07 · Live sandbox money | These are live PayPal sandbox calls. The refund agent returned a forty nine dollar double payment, and PayPal says completed. The ad's creator is paid per confirmed order through PayPal Payouts: fifteen dollars for three paid orders. |
| 2:01 | 08 · Claude sells over MCP | Outside AI agents can sell for the shop too. Claude, connected over MCP, started a PayPal sandbox checkout, and the buyer paid on PayPal. Only after PayPal confirmed the payment did Claude ask for its commission; the owner approved, and PayPal Payouts paid five dollars to the program's sandbox account. An agent with no confirmed sale asks anyway: code says nothing is owed. |
| 2:27 | 09 · The agent says no | The owner asks to raise the free guide. Thirty one leads, one paid order: the budget agent refuses, and recommends the ad whose PayPal payments show paid orders. The same raise, sent straight to the rule in code, is refused too. |
| 2:43 | close | Paid Signal. Ads and AI agents, credited only with sales PayPal confirms. Take the guided tour yourself: no login. |
