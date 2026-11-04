// The evidence ledger the judge path quotes is frozen; a payment a visitor makes afterwards shows only to that visitor.
import test from "node:test";
import assert from "node:assert/strict";
import { listPayments, isEvidence, EVIDENCE_BEFORE } from "../src/core.js";

const kvWith = (rows) => {
  const kv = new Map(rows.map((r) => [`pay:${r.capture_id}`, JSON.stringify(r)]));
  return { LEDGER: {
    get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  } };
};

test("evidence: the frozen ledger is the same for everyone; a later payment is its visitor's alone", async () => {
  const env = kvWith([
    { capture_id: "OLD", captured_at: "2026-10-30T05:56:33Z", amount: "49.00" },
    { capture_id: "MINE", captured_at: "2026-11-06T10:00:00Z", amount: "49.00", visitor: "v-1" },
    { capture_id: "THEIRS", captured_at: "2026-11-06T11:00:00Z", amount: "49.00", visitor: "v-2" },
    { capture_id: "PROMOTED", captured_at: "2026-11-06T12:00:00Z", amount: "49.00", evidence: true },
  ]);
  const ids = async (v) => (await listPayments(env, v)).map((p) => p.capture_id);
  assert.deepEqual(await ids(null), ["OLD", "PROMOTED"]);
  assert.deepEqual(await ids("v-1"), ["OLD", "MINE", "PROMOTED"]);
  assert.deepEqual(await ids("v-2"), ["OLD", "THEIRS", "PROMOTED"]);
  assert.ok(isEvidence({ captured_at: "2026-11-02T02:36:05.572Z" }) && "2026-11-02" < EVIDENCE_BEFORE);
});

test("evidence: one visitor can neither refund nor see another visitor's payment", async () => {
  const { route } = await import("../src/routes/payments.js");
  const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
  const rows = new Map([
    ["pay:MINE-A", JSON.stringify({ capture_id: "MINE-A", captured_at: "2026-11-06T10:00:00Z", amount: "49.00", visitor: A, ad: "trial_video" })],
    ["meta:MINE-A", JSON.stringify({ capture_id: "MINE-A", ok: true })],
  ]);
  const env = { LEDGER: {
    get: async (k, t) => (rows.has(k) ? (t === "json" ? JSON.parse(rows.get(k)) : rows.get(k)) : null),
    put: async (k, v) => { rows.set(k, v); }, delete: async (k) => { rows.delete(k); },
    list: async ({ prefix }) => ({ keys: [...rows.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  } };
  let refunded = false;
  const orders = { refundCapture: async () => { refunded = true; return { id: "R", status: "COMPLETED", amount: { value: "49.00" } }; } };
  const req = (vid, path, body) => new Request(`https://x.test${path}`, body ? { method: "POST", headers: { cookie: `ps_vid=${vid}`, "content-type": "application/json" }, body: JSON.stringify(body) } : { headers: { cookie: `ps_vid=${vid}` } });
  const call = (vid, path, body) => route({ request: req(vid, path, body), env, url: new URL(`https://x.test${path}`), pp: {}, orders, ip: "1" });
  const res = await call(B, "/api/refund", { capture_id: "MINE-A" });
  assert.equal(res.status, 404);
  assert.equal(refunded, false);
  const ledgerB = await (await call(B, "/api/ledger")).json();
  assert.ok(!ledgerB.payments.some((p) => p.capture_id === "MINE-A") && !ledgerB.meta.some((m) => m.capture_id === "MINE-A"));
  const ledgerA = await (await call(A, "/api/ledger")).json();
  assert.ok(ledgerA.payments.some((p) => p.capture_id === "MINE-A") && ledgerA.meta.some((m) => m.capture_id === "MINE-A"));
});
