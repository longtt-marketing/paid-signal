# How Paid Signal was built with AI

Paid Signal uses AI in two different places, and this page keeps them apart.

## AI inside the product

| Part | Model | What it decides | What code decides |
|---|---|---|---|
| Revenue agent (`src/revenue.js`) | Claude, tool use | Which unpaid leads are ready to pay, and for what | Prices, sibling discount, recipient, the DRAFT invoice through PayPal's Agent Toolkit |
| Send agent (`src/sendAgent.js`) | Claude + PayPal Agent Toolkit | Calls `get_invoice` and `send_invoice` | Only the invoice a person approved, still a DRAFT, same amount, USD |
| Chase agent (`src/chaseAgent.js`) | Claude + PayPal Agent Toolkit | Who gets a reminder, and its words; calls `send_invoice_reminder` | Only sent, unpaid invoices PayPal confirms in the same run; three a run; no invented amount or discount |
| Budget agent (`src/agent.js`) | Claude | Which ads to keep, cut or grow, and why | The evidence gate: every number, evidence id and ad name checked; no budget move under 3 paid orders; one repair, then flagged |
| AG Studio agents (`web/src/agentTools.js`) | Claude through a custom `AgLlmAdapter` | Studio's own agents build and edit report widgets; custom budget and nudge agents | The same gate and limits as above, through the Worker |

Every tool call of every agent is validated against that tool's JSON Schema in code before it runs (`src/schema.js`).
The measured results, with the scripts that reproduce them, are on [/proof](https://paid-signal.thelongmarketing.workers.dev/proof).

## AI in building it

- **Claude Code** (Anthropic) wrote most of the code, the tests and the evaluation scripts, working in this repository
  under the author's direction: the author chose the problem, the product decisions, the PayPal and Meta set-up, and
  reviewed and tested each change against the live sandbox.
- **Independent review**: before each milestone, fresh Claude sessions were asked to judge the entry against the
  hackathon's five criteria without seeing earlier scores; their findings (wrong claims, privacy leaks, missing Meta
  sends) were fixed and are recorded in the commit history. ChatGPT was used as a second reviewer for strategy.
- **PayPal's server SDK** for orders and refunds is the one PayPal generates with APIMatic (`@paypal/paypal-server-sdk`);
  the agents' PayPal tools come from PayPal's Agent Toolkit (`@paypal/agent-toolkit`).
- **APIMatic's PayPal Context Plugin** (31 Oct 2026). The plugin's TypeScript skills
  ([context-plugins/plugin-marketplace](https://github.com/context-plugins/plugin-marketplace/tree/main/plugins/paypal),
  `typescript-error-handling`, `-configuration-resilience`, `-client-initialization`, `-testing`) were given to a coding
  agent together with `src/paypalSdk.js`, to check our use of the SDK against what the SDK's own source says. The skills
  are written for a newer generator than SDK 1.1.0, so each point was translated and checked against 1.1.0 with a stubbed
  transport before anything changed. What it changed in `src/paypalSdk.js` (tests: `test/paypalSdk.test.js`, no network):
  - **A capture PayPal accepted could be reported as a failure.** 1.1.0 throws `ResponseValidationError` on a 2xx whose
    body does not match its schema; the Worker then answered the buyer 400 though the money was taken. Now the 2xx body is
    used ("on a success status the call may have taken effect", error-handling skill).
  - **Errors keep PayPal's name and `debug_id`**, from the body or, when a 5xx body is empty, from the `paypal-debug-id`
    header; errors are told apart with `instanceof ApiError`, and our own 401, 403 and 429 become a 502, not the caller's 400.
  - **One retry**, on `GET` and `POST`: safe because every `POST` carries a fixed `PayPal-Request-Id`, which the SDK re-sends
    (verified in the test), so a retried capture or refund returns the first result. 1.1.0 retries nothing by default, and
    `maximumRetryWaitTime: 0` silently disables retries, so it is set explicitly. Per-attempt timeout 10 s.
  - **One client per credentials for the isolate's life**, so the OAuth token is reused instead of fetched before every
    call ("serverless: module scope, not inside the handler", client-initialization skill).
- No AI output reaches money without code checks and, for anything that sends or spends, a person's approval.
