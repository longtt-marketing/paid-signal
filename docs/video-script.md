# Paid Signal demo video (V37, final cut)

Video V37 (2:55), built 12 Nov: https://youtu.be/Xp4Ewz4ri60. One payment end to end, recorded 12 Nov on the live app: the customer asks to book,
Claude drafts PayPal sandbox invoice #0066, the owner approves, a sandbox buyer pays it on PayPal's page, the testimonial ad goes
from 4 to 5 paid orders, and Undo refunds it through PayPal. Then the owner's AG Studio workspace, live PayPal sandbox money,
Claude selling over MCP (its commission asked only after PayPal confirmed, approved by the owner, paid by PayPal Payouts) and the
budget agent's refusal. Each chapter opens as a tilted card that settles flat. Narration is synthetic. The AI Toolkit figure is
the 11 Nov eval (docs/proof/grid-agent-eval-2026-11-11.json). Earlier cuts: V36, https://youtu.be/CvNtEokRDf4; V35,
https://youtu.be/TcTbjGlja0A.

Built with `scripts/record.py` (cust37 paid37 impact37 tour31a tour31c tour31d money36 agent36 says36), `scripts/film-plan-v37.py`
and `scripts/build-film.py` (PS_FILM=scripts/film-v37.json PS_3D=1).

| Time | Scene | Narration |
| --- | --- | --- |
| 0:00 | hook | Ad reports count chats. PayPal counts money. In a real gift shop's October, matched by hand against its bank transfers, the ad with sixty nine percent of the chats brought nineteen percent of the money. And now AI agents send buyers too. Paid Signal credits ads and agents only with sales PayPal confirms, and refunds and payouts wait for the owner's click. |
| 0:23 | 01 · Be the customer | Start as the customer. Ask to book, and the revenue agent drafts a PayPal sandbox invoice; code sets the price. The owner approves, and the send agent sends it on PayPal; the pay link opens here. |
| 0:37 | 02 · Paid on PayPal | The buyer pays on PayPal's own page, as a sandbox buyer, and PayPal marks the invoice paid. No real money moves. |
| 0:46 | 03 · The right ad gets the credit | Back in Paid Signal, PayPal has confirmed the payment: the testimonial ad goes from four paid orders to five, and its return per ad dollar rises. Press Undo, and PayPal refunds the forty nine dollars: the count goes back to four. |
| 1:02 | 04 · Ads vs PayPal | Now the owner's side: the shop's workspace, in AG Studio. One click on the testimonial ad filters the page: the PayPal ledger under it, an AG Grid table, narrows to that ad, and the budget agent's suggestion waits for the owner's approval. |
| 1:19 | 05 · AG Grid AI Toolkit | Ask in plain words. AG Grid's AI Toolkit hands the assistant the grid's schema, and the grid groups the payments by ad and totals the money kept. Measured: fifty nine of sixty three grouping requests came out right. |
| 1:34 | 06 · Read back from PayPal | The agents act too. They draft invoices, send reminders, refund double charges and pay creators, each inside a limit set in code, and every action is read back from PayPal. Here, the refund PayPal reports as completed. |
| 1:51 | 07 · Live sandbox money | The refund agent returned a forty nine dollar double payment, and PayPal says completed. The ad's creator is paid per confirmed order through PayPal Payouts: fifteen dollars for three paid orders. |
| 2:05 | 08 · Claude sells over MCP | Outside AI agents can sell for the shop too. Claude, connected over MCP, started a PayPal sandbox checkout, and the buyer paid on PayPal. Only after PayPal confirmed the payment did Claude ask for its commission; the owner approved, and PayPal Payouts paid five dollars to the program's sandbox account. An agent with no confirmed sale asks anyway: code says nothing is owed. |
| 2:30 | 09 · The agent says no | The owner asks to raise the free guide. Thirty one leads, one paid order: the budget agent refuses, and recommends the ad whose PayPal payments show paid orders. The same raise, sent straight to the rule in code, is refused too. |
| 2:46 | close | Paid Signal. Ad reports count chats. PayPal counts money. Pay forty nine dollars as the customer yourself: no login. |
