// AG Studio only groups and sums rows the server already settled: its totals must equal the ledger's and the shop book's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { parseAdCsv, reconcile } from "../src/ledger.js";

const studioDist = new URL("../web/node_modules/ag-studio/package.json", import.meta.url);
const skip = !existsSync(studioDist) && "install web/ first (npm ci --prefix web)";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("Studio's Ads table adds up to the ledger's totals", { skip }, async () => {
  const { buildData } = await import("../web/src/studio.js");
  const ads = parseAdCsv(read("../public/data/demo-ads.csv")).rows;
  const pay = (id, ad, amount, refunded = "0.00") => ({ capture_id: id, ad, amount, refunded_amount: refunded, status: Number(refunded) >= Number(amount) ? "REFUNDED" : "COMPLETED",
    source: "fb", click_id: `c${id}`, captured_at: `2026-11-0${id.length}T10:00:00Z` });
  const payments = [pay("A", "parent_carousel", "49.00"), pay("BB", "parent_carousel", "49.00"), pay("CCC", "trial_video", "49.00", "49.00"), pay("D", "free_guide", "49.00", "9.00")];
  const rec = reconcile(ads, payments);
  const data = buildData(rec, payments);
  const t = data.sources.find((s) => s.id === "ads").data;
  const sum = (k) => Math.round(t.reduce((n, r) => n + r[k], 0) * 100);
  assert.equal(sum("spend"), rec.totals.spend_cents);
  assert.equal(sum("revenue"), rec.totals.revenue_cents);
  assert.equal(t.reduce((n, r) => n + r.leads, 0), rec.totals.leads);
  assert.equal(t.reduce((n, r) => n + r.payers, 0), rec.totals.paid);
});

test("Studio's real-shop tables add up to the shop's book: 705 kept orders, 1,317M VND, 12,100 chats", { skip }, async () => {
  const { shopSources } = await import("../web/src/studio.js");
  const c = JSON.parse(read("../public/data/merchant-case.json"));
  const s = shopSources(c.read, read("../public/data/shop/payments-2026-10.csv"));
  const groups = s.sources.find((x) => x.id === "shopGroups").data, pays = s.sources.find((x) => x.id === "shopPayments").data;
  assert.equal(groups.reduce((n, g) => n + g.kept, 0), 705);
  assert.equal(groups.reduce((n, g) => n + g.money, 0), 1317000000);
  assert.equal(groups.reduce((n, g) => n + g.chats, 0), 12100);
  assert.equal(pays.length, 735);
  assert.equal(pays.reduce((n, p) => n + p.kept, 0), 705);
  assert.equal(pays.reduce((n, p) => n + p.net, 0), 1317000000);
  for (const g of groups) assert.equal(pays.filter((p) => p.group === g.id).reduce((n, p) => n + p.net, 0), g.money, g.id);
});
