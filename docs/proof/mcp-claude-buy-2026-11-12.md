# Claude as an outside buying agent (2026-11-12)

Request: Anthropic Messages API with the MCP connector pointed at the public endpoint `https://paid-signal.thelongmarketing.workers.dev/mcp`, model `claude-sonnet-5-5`, no other tools (`scripts/mcp-claude-buy.mjs`). Nobody approved the PayPal order, so no money moved.
Prompt: "You are a shopping agent using the paid-signal tools, and your agent_name is "claude-shopping-agent". Find what this shop sells, start a PayPal checkout for one item for a buyer, and check the order's PayPal status. Then ask the shop for your commission on that order. Report exactly what each tool returned."

Tool calls and what the server returned, in order:

- call `get_offer` {}
  - result: {"product":{"name":"Robotics trial class (demo shop)","price":"49.00","currency":"USD"},"terms":"The agent sends the buyer to PayPal to approve a sandbox order. A sale counts only after PayPal confirms payment. Refund and commission requests wait for the shop owner to approve them."}
- call `start_checkout` {"agent_name":"claude-shopping-agent"}
  - result: {"order_id":"2G0821841L9517406","approve_url":"https://www.sandbox.paypal.com/checkoutnow?token=2G0821841L9517406","note":"The buyer approves on PayPal; nothing is charged until then."}
- call `get_order_status` {"order_id":"2G0821841L9517406"}
  - result: {"order_id":"2G0821841L9517406","status":"PAYER_ACTION_REQUIRED"}

Claude's answer (verbatim):

> I stopped before the commission step. The buyer hasn't approved the order yet, so there's nothing to claim commission on.
> 
> 1. **`get_offer`** returned one product: "Robotics trial class (demo shop)" at 49.00 USD. The terms say a sale counts only after PayPal confirms payment. Commission requests wait for the shop owner to approve them.
> 2. **`start_checkout`** (agent_name `claude-shopping-agent`) returned:
>    - order_id: `2G0821841L9517406`
>    - approve_url: `https://www.sandbox.paypal.com/checkoutnow?token=2G0821841L9517406`
>    - note: "The buyer approves on PayPal; nothing is charged until then."
> 3. **`get_order_status`** for `2G0821841L9517406` returned the status `PAYER_ACTION_REQUIRED`. The buyer hasn't approved the order, so no payment has been captured.
> 4. **Commission request:** I did not send one. `request_commission` covers only PayPal-confirmed, unrefunded orders, and this order isn't one. The offer terms say a sale counts only after PayPal confirms payment.
> 
> The buyer needs to open the approve_url and approve the order on PayPal. Once they have, I can check the status again. If PayPal reports it as approved, I'll capture it if needed. Then I can request the commission.
