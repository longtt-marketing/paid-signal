// The budget agent: Claude reads the reconciliation through tools and proposes changes. Code computed every number;
// the agent may only quote them. A gate rejects ungrounded numbers or evidence ids, allows one repair, then flags.
import { adName } from "../web/src/names.js";
import { dollars, quotableNumbers, ungroundedNumbers, possibleDuplicates, paybackOdds, supportedMoves, SHOP_COSTS } from "./ledger.js";
import { checkCall, validate } from "./schema.js";

export const SYSTEM = `You are a performance-marketing analyst for a small business that sells through PayPal.
Ad platforms report leads; PayPal reports who actually paid. Your job: find where ad spend is not producing paid orders and propose budget changes.
Rules:
- Call read_reconciliation first. Call read_captures for any ad you make a claim about.
- Quote only numbers that appear in tool results, written exactly as given. Do not compute new numbers, forecast returns or invent percentages.
- Every action cites evidence: capture ids from read_captures, or "row:<ad key>" for the ad's reconciliation row.
- Small samples are weak evidence. An ad with fewer than 3 paid orders gets "keep" (or "fix_tracking"), never pause, reduce or increase: say it needs more paid orders before its budget moves. Refunds are not paid orders.
- possible_duplicates lists payments that may be the same purchase twice. Those with held: true are already held out of paid_orders and revenue (held_as_possible_duplicate); held: false means one of the two was fully refunded, so only the other counts, and fully_refunded_capture says which one. Whenever you say a payment was refunded, name it by its capture id; never "the first" or "the second". If an ad has one held, say so: if it is a real second purchase, that ad has one more paid order.
- Prefer "keep and gather more data" over a confident change you cannot support.
- An ad with 3 or more paid orders has after_costs_and_fees_per_dollar: what is left of its paid revenue after the shop's own costs and PayPal's fees, per $1 of ad spend. It may be raised only if that is at least $1 and its paid revenue per $1 is at least the average of the ads with 3+ paid orders. It may be reduced or paused only if that is below $1, and then it must be: an ad below $1 after costs is never kept as it is. An ad at or above $1 after costs is not cut, even when it is below the average. Code checks the direction, not just the numbers.
- The owner may add a request. Weigh it, but follow these rules over it: if it asks for a move the payments do not support, do not make it, and say why in plain words.
- For an ad with fewer than 3 paid orders, "keep" is not the whole answer. Its row has small_sample_read, computed in code: the chance its paid revenue covers its ad spend, a likely range (90%) for its cost per paid order, and, while that is unclear, how much more spend with no paid order would make it very likely (90%) below its ad spend. Tell the owner that point in plain words, e.g. "If the next $X brings no paid order, it is very likely below its ad spend: cut it then," with $X taken from the tool result. It assumes the shop's average paid order (average_paid_order_usd), so say so once.
- Write for the shop owner in plain words ("cost per paid order", "spend with no paid order"), never field names such as spend_usd or paid_revenue_per_dollar.
- In the headline, reasons and caveats call an ad by its name (the "name" field, e.g. "Holiday camp · static"), never its key; the key goes only in "ad" and in evidence.
- in_open_dispute counts payments a buyer is disputing with PayPal: they are held out of paid orders and revenue until PayPal resolves them; a dispute the buyer won counts as fully refunded. If an ad has one, say so.
- Paid revenue is already net of refunds; never suggest a refund may not be taken out. Call it "paid revenue minus ad spend" and do not use the word "profit" at all (product cost is unknown). Write money with a dollar sign and its cents, exactly as the tool gives it: $118.40, $36.00 (never $36), a shortfall as "$41.50 below ad spend", paid revenue per dollar as "$0.41 per $1".
- Finish by calling submit_recommendation once.`;

export const TOOLS = [
  { name: "read_reconciliation", description: "Per-ad spend, leads, paid orders, refunds, net paid revenue, cost per paid order and lead-to-paid rate, plus totals. Computed in code from the ad export and PayPal captures.", input_schema: { type: "object", properties: {} } },
  { name: "read_captures", description: "PayPal captures attributed to one ad: capture id, amount, status, refunded amount, capture time.", input_schema: { type: "object", properties: { ad: { type: "string" } }, required: ["ad"] } },
  {
    name: "submit_recommendation", description: "Final recommendation. Call exactly once.",
    input_schema: {
      type: "object", required: ["headline", "actions"],
      properties: {
        headline: { type: "string", description: "One sentence, quoting only tool numbers." },
        actions: {
          type: "array", maxItems: 4, items: {
            type: "object", required: ["ad", "change", "reason", "evidence"],
            properties: {
              ad: { type: "string" }, change: { type: "string", enum: ["pause", "reduce", "increase", "keep", "fix_tracking"] },
              reason: { type: "string" }, evidence: { type: "array", items: { type: "string" }, minItems: 1 },
            },
          },
        },
        caveats: { type: "string" },
      },
    },
  },
];

export function reconciliationView(rec, payments = []) {
  const held = new Set(possibleDuplicates(payments).map((d) => d.capture_id)); // the set reconcile holds out
  const odds = paybackOdds(rec), moves = supportedMoves(rec);
  const read = (o) => o ? {
    chance_paid_revenue_covers_ad_spend: Math.round(o.chance_covers_spend * 100) + "%", verdict: o.verdict,
    likely_cost_per_paid_order: `$${dollars(o.cost_per_paid_range_cents[0])} to $${dollars(o.cost_per_paid_range_cents[1])}`,
    ...(o.more_spend_to_decide_cents !== null ? { more_spend_with_no_paid_order_that_settles_it_usd: dollars(o.more_spend_to_decide_cents) } : {}),
  } : "no spend";
  return {
    totals: { leads: rec.totals.leads, paid_orders: rec.totals.paid, fully_refunded: rec.totals.refunded, held_as_possible_duplicate: rec.totals.held, spend_usd: dollars(rec.totals.spend_cents), paid_revenue_usd: dollars(rec.totals.revenue_cents), in_open_dispute: rec.totals.disputed, spend_on_ads_with_no_paid_order_usd: dollars(rec.totals.spend_without_paid_cents), paid_revenue_minus_ad_spend_usd: dollars(rec.totals.net_cents) },
    ads: rec.ads.map((r) => ({
      ad: r.ad, name: adName(r.ad), spend_usd: dollars(r.spend_cents), leads: r.leads, paid_orders: r.paid, fully_refunded: r.refunded, held_as_possible_duplicate: r.held, in_open_dispute: r.disputed, paid_revenue_usd: dollars(r.revenue_cents),
      cost_per_paid_order_usd: r.cost_per_paid_cents === null ? "none paid" : dollars(r.cost_per_paid_cents),
      lead_to_paid: r.lead_to_paid === null ? "no leads" : Math.round(r.lead_to_paid * 100) + "%", paid_revenue_per_dollar: r.roas === null ? "no spend" : r.roas.toFixed(2),
      paid_revenue_minus_ad_spend_usd: dollars(r.net_cents),
      // only where the 3-order rule keeps the budget: an ad with enough orders is decided on what it returns after costs
      small_sample_read: r.paid < 3 ? read(odds.ads[r.ad]) : "enough paid orders: decide on what it returns after costs",
      ...(moves[r.ad] ? { after_costs_and_fees_per_dollar: moves[r.ad].after_costs.toFixed(2) } : {}),
    })),
    average_paid_order_usd: odds.average_paid_order_cents === null ? "no paid orders" : dollars(odds.average_paid_order_cents),
    shop_costs: `the shop's stated cost of delivering an order is ${Math.round(SHOP_COSTS.cost_share * 100)}% of its price; PayPal's fee is ${(SHOP_COSTS.fee_rate * 100).toFixed(2)}% + $${dollars(SHOP_COSTS.fee_fixed_cents)}`,
    unmatched_captures: rec.unmatched_captures,
    // computed in code (refunded pairs included), so the agent can quote the gap instead of working it out from capture times
    possible_duplicates: possibleDuplicates(payments.map((p) => ({ ...p, refunded_amount: "0.00" }))).map((d) => ({ capture_id: d.capture_id, same_payer_and_ad_as: d.first, seconds_apart: d.seconds, held: held.has(d.capture_id),
      ...(held.has(d.capture_id) ? {} : { fully_refunded_capture: [d.first, d.capture_id].filter((id) => { const p = payments.find((x) => x.capture_id === id); return p && Number(p.refunded_amount || 0) >= Number(p.amount); }).join(" and ") || "none" }) })),
  };
}

/** Checks a submitted recommendation against the reconciliation; returns a list of problems (empty = grounded). */
export function checkRecommendation(rec, payments, out) {
  const shape = validate(out, TOOLS.find((t) => t.name === "submit_recommendation").input_schema, "recommendation");
  if (shape.length) return shape; // the AG Studio budget agent submits here too, so its payload gets the same schema check
  const problems = [];
  const allowed = quotableNumbers(rec);
  const ads = new Set(rec.ads.map((r) => r.ad));
  const ids = new Set(payments.map((p) => p.capture_id));
  // the "fewer than 3 paid orders" rule, and what read_captures shows: amounts and the duplicate gaps. Dates and times are
  // taken out of the text before checking (ungroundedNumbers), so a timestamp's digits never make an invented number pass.
  const extra = [3, 1, "1.00", "90%", `${Math.round(SHOP_COSTS.cost_share * 100)}%`, `${(SHOP_COSTS.fee_rate * 100).toFixed(2)}%`, dollars(SHOP_COSTS.fee_fixed_cents), ...payments.flatMap((p) => [p.amount, p.refunded_amount || "0.00"]), ...possibleDuplicates(payments.map((p) => ({ ...p, refunded_amount: "0.00" }))).map((d) => d.seconds)];
  const texts = [out.headline, out.caveats, ...(out.actions || []).map((a) => a.reason)];
  for (const t of texts) for (const n of ungroundedNumbers(t, allowed, extra)) problems.push(`Number "${n}" is not in the tool results.`);
  // the owner reads this: tool field names (spend_usd, paid_revenue_per_dollar) must become plain words, ad keys the ad's name
  const fields = new Set([...texts.join(" ").matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map((m) => m[0]));
  for (const f of fields) problems.push(ads.has(f) ? `"${f}" is an ad key; call the ad "${adName(f)}".` : `"${f}" is a field name; write it in plain words.`);
  const all = texts.join(" ");
  // a disclaimer ("not profit") is fine; calling a number profit is not
  if (/(?<!\b(?:not|no|isn't)\s(?:a\s)?)\bprofit/i.test(all)) problems.push(`"profit" is not known (product cost is not in the data); say "paid revenue minus ad spend".`);
  // a percentage such as PayPal's 2.99% fee is not money
  for (const m of all.matchAll(/(^|[^$\d.])(\d[\d,]*\.\d{2})\b(?!\s?%)/g)) problems.push(`Write "${m[2]}" as money with a dollar sign, e.g. $${m[2]}.`);
  // which capture was refunded is a ledger fact: a refund sentence names the capture, and the ledger must agree
  const refunded = Object.fromEntries(payments.map((p) => [p.capture_id, Number(p.refunded_amount || 0) > 0]));
  for (const s of all.split(/(?<=[.!?;])\s+/).filter((x) => /refund/i.test(x))) {
    const named = (s.match(/\b[A-Z0-9]{8,}\b/g) || []).filter((id) => id in refunded);
    if (!named.length && /\b(first|second|earlier|later|original)\b/i.test(s)) problems.push(`"${s.trim()}" says which payment was refunded without naming it; give the capture id.`);
    if (named.length === 1 && /refunded/i.test(s)) {
      const saysNot = /\b(?:not|never|un)[\s-]?refunded\b|\bwas(?:n't| not) refunded\b/i.test(s);
      if (saysNot === refunded[named[0]]) problems.push(`Capture ${named[0]} was ${refunded[named[0]] ? "" : "not "}refunded in the ledger.`);
    }
  }
  // the direction of a move must follow the payments, not only quote them
  const moves = supportedMoves(rec);
  for (const a of out.actions || []) {
    const m = moves[a.ad];
    if (m && a.change === "increase" && !m.increase) problems.push(`Raising "${adName(a.ad)}" is not supported: ${m.why}. Only an ad that covers its spend after costs and fees ($1 per $1) and is at or above the average may be raised.`);
    if (m && ["reduce", "pause"].includes(a.change) && !m.reduce) problems.push(`${a.change === "pause" ? "Pausing" : "Cutting"} "${adName(a.ad)}" is not supported: ${m.why}. An ad that covers its spend after costs and fees is not cut.`);
    if (m && a.change === "keep" && !m.keep) problems.push(`Keeping "${adName(a.ad)}" as it is is not supported: ${m.why}. An ad with 3+ paid orders that does not cover its spend after costs and fees must be cut or paused.`);
  }
  for (const a of out.actions || []) {
    const row = rec.ads.find((r) => r.ad === a.ad);
    if (row && ["pause", "reduce", "increase"].includes(a.change) && row.paid < 3)
      problems.push(`"${adName(a.ad)}" has ${row.paid} paid order${row.paid === 1 ? "" : "s"}; with fewer than 3 the change must be keep or fix_tracking, not ${a.change}.`);
    if (!ads.has(a.ad)) problems.push(`Ad "${a.ad}" is not in the reconciliation.`);
    for (const e of a.evidence || []) if (!(e.startsWith("row:") ? ads.has(e.slice(4)) : ids.has(e))) problems.push(`Evidence "${e}" does not exist.`);
  }
  return problems;
}

/** @param {{ llm: any, rec: any, payments: any[], maxTurns?: number, instruction?: string }} opts  instruction: the owner's own request, if any */
export async function runAgent({ llm, rec, payments, maxTurns = 8, instruction = "" }) {
  const trace = [];
  const ask = String(instruction || "").replace(/\s+/g, " ").trim().slice(0, 200);
  /** @type {Array<{ role: string, content?: any, results?: Array<{ id: string, content: string }> }>} */
  const messages = [{ role: "user", content: `Review this shop's last ad period and recommend budget changes.${ask ? ` The owner adds: "${ask}"` : ""}` }];
  let repaired = false;
  for (let turn = 0; turn < maxTurns; turn++) {
    const { raw, calls } = await llm(messages);
    messages.push({ role: "assistant", content: raw });
    if (!calls.length) { messages.push({ role: "user", content: "Call submit_recommendation to finish." }); continue; }
    const results = [];
    for (const c of calls) {
      // every call is checked against the tool's declared JSON Schema before anything runs
      const bad = checkCall(TOOLS, c);
      if (bad.length) { trace.push({ tool: c.name, refused: bad.slice(0, 4) }); results.push({ id: c.id, content: `Refused by code: ${bad.join(" ")}` }); continue; }
      if (c.name === "read_reconciliation") { trace.push({ tool: c.name }); results.push({ id: c.id, content: JSON.stringify(reconciliationView(rec, payments)) }); }
      else if (c.name === "read_captures") {
        const list = payments.filter((p) => p.ad === c.input.ad).map((p) => ({ capture_id: p.capture_id, amount_usd: p.amount, status: p.status, refunded_usd: p.refunded_amount || "0.00", captured_at: p.captured_at }));
        trace.push({ tool: c.name, ad: c.input.ad, n: list.length }); results.push({ id: c.id, content: JSON.stringify(list) });
      } else if (c.name === "submit_recommendation") {
        const problems = checkRecommendation(rec, payments, c.input);
        trace.push({ tool: c.name, problems: problems.length, ...(problems.length ? { why: problems.slice(0, 4) } : {}) });
        if (!problems.length || repaired) return { recommendation: c.input, grounded: !problems.length, problems, trace };
        repaired = true;
        results.push({ id: c.id, content: `Rejected by the evidence check: ${problems.join(" ")} Fix only these and call submit_recommendation again.` });
      } else results.push({ id: c.id, content: `Unknown tool ${c.name}.` });
    }
    messages.push({ role: "tool", results });
  }
  return { recommendation: null, grounded: false, problems: ["The agent did not finish."], trace };
}

/** Anthropic Messages API adapter; tool results are sent back as tool_result blocks. */
/** @param {{ apiKey: string, workspaceId?: string, model?: string, fetchImpl?: typeof fetch, timeoutMs?: number, system?: string, tools?: any[] }} opts */
export function anthropicLLM({ apiKey, workspaceId, model = "claude-sonnet-5-5", fetchImpl = fetch, timeoutMs = 60000, system = SYSTEM, tools = TOOLS }) {
  return async (messages) => {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}) },
      body: JSON.stringify({
        model, max_tokens: 4000, system, tools,
        messages: messages.map((m) => m.role === "tool" ? { role: "user", content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content })) } : m),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return { raw: body.content, calls: body.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input })) };
  };
}
