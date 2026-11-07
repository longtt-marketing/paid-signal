// Two clicks on the same draft at once (the Approvals panel and a Studio chat card): the first marks the draft as being
// sent, so the second is refused before any Claude turn or PayPal call, and a draft that is no longer a draft is refused too.
import { test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/worker.js";

const kv = (init) => {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
};
const approve = (env, id) => app.fetch(new Request("https://paid-signal.test/api/invoices/approve", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://paid-signal.test" }, body: JSON.stringify({ id }) }), env);

test("a draft already being sent is not sent again", async () => {
  const env = { LEDGER: kv({ "inv:INV2-A": { id: "INV2-A", status: "DRAFT", lead: "Lead 01 (fictional)", amount: "49.00", approving: new Date().toISOString() } }) };
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("{}", { status: 500 }); };
  try {
    const r = await approve(env, "INV2-A");
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /already being sent/);
    assert.equal(calls, 0, "no Claude or PayPal call");
  } finally { globalThis.fetch = realFetch; }
});

test("an invoice that is no longer a draft is refused", async () => {
  const env = { LEDGER: kv({ "inv:INV2-B": { id: "INV2-B", status: "SENT", lead: "Lead 02 (fictional)", amount: "49.00" } }) };
  const r = await approve(env, "INV2-B");
  assert.equal(r.status, 400);
});
