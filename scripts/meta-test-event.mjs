// Send Paid Signal's Purchase events to a real Meta dataset as TEST events (Events Manager > Test events shows them;
// they never count toward ads). The payloads are exactly what the dashboard previews (src/ledger.js metaEvents).
// Needs in .dev.vars: META_DATASET_ID, META_CAPI_TOKEN (Events Manager > Settings > Conversions API > Generate token),
// META_TEST_CODE (Events Manager > Test events > "Test event code").
// Usage: node scripts/meta-test-event.mjs            (sends the live ledger's events once, prints Meta's answer)
import fs from "node:fs";
import { metaEvents, possibleDuplicates } from "../src/ledger.js";

const BASE = process.env.BASE || "https://paid-signal.thelongmarketing.workers.dev";
const env = Object.fromEntries(fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
for (const k of ["META_DATASET_ID", "META_CAPI_TOKEN", "META_TEST_CODE"]) if (!env[k]) { console.error(`Missing ${k} in .dev.vars`); process.exit(1); }

const { payments } = await (await fetch(`${BASE}/api/ledger`)).json();
const hold = new Set(possibleDuplicates(payments).map((d) => d.capture_id));
const { events, held } = await metaEvents(payments.map((p) => ({ ...p, payer_email: null })), { sourceUrl: `${BASE}/shop.html`, hold });
console.log(`${events.length} Purchase events, ${held.length} held back:`, held.map((h) => `${h.capture_id} (${h.reason})`).join(", "));

const res = await fetch(`https://graph.facebook.com/v21.0/${env.META_DATASET_ID}/events`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ data: events, test_event_code: env.META_TEST_CODE, access_token: env.META_CAPI_TOKEN }),
});
const out = await res.json();
console.log(res.status, JSON.stringify({ events_received: out.events_received, messages: out.messages, fbtrace_id: out.fbtrace_id, error: out.error && { type: out.error.type, message: out.error.message } }));
fs.writeFileSync("docs/proof/meta-test-events.json", JSON.stringify({ sent_at: new Date().toISOString(), dataset: "Paid Signal demo (test events only)", events_sent: events.length, held, meta_response: { status: res.status, events_received: out.events_received, messages: out.messages, error: out.error?.message } , event_ids: events.map((e) => e.event_id) }, null, 2) + "\n");
process.exit(res.ok ? 0 : 1);
