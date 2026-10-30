import test from "node:test";
import assert from "node:assert/strict";
import { validate, checkCall } from "../src/schema.js";
import { REVENUE_TOOLS, runRevenueAgent } from "../src/revenue.js";
import { TOOLS, checkRecommendation } from "../src/agent.js";
import { reconcile } from "../src/ledger.js";

test("schema: types, enums, required fields and limits are enforced", () => {
  const s = { type: "object", required: ["a"], additionalProperties: false, properties: { a: { type: "integer", minimum: 1, maximum: 3 }, b: { type: "string", enum: ["x", "y"] }, c: { type: "array", maxItems: 1, items: { type: "string" } } } };
  assert.deepEqual(validate({ a: 2, b: "x", c: ["ok"] }, s), []);
  assert.match(validate({}, s).join(" "), /a is required/);
  assert.match(validate({ a: "2" }, s).join(" "), /integer/);
  assert.match(validate({ a: 9 }, s).join(" "), /at most 3/);
  assert.match(validate({ a: 1, b: "z" }, s).join(" "), /one of x, y/);
  assert.match(validate({ a: 1, c: ["1", "2"] }, s).join(" "), /at most 1/);
  assert.match(validate({ a: 1, d: true }, s).join(" "), /not allowed/);
  assert.match(checkCall(REVENUE_TOOLS, { name: "delete_everything", input: {} })[0], /Unknown tool/);
});

test("schema: a malformed proposal from the revenue agent is refused before any pricing", async () => {
  const leads = [{ lead: "L1", ad: "trial_video", source: "fb", click_id: "x", email: "l1@example.com", message: "Book two kids" }];
  let i = 0;
  const turns = [
    { raw: [], calls: [{ id: "1", name: "propose_invoice", input: { lead: "L1", items: [{ sku: "trial_class", qty: "two" }], note: "x", reason: "y" } }] },
    { raw: [{ type: "text", text: "Done." }], calls: [] },
  ];
  const out = await runRevenueAgent({ llm: async () => turns[i++], leads, invoices: [] });
  assert.equal(out.proposals.length, 0);
  assert.match(out.refusals[0].problems.join(" "), /qty must be an integer/);
});

test("schema: the evidence gate rejects a recommendation with the wrong shape (the AG Studio agent submits here too)", () => {
  const rec = reconcile([{ ad: "trial_video", spend_cents: 9620, leads: 14 }], []);
  assert.match(checkRecommendation(rec, [], { headline: "x", actions: [{ ad: "trial_video", change: "double", reason: "r", evidence: ["row:trial_video"] }] }).join(" "), /one of pause/);
  assert.match(checkRecommendation(rec, [], { headline: 5, actions: [] }).join(" "), /headline must be a string/);
  assert.ok(TOOLS.some((t) => t.name === "submit_recommendation"));
});
