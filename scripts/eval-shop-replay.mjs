// Runs the gift shop's October book (docs/proof/merchant-case-*.csv) through src/shopReplay.js, writes
// public/data/shop-replay.json and the replay block of public/judge.html. Usage: node scripts/eval-shop-replay.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "../src/revenue.js";
import { replayShop, replayHTML } from "../src/shopReplay.js";

const read = (f) => readFileSync(new URL(`../docs/proof/${f}`, import.meta.url), "utf8");
const rows = (f) => parseCsv(read(f)); // objects keyed by the header row
const c = JSON.parse(read("merchant-case-2026-10.json"));
const out = replayShop({ orders: rows("merchant-case-orders-2026-10.csv"), payments: rows("merchant-case-payments-2026-10.csv"), refunds: rows("merchant-case-refunds-2026-10.csv"), groups: c.groups });
writeFileSync(new URL("../public/data/shop-replay.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
const page = new URL("../public/judge.html", import.meta.url);
writeFileSync(page, readFileSync(page, "utf8").replace(/<!--replay:start-->[\s\S]*?<!--replay:end-->/, () => `<!--replay:start-->${replayHTML(out)}<!--replay:end-->`));
const d = out.duplicates;
console.log(`paid ${out.totals.paid}, revenue ${out.totals.revenue}, matches book: ${out.matches_book} | duplicates ${d.in_book}: 10-min window ${d.card_window.caught} caught/${d.card_window.false_alarms} false, ${d.bank_window_minutes}-min ${d.bank_window.caught}/${d.bank_window.false_alarms} | gaps ${d.gap_minutes.join(",")}`);
