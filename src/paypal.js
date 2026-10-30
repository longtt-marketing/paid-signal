// PayPal REST (sandbox by default). Every call goes through one token cache and returns parsed JSON or throws
// an Error carrying PayPal's status, name and debug_id so the UI can show what PayPal actually said.

export function paypal({ clientId, secret, base = "https://api-m.sandbox.paypal.com", fetchImpl = fetch }) {
  let token = null, expires = 0;

  async function auth() {
    if (token && Date.now() < expires - 60000) return token;
    const res = await fetchImpl(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: "Basic " + btoa(`${clientId}:${secret}`), "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const body = await res.json();
    if (!res.ok) throw fail(res.status, body);
    token = body.access_token; expires = Date.now() + body.expires_in * 1000;
    return token;
  }

  async function call(path, { method = "POST", body, requestId } = {}) {
    const res = await fetchImpl(base + path, {
      method,
      headers: {
        authorization: `Bearer ${await auth()}`, "content-type": "application/json", prefer: "return=representation",
        // idempotency: a retried create or capture with the same id cannot charge twice
        ...(requestId ? { "paypal-request-id": requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw fail(res.status, json);
    return json;
  }

  return {
    /** One-item order; the ad click travels in custom_id (max 127 chars) so the capture can be traced to the ad. */
    createOrder({ amount, currency = "USD", description, customId, invoiceId, returnUrl, cancelUrl, requestId }) {
      return call("/v2/checkout/orders", {
        requestId,
        body: {
          intent: "CAPTURE",
          purchase_units: [{ amount: { currency_code: currency, value: amount }, description, custom_id: customId, invoice_id: invoiceId }],
          payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" } } },
        },
      });
    },
    getOrder: (id) => call(`/v2/checkout/orders/${encodeURIComponent(id)}`, { method: "GET" }),
    captureOrder: (id, requestId) => call(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { requestId, body: {} }),
    refundCapture: (captureId, { amount, currency = "USD", requestId } = {}) =>
      call(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { requestId, body: amount ? { amount: { value: amount, currency_code: currency } } : {} }),
    /** Asks PayPal whether a webhook delivery is genuine; never trust the body without this. */
    async verifyWebhook({ headers, event, webhookId }) {
      const h = (k) => headers.get(k);
      const out = await call("/v1/notifications/verify-webhook-signature", {
        body: {
          auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
          transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"),
          webhook_id: webhookId, webhook_event: event,
        },
      });
      return out.verification_status === "SUCCESS";
    },
    /** Draft invoice: nothing reaches the customer until send. The ad click rides in detail.memo, which only the merchant sees. */
    createDraftInvoice({ email, name, item, amount, currency = "USD", reference, note, business }) {
      return call("/v2/invoicing/invoices", {
        requestId: crypto.randomUUID(),
        body: {
          // memo is visible to the merchant only, so the click id never shows on the customer's invoice
          detail: { currency_code: currency, reference: "Trial class booking", memo: reference, note, payment_term: { term_type: "DUE_ON_RECEIPT" } },
          invoicer: { business_name: business },
          primary_recipients: [{ billing_info: { email_address: email, ...(name ? { name: { full_name: name } } : {}) } }],
          items: [{ name: item, quantity: "1", unit_amount: { currency_code: currency, value: amount } }],
        },
      });
    },
    sendInvoice: (id) => call(`/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { requestId: crypto.randomUUID(), body: { send_to_recipient: true, send_to_invoicer: false } }),
    getInvoice: (id) => call(`/v2/invoicing/invoices/${encodeURIComponent(id)}`, { method: "GET" }),
    /** Only a draft can be deleted; used to clear stale demo drafts nightly. */
    deleteDraftInvoice: (id) => call(`/v2/invoicing/invoices/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Transaction Search (needs the feature enabled on the app); at most 31 days per call, new items can lag up to 3 hours. */
    searchTransactions: (start, end) => call(`/v1/reporting/transactions?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&fields=transaction_info&page_size=500`, { method: "GET" }),
    listWebhooks: () => call("/v1/notifications/webhooks", { method: "GET" }),
    createWebhook: (url, events) => call("/v1/notifications/webhooks", { body: { url, event_types: events.map((name) => ({ name })) } }),
  };
}

function fail(status, body) {
  const e = new Error(`PayPal ${status} ${body?.name || ""}: ${body?.message || body?.error_description || ""}`.trim());
  e.status = status; e.paypal = { name: body?.name, debug_id: body?.debug_id, details: body?.details };
  return e;
}
