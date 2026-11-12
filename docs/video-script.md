# Paid Signal demo video (V35, final cut)

Video V35 (2:55), built 12 Nov: https://youtu.be/TcTbjGlja0A. It opens on the identity sentence and the real gift shop (paid by bank
transfer, matched by hand), shows the guided tour on /studio (recorded live on 11 and 12 Nov at 1920x1080; the AI Toolkit
step is a live model call), live PayPal sandbox money, the outside AI agent over MCP (a live sandbox checkout, the
commission the owner approved and PayPal Payouts paid, an unearned commission refused in code; recorded 12 Nov), the
judge path scenes (recorded 5 to 7 Nov) and a close with the link. Narration is synthetic. The grid number is the 11 Nov
eval (docs/proof/grid-agent-eval-2026-11-11.json). Earlier cuts: V33, https://youtu.be/-3opY9SNwhQ; V30,
https://youtu.be/Fw7SqbTZCmo.

Built with `scripts/record.py` (tour31a tour31b tour31c tour31d agent33, plus money23 cust23 says23 paidpage from earlier
recordings), `scripts/film-plan-v35.py` and `scripts/build-film.py` (PS_FILM=scripts/film-v35.json).

| Time | Scene | Narration |
| --- | --- | --- |
| 0:00 | hook | Ad reports count chats. PayPal counts money. In a real gift shop's October, matched by hand against its bank transfers, the ad with sixty nine percent of the chats brought nineteen percent of the money. And now AI agents send buyers too. Paid Signal credits ads and agents only with sales PayPal confirms, and refunds and payouts wait for the owner's click. |
| 0:23 | 01 · Ads vs PayPal | This is the demo shop, in the PayPal sandbox. One button starts a guided tour. One click on the testimonial ad filters AG Studio: the PayPal ledger under it, an AG Grid table, narrows to that ad, and the budget agent's suggestion waits for the owner's approval. |
| 0:41 | 02 · A payment's history | Open a payment and its history unfolds inside the grid: the ad click, the PayPal capture, and what Meta was told. |
| 0:49 | 03 · AG Grid AI Toolkit | Ask in plain words. AG Grid's AI Toolkit hands the assistant the grid's schema, and the grid groups the payments by ad and totals the money kept. We measured it: a hundred and forty nine of a hundred and fifty three plain-word requests came out right. |
| 1:05 | 04 · Read back from PayPal | The agents act too. They draft invoices, send reminders, refund double charges and pay creators, each inside a limit set in code, and every action is read back from PayPal. Here, the refund PayPal reports as completed. |
| 1:21 | 05 · Live sandbox money | These are live PayPal sandbox calls. The refund agent returned a forty nine dollar double payment, and PayPal says completed. The ad's creator is paid per confirmed order through PayPal Payouts: fifteen dollars for three paid orders. |
| 1:38 | 06 · An outside agent buys | Outside AI agents can sell for the shop too. Any agent connects over MCP and starts a PayPal sandbox checkout; the buyer approves on PayPal. When PayPal confirmed one, the agent asked for its commission, the owner approved, and PayPal Payouts paid five dollars to the program's sandbox account, kept apart from the ad ledger. An agent with no confirmed sale asks anyway: code says nothing is owed. |
| 2:05 | 07 · Be the customer | On the judge path, you are the customer. Ask to book, and the revenue agent drafts a real PayPal sandbox invoice; code sets the price. You approve, and the send agent sends it on PayPal; the pay link opens here. |
| 2:21 | 08 · PayPal confirms | Payment happens on PayPal's own page, as the sandbox buyer; here is one a sandbox buyer paid. No real money moves. |
| 2:29 | 09 · The agent says no | The owner asks to raise the free guide. Thirty one leads, one paid order: the budget agent refuses, and recommends the ad whose PayPal payments show paid orders. The same raise, sent straight to the rule in code, is refused too. |
| 2:45 | close | Paid Signal. Ads and AI agents, credited only with sales PayPal confirms. Take the guided tour yourself: no login. |
