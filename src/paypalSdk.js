// Order create/read and refunds through PayPal's official server SDK (generated with APIMatic). Returns PayPal's own JSON (snake_case), so the
// rest of the Worker reads it exactly as it reads the REST client in paypal.js.
import { Client, Environment, OrdersController, PaymentsController, CheckoutPaymentIntent, PaypalExperienceUserAction, PaypalWalletContextShippingPreference } from "@paypal/paypal-server-sdk";

export function ordersSdk({ clientId, secret }) {
  const client = new Client({ clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: secret }, environment: Environment.Sandbox, timeout: 15000 });
  const orders = new OrdersController(client), payments = new PaymentsController(client);
  const run = async (p) => {
    try { return JSON.parse((await p).body); }
    catch (e) {
      const body = typeof e.body === "string" ? safe(e.body) : e.result || {};
      const err = new Error(`PayPal ${e.statusCode || ""} ${body?.name || ""}: ${body?.message || e.message}`.trim());
      Object.assign(err, { status: e.statusCode, paypal: { name: body?.name, debug_id: body?.debug_id, details: body?.details } });
      throw err;
    }
  };
  return {
    /** One-item order; the ad click travels in custom_id; PayPal-Request-Id makes a retried create idempotent. */
    createOrder: ({ amount, currency = "USD", description, customId, invoiceId, returnUrl, cancelUrl, requestId }) => run(orders.createOrder({
      paypalRequestId: requestId, prefer: "return=representation",
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [{ amount: { currencyCode: currency, value: amount }, description, customId, invoiceId }],
        paymentSource: { paypal: { experienceContext: { returnUrl, cancelUrl, userAction: PaypalExperienceUserAction.PayNow, shippingPreference: PaypalWalletContextShippingPreference.NoShipping } } },
      },
    })),
    getOrder: (id) => run(orders.getOrder({ id })),
    /** Full refund without an amount, partial with one. */
    refundCapture: (captureId, { amount, currency = "USD", requestId } = {}) => run(payments.refundCapturedPayment({
      captureId, paypalRequestId: requestId, prefer: "return=representation",
      body: amount ? { amount: { value: amount, currencyCode: currency } } : {},
    })),
  };
}

function safe(s) { try { return JSON.parse(s); } catch { return {}; } }
