// KV list() is capped per day: listings of the ledger's prefixes come from an index the wrapper keeps on every put and
// delete, and when list() is refused (the daily cap) the index still answers instead of every ledger read failing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedKV, listPrefix } from "../src/core.js";

const kv = () => {
  const m = new Map(); let lists = 0, refuse = false;
  return {
    m, get lists() { return lists; }, refuse(v) { refuse = v; },
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) {
      if (refuse) throw new Error("KV list() limit exceeded for the day.");
      lists++; return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true };
    },
  };
};

test("listings come from the index, which follows puts and deletes", async () => {
  const base = kv(), env = { LEDGER: indexedKV(base) };
  await base.put("pay:A", JSON.stringify({ capture_id: "A" }));
  assert.deepEqual((await listPrefix(env, "pay:")).map((p) => p.capture_id), ["A"]); // first listing builds the index
  assert.equal(base.lists, 1);
  await env.LEDGER.put("pay:B", JSON.stringify({ capture_id: "B" }));
  await env.LEDGER.delete("pay:A");
  assert.deepEqual((await listPrefix(env, "pay:")).map((p) => p.capture_id), ["B"]);
  assert.equal(base.lists, 1, "no further list() call within the hour");
});

test("when list() is refused, the index still answers", async () => {
  const base = kv(), env = { LEDGER: indexedKV(base) };
  await env.LEDGER.put("inv:X", JSON.stringify({ id: "X" }));
  await listPrefix(env, "inv:");
  const idx = JSON.parse(base.m.get("idx:inv:")); idx.listed = 0; base.m.set("idx:inv:", JSON.stringify(idx)); // an old index
  base.refuse(true);
  assert.deepEqual((await listPrefix(env, "inv:")).map((i) => i.id), ["X"]);
});

test("keys outside the indexed prefixes still use list()", async () => {
  const base = kv(), env = { LEDGER: indexedKV(base) };
  await env.LEDGER.put("quota:x:2026-11-07", "1");
  assert.equal((await env.LEDGER.list({ prefix: "quota:" })).keys.length, 1);
  assert.equal(base.lists, 1);
});
