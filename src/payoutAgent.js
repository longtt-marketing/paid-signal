import { validate } from "./schema.js";

// The commission agent: the creator of an ad is paid per PayPal-confirmed paid order, not per lead. Code lists each
// order of the program's ad with its state (paid, refunded, disputed, held as a double payment, already paid out).
// Once a person approves, Claude picks the orders that earn commission and pays them with PayPal Payouts, then reads the
// batch back. Code pins the recipient, checks every order id against the ledger, and fixes the amount at rate x orders.

const cents = (v) => Math.round(Number(v) * 100);

/**
 * Each order of the program's ad, and whether it earns commission now.
 * @param {any[]} payments ledger payments  @param {{ ad: string, rate: string }} program
 * @param {Set<string>} held possible duplicates  @param {Record<string, string>} paidOut capture id -> payout batch id
 * @param {(p: any) => string} disputeState
 */
export function commissionOrders(payments, program, held, paidOut, disputeState) {
  return payments.filter((p) => p.ad === program.ad).map((p) => {
    const ds = disputeState(p);
    const why = paidOut[p.capture_id] ? `commission already paid (batch ${paidOut[p.capture_id]})`
      : cents(p.refunded_amount || 0) >= cents(p.amount) ? "refunded"
      : ds === "lost" ? "dispute lost" : ds === "open" || ds === "unclear" ? "dispute open"
      : held.has(p.capture_id) ? "held as a likely double payment" : null;
    return { capture_id: p.capture_id, amount: p.amount, captured_at: p.captured_at, via: p.via || "checkout", eligible: !why, why_not: why };
  });
}

export const PAYOUT_SYSTEM = `You pay one creator's commission for an ad in Paid Signal, after a person approved it.
The deal: the creator earns the stated rate for each PayPal-confirmed paid order from their ad, not for leads.
You get every order of that ad from the ledger, each marked eligible or with the reason it is not.
1. Pay only orders marked eligible. Never pay a refunded, disputed, held or already-paid order.
2. Call create_payout once with the capture ids you pay, the total (rate x number of orders, in USD) and a short note
   to the creator that says how many paid orders it covers. If no order is eligible, do not pay; say so.
3. Call get_payout with the batch id PayPal returned, to confirm its status.
4. Finish with one plain sentence: what you paid, for which orders, and PayPal's status. Never invent details.`;

export const PAYOUT_TOOLS = [
  {
    name: "create_payout",
    description: "PayPal Payouts: pay the creator of this ad. The recipient is fixed by code.",
    input_schema: { type: "object", properties: {
      capture_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
      total_usd: { type: "string" },
      note: { type: "string", maxLength: 300 },
    }, required: ["capture_ids", "total_usd", "note"] },
  },
  {
    name: "get_payout",
    description: "PayPal Payouts: read a payout batch's status by batch id.",
    input_schema: { type: "object", properties: { batch_id: { type: "string" } }, required: ["batch_id"] },
  },
];

/** Why create_payout must not run with these arguments, or null. */
export function payoutProblem(input, orders, rate, alreadyCalled) {
  if (alreadyCalled) return "create_payout already ran once in this approval.";
  const ids = [...new Set(input.capture_ids)];
  if (ids.length !== input.capture_ids.length) return "A capture id is listed twice.";
  for (const id of ids) {
    const o = orders.find((x) => x.capture_id === id);
    if (!o) return `${id} is not an order of this ad.`;
    if (!o.eligible) return `${id} does not earn commission: ${o.why_not}.`;
  }
  const want = (cents(rate) * ids.length) / 100;
  if (cents(input.total_usd) !== cents(want)) return `The total for ${ids.length} paid order(s) at $${rate} is $${want.toFixed(2)}, not $${input.total_usd}.`;
  return null;
}

/**
 * @param {{ llm: (messages: any[]) => Promise<{ raw: any[], calls: Array<{ id: string, name: string, input: any }> }>,
 *   pay: { create: (args: { capture_ids: string[], total: string, note: string }) => Promise<any>, get: (batchId: string) => Promise<any> },
 *   program: { ad: string, ad_name: string, creator: string, rate: string }, orders: any[], maxTurns?: number }} opts
 */
export async function runPayoutAgent({ llm, pay, program, orders, maxTurns = 5 }) {
  const trace = [];
  const list = orders.map((o) => `- ${o.capture_id}: $${o.amount}, ${o.via}, ${o.captured_at}: ${o.eligible ? "eligible" : `not eligible (${o.why_not})`}`).join("\n");
  /** @type {Array<{ role: string, content?: any, results?: Array<{ id: string, content: string }> }>} */
  const messages = [{ role: "user", content: `Creator: ${program.creator}. Ad: ${program.ad_name}. Rate: $${program.rate} per paid order.\nOrders of this ad:\n${list}` }];
  /** @type {{ batch_id: string, status: string, total: string, capture_ids: string[], note: string, read_back?: any } | null} */
  let payout = null;
  let called = false;
  for (let turn = 0; turn < maxTurns; turn++) {
    const { raw, calls } = await llm(messages);
    messages.push({ role: "assistant", content: raw });
    if (!calls.length) return { payout, summary: raw.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim(), trace };
    const results = [];
    for (const c of calls) {
      const def = PAYOUT_TOOLS.find((t) => t.name === c.name);
      if (!def) { trace.push({ tool: c.name, refused: "not allowlisted" }); results.push({ id: c.id, content: "Refused by code: only create_payout and get_payout are allowed." }); continue; }
      const shape = validate(c.input ?? {}, def.input_schema);
      if (shape.length) { trace.push({ tool: c.name, refused: "schema" }); results.push({ id: c.id, content: `Refused by code: ${shape.join(" ")}` }); continue; }
      try {
        if (c.name === "create_payout") {
          const problem = payoutProblem(c.input, orders, program.rate, called);
          if (problem) { trace.push({ tool: c.name, refused: problem }); results.push({ id: c.id, content: `Refused by code: ${problem}` }); continue; }
          called = true;
          const total = (cents(program.rate) * c.input.capture_ids.length / 100).toFixed(2);
          const out = await pay.create({ capture_ids: c.input.capture_ids, total, note: c.input.note });
          const batch = out?.batch_header?.payout_batch_id;
          if (batch) payout = { batch_id: batch, status: out.batch_header.batch_status, total, capture_ids: c.input.capture_ids, note: c.input.note };
          trace.push({ tool: c.name, ok: Boolean(batch) });
          results.push({ id: c.id, content: JSON.stringify(out).slice(0, 2000) });
        } else {
          if (!payout || c.input.batch_id !== payout.batch_id) { trace.push({ tool: c.name, refused: "other batch" }); results.push({ id: c.id, content: "Refused by code: only the batch this agent just created may be read." }); continue; }
          const out = await pay.get(c.input.batch_id);
          payout.read_back = { status: out?.batch_header?.batch_status || null, item_status: out?.items?.[0]?.transaction_status || null, time_completed: out?.batch_header?.time_completed || null };
          trace.push({ tool: c.name, ok: true });
          results.push({ id: c.id, content: JSON.stringify(out).slice(0, 2000) });
        }
      } catch (e) {
        trace.push({ tool: c.name, ok: false });
        results.push({ id: c.id, content: `PayPal error: ${String(/** @type {any} */ (e)?.message || e).slice(0, 300)}` });
      }
    }
    messages.push({ role: "tool", results });
  }
  return { payout, summary: payout ? `Paid batch ${payout.batch_id}.` : "The agent did not finish.", trace };
}
