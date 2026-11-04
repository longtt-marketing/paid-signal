// Reads the shop's October (docs/proof/merchant-case-2026-10.json) with src/merchantCase.js and writes what the judge page
// shows. Usage: node scripts/eval-merchant-case.mjs (writes public/data/merchant-case.json and the shop section of public/judge.html)
import { readFileSync, writeFileSync } from "node:fs";
import { readMerchantCase, gapHTML, hookHTML } from "../src/merchantCase.js";

const c = JSON.parse(readFileSync(new URL("../docs/proof/merchant-case-2026-10.json", import.meta.url), "utf8"));
const out = { case: c, read: readMerchantCase(c) };
writeFileSync(new URL("../public/data/merchant-case.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
const page = new URL("../public/judge.html", import.meta.url);
writeFileSync(page, readFileSync(page, "utf8").replace(/<!--gap:start-->[\s\S]*?<!--gap:end-->/, () => `<!--gap:start-->${gapHTML(out.read, c)}<!--gap:end-->`)
  .replace(/<!--hook:start-->[\s\S]*?<!--hook:end-->/, () => `<!--hook:start-->${hookHTML(out.read)}<!--hook:end-->`));
console.log(out.read.rank_by_cost_per_conversation.join(">"), "|", out.read.rank_by_money_kept.join(">"), "|", out.read.paid_signal_split.map((s) => `${s.id} ${(s.share_now * 100).toFixed(1)}%->${(s.share_proposed * 100).toFixed(1)}%`).join(", "));
