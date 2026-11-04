import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readMerchantCase, gapHTML } from "../src/merchantCase.js";

const c = JSON.parse(readFileSync(new URL("../docs/proof/merchant-case-2026-10.json", import.meta.url), "utf8"));
const r = readMerchantCase(c);

test("the shop's month adds up", () => {
  assert.equal(r.totals.spend, 260000000);
  assert.equal(r.totals.conversations, 12100);
  assert.equal(r.totals.paid, 705);
  assert.equal(r.totals.net, 1317000000);
  assert.equal(r.totals.roas.toFixed(2), "5.07");
  assert.ok(r.invoices_add_up, "paid + unpaid + cancelled = issued, and paid invoices = first paid orders");
});

test("per group, as the judge page quotes it", () => {
  const g = Object.fromEntries(r.groups.map((x) => [x.id, x]));
  assert.deepEqual([g.A.paid, g.B.paid, g.C.paid], [145, 390, 170]);
  assert.deepEqual([g.A.roas, g.B.roas, g.C.roas].map((x) => x.toFixed(2)), ["1.81", "9.88", "7.16"]);
  assert.equal((g.A.share_conversations * 100).toFixed(1), "69.4");
  assert.equal((g.A.share_net * 100).toFixed(1), "19.3");
  assert.equal((g.B.share_net * 100).toFixed(1), "56.3");
});

test("the two readings rank the ads in opposite order, and the demo's budget rule follows the money", () => {
  assert.deepEqual(r.rank_by_cost_per_conversation, ["A", "B", "C"]);
  assert.deepEqual(r.rank_by_money_kept, ["B", "C", "A"]);
  const s = Object.fromEntries(r.paid_signal_split.map((x) => [x.id, x]));
  assert.ok(s.A.share_proposed < s.A.share_now && s.B.share_proposed > s.B.share_now && s.C.share_proposed > s.C.share_now);
  assert.ok(Math.abs(r.paid_signal_split.reduce((n, x) => n + x.share_proposed, 0) - 1) < 1e-9);
});

test("the page's copy is the current read", () => {
  const page = JSON.parse(readFileSync(new URL("../public/data/merchant-case.json", import.meta.url), "utf8"));
  assert.deepEqual(page.read, JSON.parse(JSON.stringify(r)));
});

test("the judge page carries the shop section as static HTML, matching the current read", () => {
  const html = readFileSync(new URL("../public/judge.html", import.meta.url), "utf8");
  const c = JSON.parse(readFileSync(new URL("../docs/proof/merchant-case-2026-10.json", import.meta.url), "utf8"));
  assert.ok(html.includes(`<!--gap:start-->${gapHTML(r, c)}<!--gap:end-->`));
  assert.ok(html.includes("69.4%") && html.includes("VietQR"));
});
