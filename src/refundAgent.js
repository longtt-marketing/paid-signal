import { validate } from "./schema.js";

// The refund agent: the ledger flags a likely double payment (same payer, same ad, minutes apart) and holds it out of
// paid orders and out of Meta. Once a person approves, Claude decides whether it is a real double payment and, if so,
// refunds the second capture through PayPal's Agent Toolkit (create_refund), then reads the refund back (get_refund).
// Code allowlists those two tools, pins create_refund to the flagged capture, full amount only, once.

export const REFUND_SYSTEM = `You handle one likely double payment that Paid Signal's ledger flagged and a person asked you to resolve.
You get both captures from the ledger: payer (a salted key: same key means same PayPal payer), ad, amount, time.
1. Decide if the second capture is a double payment of the first: same payer, same ad, same amount, minutes apart, and no
   sign the buyer meant two orders. If you are not sure, do not refund; say why in one sentence.
2. If it is, call create_refund for the second capture only, for its full amount, with a short polite note_to_payer
   written for the buyer (about their order and the refund; no ad names or internal ids).
3. Call get_refund with the refund id PayPal returned, to confirm its status.
4. Finish with one plain sentence: what you refunded, why, and PayPal's status. Never invent details the tools did not return.`;

export const REFUND_TOOLS = [
  {
    name: "create_refund",
    description: "PayPal Agent Toolkit: refund a captured payment. Without amount, the full captured amount is refunded.",
    input_schema: { type: "object", properties: {
      capture_id: { type: "string" },
      amount: { type: "object", properties: { currency_code: { type: "string" }, value: { type: "string" } }, required: ["currency_code", "value"] },
      note_to_payer: { type: "string", maxLength: 255 },
    }, required: ["capture_id"] },
  },
  {
    name: "get_refund",
    description: "PayPal Agent Toolkit: get a refund's details and status by refund id.",
    input_schema: { type: "object", properties: { refund_id: { type: "string" } }, required: ["refund_id"] },
  },
];

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const isError = (out) => {
  const j = parse(out);
  if (!j) return /error|failed/i.test(String(out).slice(0, 200));
  return Boolean(j.error || j.ok === false || (j.name && j.message && !j.id));
};

/** Why create_refund must not run with these arguments, or null when it is the full refund of the flagged capture. */
export function refundProblem(input, flagged, alreadyCalled) {
  if (alreadyCalled) return "create_refund already ran once in this approval.";
  if (input.capture_id !== flagged.capture_id) return `Only the flagged second capture ${flagged.capture_id} may be refunded.`;
  if (input.amount && (input.amount.currency_code !== (flagged.currency || "USD") || Number(input.amount.value) !== Number(flagged.amount)))
    return `A double payment is refunded in full: ${flagged.amount} ${flagged.currency || "USD"}.`;
  return null;
}

/**
 * @param {{ llm: (messages: any[]) => Promise<{ raw: any[], calls: Array<{ id: string, name: string, input: any }> }>,
 *   tools: Record<string, { execute: (args: any) => Promise<any> }>,
 *   pair: { first: any, second: any, seconds: number }, maxTurns?: number }} opts
 * pair.first / pair.second: { capture_id, payer_key, ad, amount, currency, captured_at }
 */
export async function runRefundAgent({ llm, tools, pair, maxTurns = 5 }) {
  const trace = [];
  const line = (p) => `capture ${p.capture_id}: payer ${p.payer_key}, ad ${p.ad}, ${p.amount} ${p.currency || "USD"}, captured ${p.captured_at}`;
  /** @type {Array<{ role: string, content?: any, results?: Array<{ id: string, content: string }> }>} */
  const messages = [{ role: "user", content: `Flagged as a likely double payment, ${pair.seconds} seconds apart.\nFirst: ${line(pair.first)}\nSecond: ${line(pair.second)}` }];
  /** @type {{ id: string, status: string, amount: string, note_to_payer: string|null, read_back?: any } | null} */
  let refund = null;
  let called = false;
  for (let turn = 0; turn < maxTurns; turn++) {
    const { raw, calls } = await llm(messages);
    messages.push({ role: "assistant", content: raw });
    if (!calls.length) {
      const summary = raw.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      return { refund, summary, trace };
    }
    const results = [];
    for (const c of calls) {
      const def = REFUND_TOOLS.find((t) => t.name === c.name);
      if (!def) { trace.push({ tool: c.name, refused: "not allowlisted" }); results.push({ id: c.id, content: "Refused by code: only create_refund and get_refund are allowed." }); continue; }
      const shape = validate(c.input ?? {}, def.input_schema);
      if (shape.length) { trace.push({ tool: c.name, refused: "schema" }); results.push({ id: c.id, content: `Refused by code: ${shape.join(" ")}` }); continue; }
      if (c.name === "create_refund") {
        const problem = refundProblem(c.input, pair.second, called);
        if (problem) { trace.push({ tool: c.name, refused: problem }); results.push({ id: c.id, content: `Refused by code: ${problem}` }); continue; }
        called = true;
      }
      if (c.name === "get_refund" && (!refund || c.input.refund_id !== refund.id)) { trace.push({ tool: c.name, refused: "other refund" }); results.push({ id: c.id, content: "Refused by code: only the refund this agent just made may be read." }); continue; }
      const out = String(await tools[c.name].execute(c.input));
      const failed = isError(out);
      const j = parse(out);
      if (c.name === "create_refund" && !failed && j?.id) refund = { id: j.id, status: j.status, amount: j.amount?.value || pair.second.amount, note_to_payer: c.input.note_to_payer || null };
      if (c.name === "get_refund" && !failed && j?.id && refund) refund.read_back = { status: j.status, amount: j.amount?.value || null, create_time: j.create_time || null };
      trace.push({ tool: c.name, ok: !failed });
      results.push({ id: c.id, content: out.slice(0, 3000) });
    }
    messages.push({ role: "tool", results });
  }
  return { refund, summary: refund ? `Refunded ${pair.second.capture_id}.` : "The agent did not finish.", trace };
}
