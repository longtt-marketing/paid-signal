// Reads the shop's October (docs/proof/merchant-case-2026-10.json) with src/merchantCase.js and writes what the judge page
// shows. Usage: node scripts/eval-merchant-case.mjs (writes public/data/merchant-case.json)
import { readFileSync, writeFileSync } from "node:fs";
import { readMerchantCase } from "../src/merchantCase.js";

const c = JSON.parse(readFileSync(new URL("../docs/proof/merchant-case-2026-10.json", import.meta.url), "utf8"));
const out = { case: c, read: readMerchantCase(c) };
writeFileSync(new URL("../public/data/merchant-case.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(out.read.rank_by_cost_per_conversation.join(">"), "|", out.read.rank_by_money_kept.join(">"), "|", out.read.paid_signal_split.map((s) => `${s.id} ${(s.share_now * 100).toFixed(1)}%->${(s.share_proposed * 100).toFixed(1)}%`).join(", "));
