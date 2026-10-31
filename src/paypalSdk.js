// Order create, read and capture, and refunds, through PayPal's official server SDK (generated with APIMatic). Returns PayPal's own JSON (snake_case), so the
// rest of the Worker reads it exactly as it reads the REST client in paypal.js. Settings follow APIMatic's PayPal Context
// Plugin skills (error handling, resilience, client initialization), translated to SDK 1.1.0 (docs/development-with-ai.md).
import { Client, Environment, OrdersController, PaymentsController, CheckoutPaymentIntent, PaypalExperienceUserAction, PaypalWalletContextShippingPreference, ApiError, ResponseValidationError } from "@paypal/paypal-server-sdk";

// one client per credentials for the life of the isolate, so the OAuth token is reused instead of fetched on every call
const clients = new Map();

/** @param {{ clientId: string, secret: string, http?: any }} opts  http: a stub transport for tests (axios adapter) */
export function ordersSdk({ clientId, secret, http }) {
  if (!http && clients.has(clientId)) return clients.get(clientId);
  const client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: secret }, environment: Environment.Sandbox, timeout: 10000,
    // one retry on 5xx or a dropped connection; every POST here carries a fixed PayPal-Request-Id, which the retry re-sends,
    // so a retried capture or refund returns the first result instead of moving money twice. 1.1.0 retries nothing by default.
    httpClientOptions: { retryConfig: { maxNumberOfRetries: 1, retryOnTimeout: true, retryInterval: 0.5, maximumRetryWaitTime: 2, httpMethodsToRetry: ["GET", "POST"] } },
    ...(http ? { unstable_httpClientOptions: { adapter: http } } : {}),
  });
  const orders = new OrdersController(client), payments = new PaymentsController(client);
  const run = async (p) => {
    try { return JSON.parse((await p).body); }
    catch (e) {
      // a 2xx whose body the SDK's schema check rejects still happened at PayPal (a capture may have taken the money): use it
      if (e instanceof ResponseValidationError && typeof e.body === "string") return JSON.parse(e.body);
      if (!(e instanceof ApiError)) throw Object.assign(new Error(`PayPal unreachable: ${e?.message || e}`), { cause: e });
      const b = e.result ?? (typeof e.body === "string" ? safe(e.body) : {});
      const err = new Error(`PayPal ${e.statusCode} ${b.name || b.error || ""}: ${b.message || b.error_description || e.message}`.trim(), { cause: e });
      // PayPal also sends its debug id as a header, so an empty 5xx body still leaves something to quote to PayPal support
      Object.assign(err, { status: e.statusCode, paypal: { name: b.name || b.error, debug_id: b.debug_id || e.headers?.["paypal-debug-id"], details: b.details } });
      throw err;
    }
  };
  const api = {
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
    /** PayPal's own record of one capture: status, amount, custom_id, fee and net, refunds so far. */
    getCapture: (captureId) => run(payments.getCapturedPayment({ captureId })),
    /** Capture an approved order; the same PayPal-Request-Id on a retry returns the first capture instead of charging twice. */
    captureOrder: (id, requestId) => run(orders.captureOrder({ id, paypalRequestId: requestId, prefer: "return=representation" })),
    /** Full refund without an amount, partial with one. */
    refundCapture: (captureId, { amount, currency = "USD", requestId } = {}) => run(payments.refundCapturedPayment({
      captureId, paypalRequestId: requestId, prefer: "return=representation",
      body: amount ? { amount: { value: amount, currencyCode: currency } } : {},
    })),
  };
  if (!http) clients.set(clientId, api);
  return api;
}

function safe(s) { try { return JSON.parse(s); } catch { return {}; } }
