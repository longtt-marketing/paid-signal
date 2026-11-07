# Paid Signal demo video (V30)

Video V30: https://youtu.be/Fw7SqbTZCmo (2:40). AG Studio first: three Studio scenes, then the judge path. Narration is synthetic; screens are
the live demo recorded on 7 Nov at 1920x1080, played faster in places. The Studio assistant scenes are recorded runs that open
or replay without calling a model (the invoicing run itself was recorded live on 7 Nov and drafted sandbox invoice
INV2-2EJR-A4ZY-BNZU-XVYK). The agent-action count (36 of 36) is the live count on the day of recording. The refund and payout in
scene 07 are real sandbox money; the gift shop in scene 08 is paid by bank transfer, not PayPal.

Built with `scripts/record.py` (studio30a studio30b studio30c, plus cust23 says23 money23 shop23 and paidpage from earlier
recordings), `scripts/film-plan-v30.py` and `scripts/build-film.py` (PS_FILM=scripts/film-v30.json).

| Time | Scene | Narration |
| --- | --- | --- |
| 0:00 | hook | In this sandbox demo, the ad report gives the free guide thirty one leads. PayPal shows one paid order. Paid Signal lets AI agents act on the second number, inside AG Studio. |
| 0:14 | 01 · AG Studio investigates | Judges land on AG Studio. One click on the testimonial ad filters the page, and the budget agent's verdict, checked by a rule in code, waits for the owner's approval. Under it, the PayPal ledger is an AG Grid table, narrowed to that ad: eleven leads, four paid. Open a payment for its trail, from the ad click to PayPal to what Meta heard, and decide it right in the cell; the server checks every decision. |
| 0:42 | 02 · Agents write, PayPal confirms | These agents do not only read. They draft invoices, send reminders, refund and pay out on PayPal, each inside a limit set in code, and Paid Signal reads each PayPal object back: thirty six of thirty six found today. The assistant opens on a recorded run where the revenue agent drafts a real sandbox invoice for the one lead ready to book, and flags a prompt injection. |
| 1:07 | 03 · Replayed in Studio's agent loop | Replay a budget run plays a recorded run back through Studio's own agent loop, with no model call. The budget agent's proposal passes the evidence gate on its second try, Studio's page agent adds the chart, and its widget agent fills it in. |
| 1:23 | 04 · Be the customer | On the judge path, you are the customer. Ask to book, and Claude drafts a real PayPal sandbox invoice; code sets the price. You approve, and the send agent sends it on PayPal; the pay link opens here. |
| 1:38 | 05 · PayPal confirms | Payment happens on PayPal's own page, as the sandbox buyer; here is one a sandbox buyer paid. No real money moves. |
| 1:47 | 06 · Claude says no | The owner asks to raise the free guide. Thirty one leads, one paid order: Claude refuses, and recommends the ad PayPal says is paying. The same raise, sent straight to the rule in code, is refused too. |
| 2:01 | 07 · Real refund, real payout | In the PayPal sandbox, the refund agent returned a double payment, and PayPal says completed. The ad's creator is paid per paid order through PayPal Payouts: fifteen dollars for three paid orders. |
| 2:16 | 08 · A real shop | And the problem is real. In a gift shop the author runs ads for, the attention video brought sixty nine percent of the chats, but nineteen percent of the money. That shop is paid by bank transfer, not PayPal, and its own book, run through the same ledger code, gives the same seven hundred and five orders. |
| 2:34 | close | Paid Signal. AI actions, backed by PayPal. Try it live. |
