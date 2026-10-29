# Claude as an MCP client of Paid Signal (2026-10-29)

Request: Anthropic Messages API with the MCP connector (`mcp_servers: [{ type: "url", url: "https://paid-signal.thelongmarketing.workers.dev/mcp" }]`), model `claude-sonnet-5-5`, no other tools.
Prompt: "Using the paid-signal tools: which ad brings paying PayPal customers most cheaply, and is any of its paid orders a possible duplicate?"

Tool calls Claude made: `read_paid_signal`, `list_payments`.

Answer (verbatim):

> **trial_video** is the cheapest at $32.07 per paid order ($96.20 spend, 3 paid orders, $147.00 net revenue). Its capture 7A791792B60079253 is flagged as a possible duplicate of 59A98014DG653005N, taken 216 seconds earlier. If that capture is a true duplicate, trial_video would have 2 real orders at $48.10 each, which is worse than holiday_static's $40.00.

Note: the $48.10 is Claude's own arithmetic (96.20 / 2). Answers from an outside MCP client are not passed through Paid Signal's evidence gate; the gated agents are the budget agents in the app.
