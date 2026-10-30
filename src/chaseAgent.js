import { validate } from "./schema.js";

// The chase agent: sent invoices that are still unpaid are money the ads already earned. Claude reads each one with
// PayPal's Agent Toolkit, decides which deserve a reminder now and writes the note; the toolkit sends it.
// Code holds the line on every call: two toolkit tools only (get_invoice, send_invoice_reminder), only invoices on the
// eligible list (sent, unpaid, sent at least an hour ago, not reminded in the last 24 hours), a reminder only after
// get_invoice showed PayPal still waiting for payment, at most 3 reminders a run, and a note that quotes no amount other
// than the invoice's own. Every invoice the owner approved; a reminder only follows up on it.

export const CHASE_SYSTEM = `You follow up on PayPal invoices a small shop has sent and not been paid for.
You get the eligible invoices: who, what for, how much, when sent, and what the lead wrote before it was sent.
1. For each invoice you might remind, call get_invoice first and read its status.
2. Remind only when PayPal still shows it waiting for payment and a reminder is likely to help (the lead asked to book,
   or it has waited longest). Skip the rest and say why in a few words. At most 3 reminders.
3. To remind, call send_invoice_reminder with the invoice id, a short subject and a friendly note of one or two sentences
   in the shop's voice that names what was booked. Quote no amount except the invoice's own total, and promise nothing
   (no discount, no deadline) the shop did not offer.
4. Finish with one sentence: whom you reminded and whom you skipped.`;

export const CHASE_TOOLS = [
  {
    name: "get_invoice",
    description: "PayPal Agent Toolkit: get an invoice from PayPal by id, including its status.",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] },
  },
  {
    name: "send_invoice_reminder",
    description: "PayPal Agent Toolkit: send the recipient a reminder for a sent, unpaid invoice.",
    input_schema: {
      type: "object",
      properties: { invoice_id: { type: "string" }, subject: { type: "string", maxLength: 120 }, note: { type: "string", maxLength: 400 } },
      required: ["invoice_id", "subject", "note"],
    },
  },
];

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const WAITING = new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]);
const HOUR = 3600000;

/** Invoices a reminder may go to: sent, not paid, sent an hour ago or more, not reminded in the last day. */
export function eligibleForReminder(invoices, now = Date.now()) {
  return invoices.filter((i) => WAITING.has(i.status) && i.sent_at && now - Date.parse(i.sent_at) >= HOUR
    && !(i.reminded_at && now - Date.parse(i.reminded_at) < 24 * HOUR));
}

/** Why this reminder must not go, or null. `read` is what get_invoice returned for it in this run. */
export function reminderProblem(input, { eligible, read, sent, maxReminders = 3 }) {
  const inv = eligible.find((i) => i.id === input.invoice_id);
  if (!inv) return "That invoice is not on the eligible list.";
  if (sent.includes(inv.id)) return "It was already reminded in this run.";
  if (sent.length >= maxReminders) return `At most ${maxReminders} reminders a run.`;
  const status = parse(read[inv.id] || "")?.status;
  if (!status) return "Call get_invoice for it first.";
  if (!WAITING.has(status)) return `PayPal shows it ${status}, not waiting for payment.`;
  const amounts = [...`${input.subject} ${input.note}`.matchAll(/\$?\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/[$,]/g, "")));
  const bad = amounts.filter((n) => n !== Number(inv.amount));
  if (bad.length) return `The note quotes ${bad.join(", ")}; only the invoice total ${inv.amount} may appear.`;
  return null;
}

/**
 * @param {{ llm: (messages: any[]) => Promise<{ raw: any[], calls: Array<{ id: string, name: string, input: any }> }>,
 *   tools: Record<string, { execute: (args: any) => Promise<any> }>, eligible: any[], leads: any[], maxTurns?: number }} opts
 */
export async function runChaseAgent({ llm, tools, eligible, leads, maxTurns = 8 }) {
  const trace = [], read = {}, sent = [], notes = {};
  const brief = eligible.map((i) => ({ invoice_id: i.id, lead: i.lead, total_usd: i.amount, for: (i.lines || []).map((l) => l.name).join(" + ") || "Trial class", sent_at: i.sent_at,
    lead_wrote: leads.find((l) => l.lead === i.lead)?.message || "" }));
  /** @type {Array<{ role: string, content?: any, results?: Array<{ id: string, content: string }> }>} */
  const messages = [{ role: "user", content: `Eligible invoices (sent, unpaid):\n${JSON.stringify(brief, null, 1)}` }];
  for (let turn = 0; turn < maxTurns; turn++) {
    const { raw, calls } = await llm(messages);
    messages.push({ role: "assistant", content: raw });
    if (!calls.length) return { reminded: sent.map((id) => ({ id, ...notes[id] })), summary: raw.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim(), trace };
    const results = [];
    for (const c of calls) {
      const def = CHASE_TOOLS.find((t) => t.name === c.name);
      if (!def) { trace.push({ tool: c.name, refused: "not allowlisted" }); results.push({ id: c.id, content: "Refused by code: only get_invoice and send_invoice_reminder are allowed." }); continue; }
      const shape = validate(c.input ?? {}, def.input_schema);
      if (shape.length) { trace.push({ tool: c.name, refused: "schema" }); results.push({ id: c.id, content: `Refused by code: ${shape.join(" ")}` }); continue; }
      if (c.name === "get_invoice") {
        if (!eligible.some((i) => i.id === c.input.invoice_id)) { trace.push({ tool: c.name, refused: "not eligible" }); results.push({ id: c.id, content: "Refused by code: that invoice is not on the eligible list." }); continue; }
        const out = String(await tools.get_invoice.execute({ invoice_id: c.input.invoice_id }));
        read[c.input.invoice_id] = out;
        trace.push({ tool: c.name, invoice: c.input.invoice_id, status: parse(out)?.status || "unknown" });
        results.push({ id: c.id, content: out.slice(0, 2500) });
        continue;
      }
      const problem = reminderProblem(c.input, { eligible, read, sent });
      if (problem) { trace.push({ tool: c.name, invoice: c.input.invoice_id, refused: problem }); results.push({ id: c.id, content: `Refused by code: ${problem}` }); continue; }
      // the model chose whom and wrote the words; code passes exactly those, nothing more
      const out = String(await tools.send_invoice_reminder.execute({ invoice_id: c.input.invoice_id, subject: c.input.subject, note: c.input.note }));
      const j = parse(out), failed = Boolean(j?.error || (j?.name && j?.message)) || /error|failed/i.test(out.slice(0, 120)) && !j;
      if (!failed) { sent.push(c.input.invoice_id); notes[c.input.invoice_id] = { subject: c.input.subject, note: c.input.note }; }
      trace.push({ tool: c.name, invoice: c.input.invoice_id, ok: !failed });
      results.push({ id: c.id, content: failed ? `PayPal refused: ${out.slice(0, 400)}` : "Reminder sent." });
    }
    messages.push({ role: "tool", results });
  }
  return { reminded: sent.map((id) => ({ id, ...notes[id] })), summary: "The agent did not finish.", trace };
}
