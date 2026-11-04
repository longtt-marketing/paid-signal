import test from "node:test";
import assert from "node:assert/strict";
import { runPayoutAgent, commissionOrders, payoutProblem } from "../src/payoutAgent.js";

const program = { ad: "parent_carousel", ad_name: "Testimonial · carousel", creator: "test creator", rate: "5.00" };
const payments = [
  { capture_id: "P1", ad: "parent_carousel", amount: "49.00", refunded_amount: "0.00", captured_at: "2026-10-28T11:38:20Z" },
  { capture_id: "P2", ad: "parent_carousel", amount: "49.00", refunded_amount: "49.00", captured_at: "2026-10-28T11:38:32Z" },
  { capture_id: "P3", ad: "parent_carousel", amount: "49.00", refunded_amount: "0.00", captured_at: "2026-10-30T05:56:33Z", dispute: { status: "OPEN" } },
  { capture_id: "P4", ad: "parent_carousel", amount: "49.00", refunded_amount: "0.00", captured_at: "2026-11-02T02:36:05Z", via: "invoice" },
  { capture_id: "P5", ad: "parent_carousel", amount: "49.00", refunded_amount: "0.00", captured_at: "2026-11-03T02:36:05Z" },
  { capture_id: "X1", ad: "free_guide", amount: "49.00", refunded_amount: "0.00", captured_at: "2026-10-28T20:50:00Z" },
];
const ds = (p) => (p.dispute ? "open" : "none");
const orders = commissionOrders(payments, program, new Set(["P5"]), {}, ds);
const scripted = (turns) => { let i = 0; return async () => turns[i++]; };
const use = (id, name, input) => ({ raw: [{ type: "tool_use", id, name, input }], calls: [{ id, name, input }] });
const say = (text) => ({ raw: [{ type: "text", text }], calls: [] });
function fakePay() {
  const calls = [];
  return { calls, pay: {
    create: async (a) => { calls.push(["create", a]); return { batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } }; },
    get: async (id) => { calls.push(["get", id]); return { batch_header: { payout_batch_id: id, batch_status: "SUCCESS", time_completed: "2026-11-04T10:00:00Z" }, items: [{ transaction_status: "SUCCESS" }] }; },
  } };
}

test("commission orders: only paid, unrefunded, undisputed, unheld orders of the program's ad earn", () => {
  assert.deepEqual(orders.map((o) => [o.capture_id, o.eligible, o.why_not]), [
    ["P1", true, null], ["P2", false, "refunded"], ["P3", false, "dispute open"], ["P4", true, null], ["P5", false, "held as a likely double payment"]]);
  const again = commissionOrders(payments, program, new Set(), { P1: "B0" }, ds);
  assert.match(again.find((o) => o.capture_id === "P1").why_not, /already paid \(batch B0\)/);
});

test("commission agent: pays the eligible orders at rate x orders and reads the batch back", async () => {
  const { calls, pay } = fakePay();
  const llm = scripted([use("1", "create_payout", { capture_ids: ["P1", "P4"], total_usd: "10.00", note: "Commission for 2 paid orders." }), use("2", "get_payout", { batch_id: "B1" }), say("Paid $10 for 2 orders; SUCCESS.")]);
  const out = await runPayoutAgent({ llm, pay, program, orders });
  assert.equal(out.payout.total, "10.00");
  assert.equal(out.payout.read_back.status, "SUCCESS");
  assert.deepEqual(calls.map((c) => c[0]), ["create", "get"]);
  assert.deepEqual(calls[0][1].capture_ids, ["P1", "P4"]);
});

test("commission agent: ineligible orders, a wrong total, a second payout and other tools are refused in code", async () => {
  const { calls, pay } = fakePay();
  const llm = scripted([
    use("1", "create_payout", { capture_ids: ["P1", "P2"], total_usd: "10.00", note: "x" }),
    use("2", "create_payout", { capture_ids: ["P1", "X1"], total_usd: "10.00", note: "x" }),
    use("3", "create_payout", { capture_ids: ["P1", "P4"], total_usd: "155.00", note: "x" }),
    use("4", "send_money", { to: "someone" }),
    use("5", "create_payout", { capture_ids: ["P1", "P4"], total_usd: "10.00", note: "ok" }),
    use("6", "create_payout", { capture_ids: ["P1"], total_usd: "5.00", note: "again" }),
    say("Done."),
  ]);
  const out = await runPayoutAgent({ llm, pay, program, orders, maxTurns: 8 });
  assert.equal(calls.filter((c) => c[0] === "create").length, 1);
  assert.match(out.trace[0].refused, /refunded/);
  assert.match(out.trace[1].refused, /not an order of this ad/);
  assert.match(out.trace[2].refused, /\$10\.00/);
  assert.equal(out.trace[3].refused, "not allowlisted");
  assert.equal(out.trace[4].ok, true);
  assert.match(out.trace[5].refused, /already ran once/);
});

test("commission agent: a duplicate id in the list is refused; declining pays nothing", async () => {
  assert.match(payoutProblem({ capture_ids: ["P1", "P1"], total_usd: "10.00" }, orders, "5.00", false), /twice/);
  const { calls, pay } = fakePay();
  const out = await runPayoutAgent({ llm: scripted([say("Nothing to pay.")]), pay, program, orders });
  assert.equal(out.payout, null);
  assert.deepEqual(calls, []);
});
