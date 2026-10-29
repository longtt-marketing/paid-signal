# Add Paid Signal to your own shop

Four steps for a shop that already takes PayPal with Orders v2. Everything below runs in the PayPal sandbox first.

## 1. Keep the ad click on the landing page

Ad platforms put a click id on the landing URL (`fbclid` for Meta, `gclid` for Google). Keep it for the visit:

```html
<script>
  const q = new URLSearchParams(location.search);
  const click = q.get("fbclid") ? { source: "fb", click_id: q.get("fbclid") }
              : q.get("gclid") ? { source: "g", click_id: q.get("gclid") } : null;
  if (click) sessionStorage.setItem("ps-click", JSON.stringify({ ...click, ad: q.get("utm_content") || "unknown", clicked_at: Date.now() }));
</script>
```

Set `utm_content` to the ad's key in each ad's URL so the click names its ad.

## 2. Put the click in the order's `custom_id`

When your server creates the PayPal order, pack the click into `custom_id` (127 characters at most) and give the
checkout one `PayPal-Request-Id`, so pressing Pay twice returns the same order:

```js
import { packClick } from "./src/ledger.js";

const customId = packClick({ ad: click.ad, source: click.source, clickId: click.click_id, clickedAt: click.clicked_at });
await paypal.createOrder({ amount: "49.00", currency: "USD", customId, requestId: `chk-${checkoutIntentId}` /* , … */ });
```

For invoices, put the same packed string in the invoice's private memo (`detail.memo`).

## 3. Register the webhook

```bash
python scripts/register-webhook.py https://<your-worker>/api/webhook
npx wrangler secret put PAYPAL_WEBHOOK_ID   # the id the script prints
```

Every delivery is checked with `verify-webhook-signature`. Captures, refunds and paid invoices land in the ledger,
attributed to the ad in `custom_id`.

## 4. Load your ad export

Export ad name, amount spent and results from Meta Ads Manager or Google Ads as CSV and paste it into
**Your ad export** on the dashboard. Paid Signal maps the common column names (`Ad name`, `Amount spent (USD)`,
`Results`, `Cost`, `Conversions`). Each ad then shows the leads it claims next to the orders PayPal confirms.

## What you get

- Paid orders and net revenue per ad, refunds and duplicates handled.
- Meta Conversions API `Purchase` events (deduplicated by `paypal:<capture>`) and Google offline conversion rows,
  ready to send with your own tokens. This demo previews them and does not send them.
- A budget agent whose numbers are checked against the reconciliation, and a Studio assistant that drafts PayPal
  invoices for warm leads, which a person sends.
