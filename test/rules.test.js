// Edge cases of the money rules: duplicates, refunds, attribution windows, payload formats and the evidence gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { packClick, unpackClick, parseAdCsv, reconcile, quotableNumbers, ungroundedNumbers, metaEvents, googleRows, possibleDuplicates } from "../src/ledger.js";
import { checkRecommendation, reconciliationView } from "../src/agent.js";
import { runSendAgent } from "../src/sendAgent.js";

const pay = (o) => ({ capture_id: "C1", order_id: "O1", ad: "trial", source: "fb", click_id: "abc", clicked_at: 1793178000000, amount: "49.00", currency: "USD", captured_at: "2026-10-28T10:00:00Z", payer_email_sha256: "h1", ...o });
const at = (min) => new Date(Date.parse("2026-10-28T10:00:00Z") + min * 60000).toISOString();
const DAY = 86400000;

// click packing
test("unpackClick: an empty or foreign custom_id gives no ad, never throws", () => {
  for (const v of [undefined, "", "order-123", "a=;s=;c=;t="]) assert.doesNotThrow(() => unpackClick(v));
  assert.equal(unpackClick("order-123").clickId || "", "");
});
test("packClick: Google clicks keep their source", () => {
  assert.equal(unpackClick(packClick({ ad: "camp", source: "g", clickId: "Cj0KCQ", clickedAt: 1 })).source, "g");
});

// ad export parsing
test("parseAdCsv: Google Ads export headers (Cost, Conversions)", () => {
  const { rows } = parseAdCsv("Ad name,Cost,Conversions\nHoliday camp,40.00,6");
  assert.deepEqual(rows.map((r) => [r.ad, r.spend_cents, r.leads]), [["Holiday camp", 4000, 6]]);
});
test("parseAdCsv: a byte-order mark and Windows line endings are tolerated", () => {
  const { rows } = parseAdCsv("﻿ad,spend,leads\r\ntrial,96.20,14\r\n");
  assert.equal(rows.length, 1); assert.equal(rows[0].spend_cents, 9620);
});
test("parseAdCsv: money parses to whole cents without float drift", () => {
  const { rows } = parseAdCsv("ad,spend,leads\na,0.10,1\nb,0.20,1\nc,19.99,3");
  assert.deepEqual(rows.map((r) => r.spend_cents), [10, 20, 1999]);
});

// reconciliation
test("reconcile: an ad with spend and no paid order has no cost per paid order", () => {
  const r = reconcile([{ ad: "guide", spend_cents: 11840, leads: 31 }], []);
  assert.equal(r.ads[0].cost_per_paid_cents, null); assert.equal(r.totals.paid, 0); assert.equal(r.totals.spend_without_paid_cents, 11840);
});
test("reconcile: totals equal the sum of the ad rows", () => {
  const ads = [{ ad: "trial", spend_cents: 9620, leads: 14 }, { ad: "camp", spend_cents: 4000, leads: 6 }];
  const r = reconcile(ads, [pay({ capture_id: "A" }), pay({ capture_id: "B", ad: "camp", refunded_amount: "9.00" })]);
  assert.equal(r.totals.leads, 20); assert.equal(r.totals.paid, 2);
  assert.equal(r.totals.revenue_cents, r.ads.reduce((s, a) => s + a.revenue_cents, 0));
  assert.equal(r.totals.revenue_cents, 4900 + 4000);
});
test("reconcile: a payment for an ad missing from the export never inflates an ad", () => {
  const r = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }], [pay({ ad: "elsewhere" })]);
  assert.equal(r.ads[0].paid, 0); assert.deepEqual(r.unmatched_captures, ["C1"]);
});

// duplicates
test("duplicates: same payer and ad within ten minutes are flagged, with the gap in seconds", () => {
  const d = possibleDuplicates([pay({ capture_id: "A", captured_at: at(0) }), pay({ capture_id: "B", captured_at: at(3.6) })]);
  assert.deepEqual(d, [{ capture_id: "B", first: "A", seconds: 216 }]);
});
test("duplicates: another payer, another ad or more than ten minutes apart are not flagged", () => {
  assert.equal(possibleDuplicates([pay({ capture_id: "A" }), pay({ capture_id: "B", payer_email_sha256: "h2", captured_at: at(1) })]).length, 0);
  assert.equal(possibleDuplicates([pay({ capture_id: "A" }), pay({ capture_id: "B", ad: "camp", captured_at: at(1) })]).length, 0);
  assert.equal(possibleDuplicates([pay({ capture_id: "A" }), pay({ capture_id: "B", captured_at: at(11) })]).length, 0);
});
test("duplicates: a fully refunded payment no longer counts as a duplicate", () => {
  assert.equal(possibleDuplicates([pay({ capture_id: "A" }), pay({ capture_id: "B", captured_at: at(1), refunded_amount: "49.00" })]).length, 0);
});
test("duplicates: payments without a payer hash are never paired", () => {
  assert.equal(possibleDuplicates([pay({ capture_id: "A", payer_email_sha256: null }), pay({ capture_id: "B", payer_email_sha256: null, captured_at: at(1) })]).length, 0);
});

// Meta events
test("Meta: a partial refund sends the remaining value", async () => {
  const { events } = await metaEvents([pay({ refunded_amount: "9.00" })]);
  assert.equal(events[0].custom_data.value, 40);
});
test("Meta: event_source_url and a stored user agent are passed through", async () => {
  const { events } = await metaEvents([pay({ user_agent: "Mozilla/5.0 test" })], { sourceUrl: "https://shop.example/shop.html" });
  assert.equal(events[0].event_source_url, "https://shop.example/shop.html");
  assert.equal(events[0].user_data.client_user_agent, "Mozilla/5.0 test");
});
test("Meta: a Google click still reaches Meta through the hashed email, without an fbc", async () => {
  const { events } = await metaEvents([pay({ source: "g", click_id: "Cj0K" })]);
  assert.equal(events.length, 1); assert.equal(events[0].user_data.fbc, undefined); assert.deepEqual(events[0].user_data.em, ["h1"]);
});
test("Meta: exactly 28 days after the click still counts, a day later does not", async () => {
  const clicked = Date.parse("2026-10-01T10:00:00Z");
  const on = (days) => pay({ clicked_at: clicked, captured_at: new Date(clicked + days * DAY).toISOString() });
  assert.equal((await metaEvents([on(28)])).events.length, 1);
  assert.equal((await metaEvents([on(29)])).events.length, 0);
});

// Google rows
test("Google: times keep a PayPal offset and use Google's format", () => {
  const { adjustments } = googleRows([pay({ source: "g", refunded_amount: "49.00", refunded_at: "2026-10-28T21:48:42-07:00" })]);
  assert.equal(adjustments[0].adjustment_time, "2026-10-28 21:48:42-07:00");
});
test("Google: Meta clicks, held duplicates and clicks older than 90 days are left out", () => {
  const clicked = Date.parse("2026-07-01T10:00:00Z");
  const rows = googleRows([pay({ capture_id: "M" }), pay({ capture_id: "H", source: "g" }), pay({ capture_id: "L", source: "g", clicked_at: clicked, captured_at: new Date(clicked + 91 * DAY).toISOString() })], undefined, { hold: new Set(["H"]) });
  assert.equal(rows.conversions.length, 0);
});

// evidence gate
const rec = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }, { ad: "guide", spend_cents: 11840, leads: 31 }], [pay({ capture_id: "A" }), pay({ capture_id: "B", captured_at: at(3.6) })]);
const payments = [pay({ capture_id: "A" }), pay({ capture_id: "B", captured_at: at(3.6) })];
test("gate: capture ids, ad keys and long numeric ids are not treated as invented numbers", () => {
  assert.deepEqual(ungroundedNumbers("Capture 59A98014DG653005N and order 7173180036000123 for trial.", quotableNumbers(rec)), []);
});
test("gate: the duplicate gap is quotable, a made-up gap is not", () => {
  const ok = { headline: "trial has a possible duplicate 216 seconds apart.", caveats: "", actions: [] };
  const bad = { headline: "trial has a possible duplicate 300 seconds apart.", caveats: "", actions: [] };
  assert.deepEqual(checkRecommendation(rec, payments, ok), []);
  assert.match(checkRecommendation(rec, payments, bad).join(" "), /"300"/);
});
test("gate: unknown ads, missing evidence and raw field names are rejected", () => {
  const out = { headline: "Cut spend_usd now.", caveats: "", actions: [{ ad: "ghost", change: "pause", reason: "x", evidence: ["row:ghost", "NOPE"] }] };
  const problems = checkRecommendation(rec, payments, out).join(" ");
  assert.match(problems, /spend_usd/); assert.match(problems, /Ad "ghost"/); assert.match(problems, /Evidence "NOPE"/);
});
test("agent view: possible duplicates are given to the agent, computed in code", () => {
  const v = reconciliationView(rec, payments);
  assert.deepEqual(v.possible_duplicates, [{ capture_id: "B", same_payer_and_ad_as: "A", seconds_apart: 216 }]);
});

// send agent limits
test("send agent: stops after its turn budget without sending", async () => {
  const loop = async () => ({ raw: [{ type: "tool_use", id: "x", name: "get_invoice", input: { invoice_id: "INV2-OK" } }], calls: [{ id: "x", name: "get_invoice", input: { invoice_id: "INV2-OK" } }] });
  const tools = { get_invoice: { execute: async () => "{}" }, send_invoice: { execute: async () => { throw new Error("must not send"); } } };
  const out = await runSendAgent({ llm: loop, tools, approved: { id: "INV2-OK", lead: "L", ad: "a", amount: "49.00" }, maxTurns: 3 });
  assert.equal(out.sent, false); assert.equal(out.trace.length, 3);
});
test("send agent: a toolkit error is reported as not sent", async () => {
  const turns = [{ raw: [], calls: [{ id: "1", name: "send_invoice", input: { invoice_id: "INV2-OK" } }] }, { raw: [{ type: "text", text: "Could not send." }], calls: [] }];
  let i = 0;
  const tools = { send_invoice: { execute: async () => "Error: INVOICE_ALREADY_SENT" } };
  const out = await runSendAgent({ llm: async () => turns[i++], tools, approved: { id: "INV2-OK", lead: "L", ad: "a", amount: "49.00" } });
  assert.equal(out.sent, false); assert.equal(out.trace[0].ok, false);
});
