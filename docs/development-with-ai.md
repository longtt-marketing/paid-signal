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
- No AI output reaches money without code checks and, for anything that sends or spends, a person's approval.
