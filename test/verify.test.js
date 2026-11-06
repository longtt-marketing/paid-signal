// Verify with PayPal: every evidence payment is read back from PayPal and compared on amount and refund state.
import test from "node:test";
import assert from "node:assert/strict";

const kvEnv = (rows = []) => {
  const kv = new Map(rows.map(([k, v]) => [k, JSON.stringify(v)]));
  return { LEDGER: {
    get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
    put: async (k, v) => { kv.set(k, String(v)); }, delete: async (k) => { kv.delete(k); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  } };
};
const pay = (id, extra) => ({ capture_id: id, order_id: `INV-${id}`, amount: "49.00", refunded_amount: "0.00", status: "COMPLETED", ad: "parent_carousel", captured_at: "2026-10-30T10:00:00Z", ...extra });

test("verify reads each payment back from PayPal and counts N of N matching", async () => {
  const { route } = await import("../src/routes/payments.js");
  const env = kvEnv([["pay:A", pay("A", { via: "invoice" })], ["pay:B", pay("B", { refunded_amount: "49.00", status: "REFUNDED" })],
    ["pay:C", pay("C", {})], ["pay:LATE", pay("LATE", { captured_at: "2026-11-06T10:00:00Z", visitor: "v" })]]);
  const pp = { getInvoice: async (id) => ({ id, status: "PAID", amount: { value: "49.00" } }) };
  const caps = { B: { status: "REFUNDED", amount: { value: "49.00" } }, C: { status: "COMPLETED", amount: { value: "48.00" } } };
  const orders = { getCapture: async (id) => caps[id] };
  const request = new Request("https://x.test/api/verify", { headers: { "cf-connecting-ip": "1.2.3.4" } });
  const res = await route({ request, env, url: new URL(request.url), pp, orders, ip: "1.2.3.4" });
  const body = await res.json();
  assert.equal(body.total, 3); // the judge's own later payment is not evidence
  assert.equal(body.matched, 2);
  assert.equal(body.items.find((i) => i.id === "C").match, false); // amount differs from PayPal
  assert.equal(body.items.find((i) => i.id === "B").paypal, "REFUNDED");
});
