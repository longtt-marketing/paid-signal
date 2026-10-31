// The server SDK wrapper against a stubbed transport (no network): errors keep PayPal's name and debug id, a failed call
// is retried once with the same PayPal-Request-Id, a 2xx PayPal accepted is never reported as a failure, the token is reused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ordersSdk } from "../src/paypalSdk.js";

const token = { status: 200, headers: {}, data: JSON.stringify({ access_token: "T", token_type: "Bearer", expires_in: 32400 }) };
/** An axios-style adapter that answers the token request itself and the API requests from a queue. */
const stub = (...replies) => {
  const calls = [];
  return { calls, http: async (c) => { calls.push(c); const r = c.url.endsWith("/v1/oauth2/token") ? token : replies.shift(); if (r instanceof Error) throw r; return { statusText: "", config: c, headers: {}, ...r }; } };
};
const api = (calls) => calls.filter((c) => !c.url.endsWith("/v1/oauth2/token"));
const header = (c, name) => Object.entries(c.headers || {}).find(([k]) => k.toLowerCase() === name)?.[1];
const sdk = (s) => ordersSdk({ clientId: "id", secret: "secret", http: s.http });

test("sdk: a 4xx keeps PayPal's error name and debug id; its one retry re-sends the same PayPal-Request-Id", async () => {
  // retryOnTimeout also retries a thrown 4xx once: a wasted round trip, harmless because PayPal sees the same request id
  const e422 = () => ({ status: 422, data: JSON.stringify({ name: "UNPROCESSABLE_ENTITY", message: "Order not approved", debug_id: "dbg422" }) });
  const s = stub(e422(), e422());
  await assert.rejects(sdk(s).captureOrder("ORDER1", "cap-ORDER1"), (e) => e.status === 422 && e.paypal.name === "UNPROCESSABLE_ENTITY" && e.paypal.debug_id === "dbg422");
  assert.deepEqual(api(s.calls).map((c) => header(c, "paypal-request-id")), ["cap-ORDER1", "cap-ORDER1"]);
});

test("sdk: a 5xx with an empty body still gives the debug id from PayPal's header", async () => {
  const e503 = () => ({ status: 503, headers: { "paypal-debug-id": "dbg503" }, data: "" }); // the SDK edits a reply in place: one each
  const s = stub(e503(), e503());
  await assert.rejects(sdk(s).getOrder("ORDER1"), (e) => e.status === 503 && e.paypal.debug_id === "dbg503");
});

test("sdk: a 5xx is retried once with the same PayPal-Request-Id, so a capture cannot happen twice", async () => {
  const s = stub({ status: 503, data: "" }, { status: 201, data: JSON.stringify({ id: "ORDER1", status: "COMPLETED" }) });
  assert.equal((await sdk(s).captureOrder("ORDER1", "cap-ORDER1")).status, "COMPLETED");
  const caps = api(s.calls);
  assert.equal(caps.length, 2);
  assert.deepEqual(caps.map((c) => header(c, "paypal-request-id")), ["cap-ORDER1", "cap-ORDER1"]);
});

test("sdk: a 2xx whose body fails the SDK's schema check is PayPal's answer, not an error", async () => {
  const s = stub({ status: 201, data: JSON.stringify({ id: 123, status: "COMPLETED" }) });
  assert.deepEqual(await sdk(s).captureOrder("ORDER1", "cap-ORDER1"), { id: 123, status: "COMPLETED" });
});

test("sdk: PayPal unreachable is a failure with no status, so the Worker answers 502", async () => {
  const drop = () => Object.assign(new Error("timeout of 10000ms exceeded"), { code: "ECONNABORTED" });
  const s = stub(drop(), drop());
  await assert.rejects(sdk(s).getOrder("ORDER1"), (e) => e.status === undefined && /unreachable/.test(e.message));
});

test("sdk: one client keeps its OAuth token across calls", async () => {
  const ok = () => ({ status: 200, data: JSON.stringify({ id: "ORDER1" }) });
  const s = stub(ok(), ok()), c = sdk(s);
  await c.getOrder("ORDER1"); await c.getOrder("ORDER1");
  assert.equal(s.calls.filter((x) => x.url.endsWith("/v1/oauth2/token")).length, 1);
});
