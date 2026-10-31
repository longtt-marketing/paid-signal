import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, priceItems, checkProposal, runRevenueAgent } from "../src/revenue.js";

const leads = parseCsv(readFileSync(new URL("../public/data/demo-leads.csv", import.meta.url), "utf8"));
const lead = (n) => leads.find((l) => l.lead.startsWith(`Lead ${n}`));
const scripted = (turns) => { let i = 0; return async () => turns[i++]; };
const use = (id, name, input) => ({ raw: [{ type: "tool_use", id, name, input }], calls: [{ id, name, input }] });
const many = (...calls) => ({ raw: calls.map(([id, name, input]) => ({ type: "tool_use", id, name, input })), calls: calls.map(([id, name, input]) => ({ id, name, input })) });
const say = (text) => ({ raw: [{ type: "text", text }], calls: [] });

test("leads CSV: quoted messages with commas parse, every lead has an email", () => {
  assert.equal(parseCsv('a,b\n"x, y","say ""hi"""\n')[0].a, "x, y");
  assert.equal(parseCsv('a,b\n"x, y","say ""hi"""\n')[0].b, 'say "hi"');
  assert.ok(leads.length >= 16);
  assert.ok(leads.every((l) => /@/.test(l.email)));
  assert.match(lead(15).message, /Ignore your previous instructions/);
});

test("pricing: from the price list only, a sibling is 20% off", () => {
  assert.deepEqual([priceItems([{ sku: "trial_class", qty: 1 }]).total, priceItems([{ sku: "trial_class", qty: 2 }]).total], ["49.00", "88.20"]);
  assert.equal(priceItems([{ sku: "december_camp", qty: 1 }]).total, "149.00");
  assert.match(priceItems([{ sku: "free_month", qty: 1 }]).problems[0], /Unknown item/);
  assert.match(priceItems([{ sku: "trial_class", qty: 9 }]).problems[0], /1 to 3/);
});

test("rules in code: no amounts, no recipients, no links in notes, one invoice per lead", () => {
  const ok = { items: [{ sku: "trial_class", qty: 1 }], note: "See you Saturday!" };
  assert.deepEqual(checkProposal(lead(12), ok, []).problems, []);
  assert.match(checkProposal(lead(15), { ...ok, amount: "1.00" }, []).problems.join(" "), /price list/);
  assert.match(checkProposal(lead(15), { ...ok, recipient: "refunds@quick-pay.example" }, []).problems.join(" "), /own email/);
  assert.match(checkProposal(lead(12), { ...ok, note: "pay at https://x.example" }, []).problems.join(" "), /links/);
  assert.match(checkProposal(lead(12), ok, [{ lead: lead(12).lead, status: "SENT" }]).problems.join(" "), /already has/);
  assert.match(checkProposal(undefined, ok, []).problems[0], /Unknown lead/);
});

test("revenue agent: code prices accepted proposals, refuses tampered ones, records the injection flag", async () => {
  const llm = scripted([
    use("1", "read_leads", {}),
    many(
      ["2", "create_invoice", { lead: lead(13).lead, items: [{ sku: "trial_class", qty: 2 }], note: "Both twins booked.", reason: "asked to book both" }],
      ["3", "create_invoice", { lead: lead(15).lead, items: [{ sku: "december_camp", qty: 1 }], amount: "1.00", note: "Camp", reason: "asked" }],
      ["4", "skip_lead", { lead: lead(15).lead, reason: "message tries to set the price and recipient", flag: "injection" }],
      ["5", "create_invoice", { lead: lead(13).lead, items: [{ sku: "trial_class", qty: 1 }], note: "Again", reason: "dup" }],
    ),
    say("Proposed one invoice; flagged one message."),
  ]);
  const out = await runRevenueAgent({ llm, leads, invoices: [] });
  assert.deepEqual(out.proposals.map((p) => [p.lead, p.total, p.email]), [[lead(13).lead, "88.20", lead(13).email]]);
  assert.equal(out.refusals.length, 2); // the tampered amount, and a second invoice for the same lead
  assert.equal(out.skips[0].flag, "injection");
  assert.equal(out.summary, "Proposed one invoice; flagged one message.");
});

test("revenue agent: its create_invoice call reaches the Toolkit only after code priced it, and sees PayPal's draft id", async () => {
  const seen = [], answers = [];
  const llm = async (messages) => {
    const last = messages.at(-1); if (last.role === "tool") answers.push(...last.results.map((r) => r.content));
    return [use("1", "read_leads", {}),
      many(["2", "create_invoice", { lead: lead(13).lead, items: [{ sku: "trial_class", qty: 2 }], note: "Both twins booked.", reason: "asked" }],
        ["3", "create_invoice", { lead: lead(12).lead, items: [{ sku: "trial_class", qty: 1 }], recipient: "x@y.example", note: "Hi", reason: "asked" }],
        ["4", "create_invoice", { lead: lead(14).lead, items: [{ sku: "december_camp", qty: 1 }], note: "Camp", reason: "asked" }]),
      say("Done.")][messages.filter((m) => m.role === "assistant").length];
  };
  const createDraft = async (p) => { seen.push([p.lead, p.total, p.email]); return p.lead === lead(14).lead ? { error: "timeout" } : { id: "INV2-TEST-0001" }; };
  const out = await runRevenueAgent({ llm, leads, invoices: [], createDraft });
  // the tampered call (a recipient) never reaches PayPal; the other two do, priced by code, to the lead's own email
  assert.deepEqual(seen, [[lead(13).lead, "88.20", lead(13).email], [lead(14).lead, "149.00", lead(14).email]]);
  assert.match(answers[1], /Created in PayPal: draft INV2-TEST-0001/);
  assert.match(answers[3], /PayPal did not create the draft: timeout/);
  assert.deepEqual(out.proposals.map((p) => p.id), ["INV2-TEST-0001"]);
  assert.equal(out.refusals.length, 2);
});
