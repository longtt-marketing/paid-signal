// The send agent: once a person approves an invoice, Claude sends exactly that invoice through PayPal's Agent Toolkit.
// Code allowlists two toolkit tools (get_invoice, send_invoice) and pins every call to the approved invoice id, so the
// model can check and send what was approved and nothing else.

export const SEND_SYSTEM = `You send one PayPal invoice that a person has just approved in Paid Signal.
1. Call get_invoice for the approved invoice id.
2. Check that it is a DRAFT for the approved amount and currency. If it is not, do not send; say why in one sentence.
3. Otherwise call send_invoice for that id with send_to_recipient true.
4. Finish with one plain sentence saying what you sent and to which lead. Never invent details that the tools did not return.`;

export const SEND_TOOLS = [
  {
    name: "get_invoice",
    description: "PayPal Agent Toolkit: get an invoice from PayPal by id.",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] },
  },
  {
    name: "send_invoice",
    description: "PayPal Agent Toolkit: send a draft invoice to its recipient.",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" }, send_to_recipient: { type: "boolean" } }, required: ["invoice_id"] },
  },
];

/**
 * @param {{ llm: (messages: any[]) => Promise<{ raw: any[], calls: Array<{ id: string, name: string, input: any }> }>,
 *   tools: Record<string, { execute: (args: any) => Promise<any> }>,
 *   approved: { id: string, lead: string, ad: string, amount: string }, maxTurns?: number }} opts
 */
export async function runSendAgent({ llm, tools, approved, maxTurns = 5 }) {
  const trace = [];
  /** @type {Array<{ role: string, content?: any, results?: Array<{ id: string, content: string }> }>} */
  const messages = [{ role: "user", content: `Approved invoice ${approved.id} for ${approved.lead} (ad ${approved.ad}), ${approved.amount} USD.` }];
  let sent = false;
  for (let turn = 0; turn < maxTurns; turn++) {
    const { raw, calls } = await llm(messages);
    messages.push({ role: "assistant", content: raw });
    if (!calls.length) {
      const summary = raw.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      return { sent, summary, trace };
    }
    const results = [];
    for (const c of calls) {
      if (!SEND_TOOLS.some((t) => t.name === c.name)) { trace.push({ tool: c.name, refused: "not allowlisted" }); results.push({ id: c.id, content: "Refused by code: only get_invoice and send_invoice are allowed." }); continue; }
      if (c.input?.invoice_id !== approved.id) { trace.push({ tool: c.name, refused: "other invoice" }); results.push({ id: c.id, content: `Refused by code: only the approved invoice ${approved.id} may be used.` }); continue; }
      const args = c.name === "send_invoice" ? { invoice_id: approved.id, send_to_recipient: true } : { invoice_id: approved.id };
      const out = String(await tools[c.name].execute(args));
      const failed = /error|failed/i.test(out.slice(0, 200)) && !out.trimStart().startsWith("{");
      if (c.name === "send_invoice" && !failed) sent = true;
      trace.push({ tool: c.name, ok: !failed });
      results.push({ id: c.id, content: out.slice(0, 3000) });
    }
    messages.push({ role: "tool", results });
  }
  return { sent, summary: sent ? `Sent invoice ${approved.id}.` : "The agent did not finish.", trace };
}
