# Paid Signal demo video (V32, final cut)

Video V32 (2:23), built 11 Nov to the presentation playbook: https://youtu.be/DxKjXhwEfHw. It opens on the identity
sentence and the real gift shop (paid by bank transfer, matched by hand), shows the product from 0:21 (the guided tour on
/studio, recorded live on 11 Nov at 1920x1080; the AI Toolkit step is a live model call), then real sandbox money, the
judge path scenes (recorded 5 to 7 Nov) and a close with the link. Narration is synthetic. The grid number is the 11 Nov
eval (docs/proof/grid-agent-eval-2026-11-11.json). Earlier cut: V30, https://youtu.be/Fw7SqbTZCmo.

Built with `scripts/record.py` (tour31a tour31b tour31c tour31d, plus money23 cust23 says23 paidpage from earlier
recordings), `scripts/film-plan-v32.py` and `scripts/build-film.py` (PS_FILM=scripts/film-v32.json).

| Time | Scene | Narration |
| --- | --- | --- |
| 0:00 | hook | Ad reports count chats. PayPal counts money. In a real gift shop's October, matched by hand against its bank transfers, the ad with sixty nine percent of the chats brought nineteen percent of the money. Paid Signal does that match on PayPal, and AI agents prepare the money work for the owner to approve, inside AG Grid. |
| 0:21 | 01 · Ads vs PayPal | This is the demo shop, in the PayPal sandbox. One button starts a guided tour. One click on the testimonial ad filters AG Studio: the PayPal ledger under it, an AG Grid table, narrows to that ad, and the budget agent's suggestion waits for the owner's approval. |
| 0:39 | 02 · A payment's history | Open a payment and its history unfolds inside the grid: the ad click, the PayPal capture, and what Meta was told. |
| 0:47 | 03 · AG Grid AI Toolkit | Ask in plain words. AG Grid's AI Toolkit hands the assistant the grid's schema, and the grid groups the payments by ad and totals the money kept. We measured it: a hundred and forty nine of a hundred and fifty three plain-word requests came out right. |
| 1:03 | 04 · Read back from PayPal | The agents act too. They draft invoices, send reminders, refund double charges and pay creators, each inside a limit set in code, and every action is read back from PayPal. Here, the refund PayPal reports as completed. |
| 1:19 | 05 · Real sandbox money | This is real sandbox money. The refund agent returned a forty nine dollar double payment, and PayPal says completed. The ad's creator is paid per confirmed order through PayPal Payouts: fifteen dollars for three paid orders. |
| 1:35 | 06 · Be the customer | On the judge path, you are the customer. Ask to book, and the revenue agent drafts a real PayPal sandbox invoice; code sets the price. You approve, and the send agent sends it on PayPal; the pay link opens here. |
| 1:51 | 07 · PayPal confirms | Payment happens on PayPal's own page, as the sandbox buyer; here is one a sandbox buyer paid. No real money moves. |
| 1:59 | 08 · The agent says no | The owner asks to raise the free guide. Thirty one leads, one paid order: the budget agent refuses, and recommends the ad whose PayPal payments show paid orders. The same raise, sent straight to the rule in code, is refused too. |
| 2:15 | close | Paid Signal. Ad reports count chats; PayPal counts money. Take the guided tour yourself: no login. |
