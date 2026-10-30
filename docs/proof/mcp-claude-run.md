# Claude as an MCP client of Paid Signal (2026-10-30)

Request: Anthropic Messages API with the MCP connector (`mcp_servers: [{ type: "url", url: "https://paid-signal.thelongmarketing.workers.dev/mcp" }]`), model `claude-sonnet-5-5`, no other tools (`scripts/mcp-claude-run.mjs`).
Prompt: "Using the paid-signal tools: which ad brings paying PayPal customers most cheaply, and is any of its paid orders a possible duplicate?"

Tool calls Claude made: `read_paid_signal`, `list_payments`.

Answer (verbatim):

> **Cheapest ad:** On the tool's numbers, `holiday_static` is the cheapest at $40.00 per paid order, but that rests on a single order. `trial_video` is next at $48.10 per paid order and has more behind it.
> 
> | Ad | Spend | Paid orders | Cost per paid order |
> |---|---|---|---|
> | holiday_static | $40.00 | 1 | $40.00 |
> | trial_video | $96.20 | 2 | $48.10 |
> | parent_carousel | $71.90 | 1 | $71.90 |
> | free_guide | $118.40 | 1 | $118.40 |
> 
> - **`holiday_static`:** It had two captures. One was fully refunded, so it doesn't count as a paid order. The other had a $9 partial refund, which leaves $40 net revenue, the same as the ad spend. It's a thin result, and this ad's clicks came from source "g" while the others came from "fb".
> - **`trial_video`:** It has the most paid orders and $98 net revenue, a bit more than twice its $96.20 spend. I'd treat it as the more reliable winner.
> - **`free_guide`:** It produced the most leads (31) but only one paid order, and it is the most expensive.
> 
> **Possible duplicate:** Yes, and it's on `trial_video`.
> - Capture `7A791792B60079253` is flagged as a possible duplicate of `59A98014DG653005N`.
> - Both are $49.00 from the `fb` source, captured 216 seconds apart (10:49:51Z and 10:53:27Z on 2026-10-28).
> - The tool holds the second capture out of `trial_video`'s paid orders until it is refunded or reviewed.
> 
> The $48.10 figure counts only 2 paid orders: the first capture of the pair and a separate capture, `392527382E750334K`, from 2026-10-29.
> 
> If the flagged capture turns out to be a genuine second purchase, `trial_video` would have 3 paid orders at about $32.07 each. That would make it the cheapest ad. If it is a duplicate charge, it should be refunded, and the $48.10 stands.
> 
> I didn't run the PayPal ledger cross-check, so I haven't confirmed these captures against PayPal's own report.

Note: answers from an outside MCP client are not passed through Paid Signal's evidence gate; the gated agents are the budget agents in the app.
