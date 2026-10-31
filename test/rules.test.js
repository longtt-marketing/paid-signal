// Edge cases of the money rules: duplicates, refunds, attribution windows, payload formats and the evidence gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { packClick, unpackClick, parseAdCsv, reconcile, quotableNumbers, ungroundedNumbers, metaEvents, googleRows, possibleDuplicates, paybackOdds, disputeState } from "../src/ledger.js";
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
test("Meta: a buyer from a Google click is held for Google, so Meta cannot take credit for it", async () => {
  const { events, held } = await metaEvents([pay({ source: "g", click_id: "Cj0K" })]);
  assert.equal(events.length, 0); assert.equal(held[0].reason, "Google click: sent to Google instead");
});
test("Meta: exactly 7 days after the click still counts, a day later does not", async () => {
  const clicked = Date.parse("2026-10-01T10:00:00Z");
  const on = (days) => pay({ clicked_at: clicked, captured_at: new Date(clicked + days * DAY).toISOString() });
  assert.equal((await metaEvents([on(7)])).events.length, 1);
  assert.equal((await metaEvents([on(8)])).events.length, 0);
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

test("reconcile: a possible duplicate is held out of paid orders and revenue, the same rule as the ad platforms", () => {
  const r = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }], [pay({ capture_id: "A" }), pay({ capture_id: "B", captured_at: at(3.6) }), pay({ capture_id: "C", payer_email_sha256: "h2", captured_at: at(30) })]);
  const row = r.ads[0];
  assert.deepEqual([row.paid, row.held, row.revenue_cents, row.held_cents, row.cost_per_paid_cents], [2, 1, 9800, 4900, 4810]);
  assert.deepEqual([r.totals.paid, r.totals.held], [2, 1]);
  // once the duplicate is refunded it is a refund, not a held order
  const after = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }], [pay({ capture_id: "A" }), pay({ capture_id: "B", captured_at: at(3.6), refunded_amount: "49.00" })]).ads[0];
  assert.deepEqual([after.paid, after.held, after.refunded], [1, 0, 1]);
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
  assert.deepEqual(v.possible_duplicates, [{ capture_id: "B", same_payer_and_ad_as: "A", seconds_apart: 216, held: true }]);
  // the first of the pair refunded: B counts as paid, and the agent is told it is not held
  const refundedFirst = [pay({ capture_id: "A", refunded_amount: "49.00" }), pay({ capture_id: "B", captured_at: at(3.6) })];
  const r2 = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }], refundedFirst);
  assert.deepEqual([r2.ads[0].paid, r2.ads[0].held], [1, 0]);
  assert.equal(reconciliationView(r2, refundedFirst).possible_duplicates[0].held, false);
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
  const tools = { get_invoice: { execute: async () => JSON.stringify({ status: "DRAFT", amount: { currency_code: "USD", value: "49.00" } }) },
    send_invoice: { execute: async () => "Error: INVOICE_ALREADY_SENT" } };
  const out = await runSendAgent({ llm: async () => turns[i++], tools, approved: { id: "INV2-OK", lead: "L", ad: "a", amount: "49.00" } });
  assert.equal(out.sent, false); assert.equal(out.trace[0].ok, false);
});

test("budget split by paid orders: shares sum to the budget, every ad keeps at least 10%, the best payer gets the most", async () => {
  const { proposeSplit } = await import("../src/ledger.js");
  const out = proposeSplit([{ ad: "guide", spend: 118.4, paid: 3 }, { ad: "trial", spend: 96.2, paid: 4 }, { ad: "carousel", spend: 71.9, paid: 6 }, { ad: "camp", spend: 40, paid: 3 }], 326.5);
  assert.ok(Math.abs(out.reduce((n, x) => n + x.budget, 0) - 326.5) < 0.05);
  assert.ok(out.every((x) => x.share >= 0.1));
  assert.equal(out.sort((a, b) => b.share - a.share)[0].ad, "carousel");
});

test("budget split: an ad with fewer than 3 paid orders keeps its share; with fewer than two such ads nothing moves", async () => {
  const { proposeSplit } = await import("../src/ledger.js");
  const demo = proposeSplit([{ ad: "guide", spend: 118.4, paid: 1 }, { ad: "trial", spend: 96.2, paid: 2 }, { ad: "carousel", spend: 71.9, paid: 2 }, { ad: "camp", spend: 40, paid: 1 }], 326.5);
  assert.deepEqual(demo.map((x) => x.budget), [118.4, 96.2, 71.9, 40]);
  assert.match(demo[3].reason, /fewer than 3/);
  const mixed = proposeSplit([{ ad: "a", spend: 100, paid: 1 }, { ad: "b", spend: 100, paid: 3 }, { ad: "c", spend: 100, paid: 9 }], 300);
  assert.equal(mixed[0].budget, 100); // kept
  assert.ok(Math.abs(mixed[1].budget + mixed[2].budget - 200) < 0.05 && mixed[2].budget > mixed[1].budget);
});

test("Meta: no made-up click time; an invoice payment is matched on the lead's hashed email, or held if there is nothing to match", async () => {
  const { metaEvents } = await import("../src/ledger.js");
  const inv = { capture_id: "I1", order_id: "INV2-1", ad: "guide", source: "fb", click_id: "IwARx", clicked_at: 0, amount: "49.00", currency: "USD", captured_at: "2026-10-28T10:00:00Z" };
  const withEmail = await metaEvents([{ ...inv, payer_email_sha256: "abc" }]);
  assert.equal(withEmail.events[0].user_data.fbc, undefined);
  assert.deepEqual(withEmail.events[0].user_data.em, ["abc"]);
  const bare = await metaEvents([{ ...inv, payer_email_sha256: null }]);
  assert.equal(bare.events.length, 0);
  assert.equal(bare.held[0].reason, "nothing Meta can match on");
});

test("each ad shows paid revenue minus its spend, refunds out, and the agent may quote it", () => {
  const rec = reconcile([{ ad: "a", spend_cents: 5000, leads: 4 }, { ad: "b", spend_cents: 1000, leads: 2 }],
    [{ capture_id: "C1", ad: "a", amount: "49.00", refunded_amount: "49.00" }, { capture_id: "C2", ad: "b", amount: "35.95", refunded_amount: "0.00" }]);
  assert.equal(rec.ads[0].net_cents, -5000);
  assert.equal(rec.ads[1].net_cents, 2595);
  assert.equal(rec.totals.net_cents, -2405);
  const ok = quotableNumbers(rec);
  assert.ok(ok.has("50.00") && ok.has("25.95") && ok.has("24.05"));
});

test("gate: an ad key in text the owner reads is refused and the ad's name is suggested", () => {
  const rec = reconcile([{ ad: "free_guide", spend_cents: 11840, leads: 31 }], [pay({ ad: "free_guide" })]);
  const problems = checkRecommendation(rec, [pay({ ad: "free_guide" })], { headline: "Watch free_guide.", caveats: "", actions: [{ ad: "free_guide", change: "keep", reason: "Free guide · lead form brings leads that rarely pay.", evidence: ["row:free_guide"] }] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Free guide · lead form/);
});

test("ad export: negative or non-numeric spend and leads are refused, not guessed", () => {
  const out = parseAdCsv("ad,spend,leads\nfoo,abc,-5\nbar,10.50,3\nbaz,$1,234.00,7");
  assert.deepEqual(out.rows.map((r) => r.ad), ["bar"]);
  assert.equal(out.errors.length, 2);
});

test("Meta: an invoice payment is a chat conversion with no page URL; a checkout is a website one", async () => {
  const { metaEvents } = await import("../src/ledger.js");
  const { events } = await metaEvents([pay({ capture_id: "W1" }), pay({ capture_id: "I1", via: "invoice", clicked_at: 0, payer_email_sha256: "abc" })], { sourceUrl: "https://x/shop" });
  assert.equal(events.find((e) => e.event_id === "paypal:W1").action_source, "website");
  const inv = events.find((e) => e.event_id === "paypal:I1");
  assert.equal(inv.action_source, "chat"); assert.equal(inv.event_source_url, undefined);
});

test("gate: a refund claim must name the capture, and the ledger must agree", () => {
  const ps = [pay({ capture_id: "CAPTUREAA1", refunded_amount: "49.00" }), pay({ capture_id: "CAPTUREBB2", captured_at: at(3.6) })];
  const r = reconcile([{ ad: "trial", spend_cents: 9620, leads: 14 }], ps);
  const say = (caveats) => checkRecommendation(r, ps, { headline: "Trial is steady.", caveats, actions: [] });
  assert.deepEqual(say("Capture CAPTUREAA1 was refunded, so it does not count."), []);
  assert.deepEqual(say("Capture CAPTUREBB2 was not refunded, so it counts."), []);
  assert.match(say("Capture CAPTUREBB2 was refunded, so it does not count.").join(" "), /CAPTUREBB2 was not refunded/);
  assert.match(say("In each pair the second was refunded, so the first counts.").join(" "), /without naming it/);
});

// small samples: what one or two paid orders do say
const oddsRec = () => reconcile([{ ad: "a", spend_cents: 10000, leads: 20 }, { ad: "b", spend_cents: 10000, leads: 5 }, { ad: "c", spend_cents: 500, leads: 9 }],
  [pay({ capture_id: "A1", ad: "a", amount: "50.00" }), pay({ capture_id: "B1", ad: "b", amount: "50.00", payer_email_sha256: "h2" })]);

test("paybackOdds: matches the closed form, and one order on twice the shop's cost per order is likely below its spend", () => {
  // shop: $205 for 2 orders of $50, so the prior is one order per $102.50; ad a: Gamma(2, 202.5), covers when rate >= 1/50
  const o = paybackOdds(oddsRec()).ads.a, x = 202.5 / 50;
  assert.ok(Math.abs(o.chance_covers_spend - Math.exp(-x) * (1 + x)) < 1e-9);
  assert.equal(o.verdict, "likely below its ad spend"); assert.equal(o.more_spend_to_decide_cents, null);
});

test("paybackOdds: an unclear ad gets the spend that settles it, to the dollar", () => {
  const o = paybackOdds(oddsRec()).ads.c;
  assert.equal(o.verdict, "not clear yet");
  // no order yet: Gamma(1, 102.5 + 5 + S); "below its spend" is 90% likely once e^-x <= 0.1, and not a dollar earlier
  const x = (102.5 + 5 + o.more_spend_to_decide_cents / 100) / 50;
  assert.ok(Math.exp(-x) <= 0.1 && Math.exp(-(x - 1 / 50)) > 0.1);
});

test("paybackOdds: no paid order in the shop means no read at all", () => {
  const rec = reconcile([{ ad: "a", spend_cents: 5000, leads: 3 }], []);
  assert.deepEqual(paybackOdds(rec), { average_paid_order_cents: null, ads: {} });
});

test("gate: the small-sample read can be quoted; a made-up settling spend cannot", () => {
  const rec = oddsRec(), payments = [pay({ capture_id: "A1", ad: "a", amount: "50.00" }), pay({ capture_id: "B1", ad: "b", amount: "50.00", payer_email_sha256: "h2" })];
  const view = reconciliationView(rec, payments).ads.find((r) => r.ad === "c").small_sample_read;
  const S = view.more_spend_with_no_paid_order_that_settles_it_usd;
  const rec1 = (s) => ({ headline: "Every ad has fewer than 3 paid orders.", actions: [{ ad: "c", change: "keep", reason: `${view.chance_paid_revenue_covers_ad_spend} chance it covers its ad spend; if the next $${s} brings no paid order, it is very likely (90%) below its ad spend.`, evidence: ["row:c"] }] });
  assert.deepEqual(checkRecommendation(rec, payments, rec1(S)), []);
  assert.ok(checkRecommendation(rec, payments, rec1("77.00")).some((p) => p.includes("77.00")));
});

// disputes: a buyer's PayPal dispute takes the payment out of the signal while open, and back like a refund if lost
const open = { id: "PP-D-1", status: "WAITING_FOR_SELLER_RESPONSE" };
test("disputes: open, lost (buyer favour or claim accepted) and won", () => {
  assert.equal(disputeState(pay({})), null);
  assert.equal(disputeState(pay({ dispute: open })), "open");
  for (const outcome of ["RESOLVED_BUYER_FAVOUR", "ACCEPTED"]) assert.equal(disputeState(pay({ dispute: { status: "RESOLVED", outcome } })), "lost");
  assert.equal(disputeState(pay({ dispute: { status: "RESOLVED", outcome: "RESOLVED_SELLER_FAVOUR" } })), "won");
});

test("disputes: an open one is not a paid order or revenue; a lost one counts as refunded; a won one counts", () => {
  const rows = [{ ad: "trial", spend_cents: 10000, leads: 4 }];
  const r = (d) => reconcile(rows, [pay({ capture_id: "C1", dispute: d }), pay({ capture_id: "C2", payer_email_sha256: "h2", captured_at: at(60) })]).ads[0];
  assert.deepEqual(((x) => [x.paid, x.disputed, x.disputed_cents, x.revenue_cents])(r(open)), [1, 1, 4900, 4900]);
  assert.deepEqual(((x) => [x.paid, x.refunded, x.revenue_cents])(r({ status: "RESOLVED", outcome: "RESOLVED_BUYER_FAVOUR" })), [1, 1, 4900]);
  assert.deepEqual(((x) => [x.paid, x.disputed, x.revenue_cents])(r({ status: "RESOLVED", outcome: "RESOLVED_SELLER_FAVOUR" })), [2, 0, 9800]);
});

test("disputes: Meta is not sent an open or lost one; Google holds an open one and retracts a lost one", async () => {
  const m = await metaEvents([pay({ capture_id: "C1", dispute: open }), pay({ capture_id: "C2", dispute: { status: "RESOLVED", outcome: "ACCEPTED" } })]);
  assert.deepEqual([m.events.length, m.held.map((h) => h.reason)], [0, ["open PayPal dispute", "dispute lost: the buyer was refunded"]]);
  const g = googleRows([pay({ capture_id: "G1", source: "g", dispute: open }), pay({ capture_id: "G2", source: "g", dispute: { status: "RESOLVED", outcome: "RESOLVED_BUYER_FAVOUR", updated_at: "2026-10-30T10:00:00Z" } })]);
  assert.deepEqual(g.conversions.map((c) => c.order_id), ["G2"]);
  assert.deepEqual(g.adjustments.map((a) => [a.order_id, a.adjustment_type]), [["G2", "RETRACTION"]]);
});

// the gate checks the direction of a move, not only its numbers
import { supportedMoves } from "../src/ledger.js";
import { SCENARIOS } from "../src/scenarios.js";
test("direction: every week's right answer passes, and the opposite move on a ready ad is refused", () => {
  for (const s of SCENARIOS) {
    const rec = reconcile(s.ads, s.payments), moves = supportedMoves(rec);
    for (const [ad, change] of s.moves) {
      const ok = { headline: "A week with enough paid orders.", actions: [{ ad, change, reason: "Paid orders support it.", evidence: [`row:${ad}`] }] };
      assert.deepEqual(checkRecommendation(rec, s.payments, ok), [], `${s.id} ${ad} ${change}`);
      const wrong = { ...ok, actions: [{ ...ok.actions[0], change: change === "increase" ? "reduce" : "increase" }] };
      assert.ok(checkRecommendation(rec, s.payments, wrong).some((p) => /not supported/.test(p)), `${s.id} ${ad} opposite`);
    }
    assert.ok(Object.values(moves).every((m) => !(m.increase && m.reduce)));
  }
});

test("direction: raising the ad with the most leads but less than $1 back per $1 is refused with the numbers", () => {
  const s = SCENARIOS.find((x) => x.id === "lead_rich"), rec = reconcile(s.ads, s.payments);
  const out = { headline: "Raise the free guide.", actions: [{ ad: "free_guide", change: "increase", reason: "It brings the most leads.", evidence: ["row:free_guide"] }] };
  const p = checkRecommendation(rec, s.payments, out).join(" ");
  assert.match(p, /Raising "Free guide · lead form" is not supported: \$0\.38 of paid revenue per \$1/);
});

import { runAgent } from "../src/agent.js";
test("owner request: it reaches the agent as the owner's words, trimmed, and the gate still refuses an unsupported move", async () => {
  const s = SCENARIOS.find((x) => x.id === "lead_rich"), rec = reconcile(s.ads, s.payments);
  let first = "";
  const raise = { headline: "Raised as asked.", actions: [{ ad: "free_guide", change: "increase", reason: "The owner asked.", evidence: ["row:free_guide"] }] };
  // after costs the free guide does not cover its spend, so the repaired answer cuts it (keeping it as it is is refused too)
  const cut = { headline: "Cut: it returns too little per dollar.", actions: [{ ad: "free_guide", change: "reduce", reason: "Not raised.", evidence: ["row:free_guide"] }] };
  const turns = [raise, cut];
  const llm = async (messages) => { first ||= messages[0].content; const input = turns.shift(); return { raw: [], calls: [{ id: String(turns.length), name: "submit_recommendation", input }] }; };
  const out = await runAgent({ llm, rec, payments: s.payments, instruction: "  Raise the free guide,\n it brings the most leads. " + "x".repeat(300) });
  assert.match(first, /The owner adds: "Raise the free guide, it brings the most leads\. x+"/);
  assert.ok(first.length < 320);
  assert.deepEqual([out.grounded, out.trace[0].problems, out.recommendation.actions[0].change], [true, 1, "reduce"]);
});

test("direction: a money-losing ad with 3+ orders may not be kept as it is, and a profitable one below the average may not be cut", () => {
  const ads = [{ ad: "a", spend_cents: 13000, leads: 9 }, { ad: "b", spend_cents: 5000, leads: 4 }, { ad: "c", spend_cents: 9000, leads: 6 }];
  const ps = [...[1, 2, 3].map((n) => pay({ capture_id: `A${n}`, ad: "a", payer_email_sha256: `pa${n}` })),
    ...[1, 2, 3].map((n) => pay({ capture_id: `B${n}`, ad: "b", payer_email_sha256: `pb${n}` })), ...[1, 2, 3].map((n) => pay({ capture_id: `C${n}`, ad: "c", payer_email_sha256: `pc${n}` }))];
  const rec = reconcile(ads, ps), m = supportedMoves(rec);
  // a: $1.13 per $1, loses after costs; b: $2.94, the best; c: $1.63, covers its spend after costs but is below the average
  assert.deepEqual([m.a.keep, m.a.reduce, m.c.after_costs >= 1, m.c.per_dollar < m.c.average, m.c.reduce, m.c.keep, m.c.increase], [false, true, true, true, false, true, false]);
  const check = (ad, change) => checkRecommendation(rec, ps, { headline: "x", actions: [{ ad, change, reason: "x", evidence: [`row:${ad}`] }] });
  assert.ok(check("a", "keep").some((p) => /must be cut or paused/.test(p)));
  assert.ok(check("c", "reduce").some((p) => /is not cut/.test(p)));
  assert.deepEqual(check("a", "pause"), []);
});

test("disputes: an outcome that is not clearly the shop's win is never counted as one", () => {
  for (const outcome of ["RESOLVED_WITH_PAYOUT", "NONE", "SOMETHING_NEW", null]) assert.equal(disputeState(pay({ dispute: { status: "RESOLVED", outcome } })), "unclear");
  for (const outcome of ["CANCELED_BY_BUYER", "DENIED"]) assert.equal(disputeState(pay({ dispute: { status: "RESOLVED", outcome } })), "won");
  const r = reconcile([{ ad: "trial", spend_cents: 10000, leads: 4 }], [pay({ dispute: { status: "RESOLVED", outcome: "RESOLVED_WITH_PAYOUT" } })]).ads[0];
  assert.deepEqual([r.paid, r.disputed], [0, 1]);
});

import { afterCostsPerDollar, SHOP_COSTS } from "../src/ledger.js";
test("direction: an ad above $1 per $1 in paid revenue but below it after costs and fees may not be raised", () => {
  // 3 orders of $49 on $130: $1.13 per $1 in paid revenue, $0.73 after 30% cost and 2.99% + $0.49 per order
  const rec = reconcile([{ ad: "a", spend_cents: 13000, leads: 9 }], [1, 2, 3].map((n) => pay({ capture_id: `A${n}`, ad: "a", payer_email_sha256: `p${n}` })));
  const row = rec.ads[0], m = supportedMoves(rec).a;
  // the estimated fee is rounded to the cent per order, as PayPal charges it
  assert.ok(Math.abs(afterCostsPerDollar(row) - (14700 * (1 - SHOP_COSTS.cost_share) - 14700 * SHOP_COSTS.fee_rate - 3 * 49) / 13000) < 0.001);
  assert.deepEqual([m.per_dollar > 1, m.after_costs < 1, m.increase, m.reduce], [true, true, false, true]);
});

test("fees: PayPal's own fee on a capture is used when known, the published rate only when it is not", () => {
  const ads = [{ ad: "a", spend_cents: 10000, leads: 5 }];
  const est = reconcile(ads, [1, 2, 3].map((n) => pay({ capture_id: `F${n}`, ad: "a", payer_email_sha256: `p${n}` })));
  const seen = reconcile(ads, [1, 2, 3].map((n) => pay({ capture_id: `F${n}`, ad: "a", payer_email_sha256: `p${n}`, fee: "2.50" })));
  assert.deepEqual([est.ads[0].fee_cents, est.ads[0].fees_observed], [3 * (147 + 49), 0]);
  assert.deepEqual([seen.ads[0].fee_cents, seen.ads[0].fees_observed], [750, 3]);
  assert.ok(afterCostsPerDollar(seen.ads[0]) < afterCostsPerDollar(est.ads[0]));
});

test("money format: a percentage with two decimals (PayPal's 2.99% fee) is not money missing its dollar sign", () => {
  const s = SCENARIOS.find((x) => x.id === "week4"), rec = reconcile(s.ads, s.payments);
  const out = (reason) => checkRecommendation(rec, s.payments, { headline: "Week 4.", actions: [{ ad: "trial_video", change: "keep", reason, evidence: ["row:trial_video"] }] });
  assert.ok(!out("After the shop's 30% cost and PayPal's 2.99% + $0.49 fee.").some((p) => /dollar sign/.test(p)));
  assert.ok(out("It took 49.00 from the ad.").some((p) => /dollar sign/.test(p)));
});
