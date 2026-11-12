# Claude as an outside selling agent, end to end (2026-11-12)

Anthropic Messages API with the MCP connector pointed at the public endpoint `https://paid-signal.thelongmarketing.workers.dev/mcp`, model `claude-sonnet-5-5`, no other tools (`scripts/mcp-claude-sale.mjs`). Between the two phases a person approved the order on PayPal's sandbox page as the sandbox buyer. After phase 2 the owner approves the commission on /judge, and PayPal Payouts pays it to the program's sandbox account.

## Phase: start (08:08:40 UTC)

Prompt: "You are a shopping agent selling for this shop through the paid-signal tools. Your agent_name is "claude-sales-agent". A buyer asked you for one trial class. Read the offer, start a PayPal checkout for the buyer, and give the approve link. Report exactly what each tool returned."

- call `get_offer` {}
  - result: {"product":{"name":"Robotics trial class (demo shop)","price":"49.00","currency":"USD"},"terms":"The agent sends the buyer to PayPal to approve a sandbox order. A sale counts only after PayPal confirms payment. Refund and commission requests wait for the shop owner to approve them."}
- call `start_checkout` {"agent_name":"claude-sales-agent"}
  - result: {"order_id":"4GE03731FN323114B","approve_url":"https://www.sandbox.paypal.com/checkoutnow?token=4GE03731FN323114B","note":"The buyer approves on PayPal; nothing is charged until then."}

Claude's answer (verbatim):

> **Offer (from `get_offer`):**
> - Product: Robotics trial class (demo shop)
> - Price: 49.00 USD
> - Terms: The buyer approves a sandbox order on PayPal. A sale counts only after PayPal confirms payment. Refund and commission requests wait for the shop owner to approve them.
> 
> **Checkout (from `start_checkout`, agent_name "claude-sales-agent"):**
> - Order ID: 4GE03731FN323114B
> - Approve link: https://www.sandbox.paypal.com/checkoutnow?token=4GE03731FN323114B
> - Tool note: "The buyer approves on PayPal; nothing is charged until then."
> 
> The buyer needs to open the link and approve the payment on PayPal. I haven't checked the order status, so nothing is confirmed paid yet. After the buyer approves, I can check the order status for you.

## Phase: finish (08:10:37 UTC)

Prompt: "You are the shopping agent "claude-sales-agent" for this shop, using the paid-signal tools. Earlier you started PayPal order 4GE03731FN323114B for a buyer, and the buyer says they have approved it on PayPal. Check the order's status. If PayPal confirms the payment, ask the shop for your commission on it. Report exactly what each tool returned."

- call `get_order_status` {"order_id":"4GE03731FN323114B"}
  - result: {"order_id":"4GE03731FN323114B","status":"COMPLETED","capture_id":"5NC08720EW4665251","amount":"49.00","currency":"USD"}
- call `request_commission` {"agent_name":"claude-sales-agent"}
  - result: {"id":"AR-b779fd5e-9cf2-46e6-a5b9-f4c909f207a4","status":"pending","amount":"5.00","currency":"USD","message":"Request sent; waits for the owner."}

Claude's answer (verbatim):

> PayPal confirms the order is completed, so I'll request the commission.
> Here is what each tool returned.
> 
> **Order status** (`get_order_status` for 4GE03731FN323114B):
> - Status: COMPLETED
> - Capture ID: 5NC08720EW4665251
> - Amount: 49.00 USD
> 
> **Commission request** (`request_commission` for agent "claude-sales-agent"):
> - Request ID: AR-b779fd5e-9cf2-46e6-a5b9-f4c909f207a4
> - Status: pending
> - Amount: 5.00 USD
> - Message: "Request sent; waits for the owner."
> 
> PayPal confirmed the payment, so I sent the request. The owner hasn't approved it yet, and no commission has been paid. I can check the request's status later with `get_request`.

## Owner approval and PayPal Payouts

The owner pressed Approve on /judge (Outside agents). `get_request` for AR-b779fd5e-9cf2-46e6-a5b9-f4c909f207a4 then returned:

> {"status":"approved","kind":"commission","agent_name":"claude-sales-agent","amount":"5.00","capture_ids":["5NC08720EW4665251"],"decided_at":"2026-11-12T08:11:27.874Z","paypal":{"batch_id":"FYYKYSK29SJTS","status":"SUCCESS"}}

So: Claude started PayPal order 4GE03731FN323114B; the sandbox buyer paid $49 (capture 5NC08720EW4665251, COMPLETED); Claude asked for its commission only after PayPal confirmed it; the owner approved; PayPal Payouts paid $5 to the program's sandbox account (batch FYYKYSK29SJTS, SUCCESS). The agent order stays in the agent channel and never enters the ad ledger.
