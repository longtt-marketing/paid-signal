// Sends the ledger's paid orders that were captured before live sending existed to the shop's Meta dataset as TEST events,
// and stores Meta's answer under meta:<capture> marked backfill, so the dashboard can show which payments Meta received.
// New captures are sent by the Worker itself the moment PayPal confirms them (src/worker.js sendToMeta).
// Needs META_DATASET_ID, META_CAPI_TOKEN, META_TEST_CODE in .dev.vars. Usage: node scripts/meta-backfill.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { metaEvents, possibleDuplicates } from "../src/ledger.js";

const BASE = process.env.BASE || "https://paid-signal.thelongmarketing.workers.dev";
const env = Object.fromEntries(fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const { payments, meta = [] } = await (await fetch(`${BASE}/api/ledger`)).json();
const done = new Set(meta.map((m) => m.capture_id));
const hold = new Set(possibleDuplicates(payments).map((d) => d.capture_id));
for (const p of payments.filter((x) => !done.has(x.capture_id))) {
  const { events, held } = await metaEvents([p], { sourceUrl: `${BASE}/shop.html`, hold });
  let rec;
  if (!events.length) rec = { capture_id: p.capture_id, held: held[0]?.reason || "held", backfill: true, at: new Date().toISOString() };
  else {
    const res = await fetch(`https://graph.facebook.com/v21.0/${env.META_DATASET_ID}/events`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: events, test_event_code: env.META_TEST_CODE, access_token: env.META_CAPI_TOKEN }),
    });
    const j = await res.json();
    rec = { capture_id: p.capture_id, event_id: events[0].event_id, value: events[0].custom_data.value, ok: res.ok, events_received: j.events_received ?? 0,
      fbtrace_id: j.fbtrace_id || null, error: j.error ? String(j.error.message).slice(0, 160) : null, test_event: true, backfill: true, at: new Date().toISOString() };
  }
  const file = `.meta-${p.capture_id}.json`;
  fs.writeFileSync(file, JSON.stringify(rec));
  execFileSync(`npx --yes wrangler kv key put --binding LEDGER "meta:${p.capture_id}" --path "${file}" --remote`, { stdio: "ignore", shell: true }); // capture ids are [A-Z0-9] only
  fs.unlinkSync(file);
  console.log(p.capture_id, rec.held ? `held: ${rec.held}` : `events_received ${rec.events_received}${rec.error ? " error " + rec.error : ""}`);
}
