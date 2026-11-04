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
