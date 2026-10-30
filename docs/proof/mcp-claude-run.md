# Claude as an MCP client of Paid Signal (2026-10-30)

Request: Anthropic Messages API with the MCP connector (`mcp_servers: [{ type: "url", url: "https://paid-signal.thelongmarketing.workers.dev/mcp" }]`), model `claude-sonnet-5-5`, no other tools (`scripts/mcp-claude-run.mjs`).
Prompt: "Using the paid-signal tools: which ad brings paying PayPal customers most cheaply, and is any of its paid orders a possible duplicate?"

Tool calls Claude made: `read_paid_signal`, `list_payments`.

Answer (verbatim):

> **The cheapest ad is parent_carousel, at $35.95 per paid order.** That is $71.90 of spend across 2 paid orders. None of its paid orders is flagged as a possible duplicate.
> 
> | Ad | Spend | Paid orders | Cost per paid order |
> |---|---|---|---|
> | parent_carousel | $71.90 | 2 | $35.95 |
> | holiday_static | $40.00 | 1 | $40.00 |
> | trial_video | $96.20 | 2 | $48.10 |
> | free_guide | $118.40 | 1 | $118.40 |
> 
> - **Refunded capture:** parent_carousel had a third capture, `19L75638WN729671C`. It came 12 seconds after another $49 capture and was fully refunded. It isn't counted as a paid order, and the tool didn't flag it as a duplicate. Its two counted orders are `7G581478P1052730P` and `3GY34151GC185303G`.
> - **Possible duplicate on another ad:** The flagged duplicate is on trial_video. Capture `7A791792B60079253` is a $49 payment made 216 seconds after `59A98014DG653005N`. If it is a real duplicate, trial_video has only 1 genuine order. Its cost per order would then be $96.20, not $48.10. That would not change which ad is cheapest.
> - **Small samples:** Each ad has only 1 or 2 paid orders, so the ranking could easily change with a few more sales.
> - **Not checked against PayPal:** I haven't cross-checked the ledger against PayPal Transaction Search, so I can't say whether the ledger is complete.

Note: answers from an outside MCP client are not passed through Paid Signal's evidence gate; the gated agents are the budget agents in the app.
