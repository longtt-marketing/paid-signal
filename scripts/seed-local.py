"""Seed the local wrangler KV (never the live one) with the 13 evidence payments, so the ledger, Studio and the evals can
be tried on `wrangler dev --local` without spending the Cloudflare account's daily KV list() quota.
The rows copy the live ledger's ids, ads, statuses, refunds and capture times as read on 7 Nov 2026 (amounts $49.00);
payer keys are placeholders, the same one for the double payment pair 33 seconds apart.
Usage: python scripts/seed-local.py   then   npx wrangler dev --config wrangler.jsonc --local --port 8792
"""
import json, os, subprocess, sys, tempfile

ROWS = [
    ("59A98014DG653005N", "trial_video", "COMPLETED", "0.00", "2026-10-28T10:49:51Z", "p01"),
    ("7A791792B60079253", "trial_video", "REFUNDED", "49.00", "2026-10-28T10:53:27Z", "p02"),
    ("7G581478P1052730P", "parent_carousel", "COMPLETED", "0.00", "2026-10-28T11:38:20Z", "p03"),
    ("19L75638WN729671C", "parent_carousel", "REFUNDED", "49.00", "2026-10-28T11:38:32Z", "p04"),
    ("81X20615X87083050", "free_guide", "COMPLETED", "0.00", "2026-10-28T20:50:00Z", "p05"),
    ("7Y943188M77480212", "holiday_static", "PARTIALLY_REFUNDED", "9.00", "2026-10-29T04:29:46Z", "p06"),
    ("71264306943252202", "holiday_static", "REFUNDED", "49.00", "2026-10-29T04:30:03Z", "p07"),
    ("392527382E750334K", "trial_video", "COMPLETED", "0.00", "2026-10-29T04:53:29Z", "p08"),
    ("3GY34151GC185303G", "parent_carousel", "COMPLETED", "0.00", "2026-10-30T05:56:33Z", "p09"),
    ("9NM26871NE612430X", "parent_carousel", "COMPLETED", "0.00", "2026-11-02T02:36:05.572Z", "p10"),
    ("8GV239799R674880B", "trial_video", "COMPLETED", "0.00", "2026-11-04T19:14:12Z", "p11"),
    ("2SH783175L252453D", "parent_carousel", "COMPLETED", "0.00", "2026-11-04T19:14:30Z", "p12"),
    ("90288919WU0051526", "trial_video", "COMPLETED", "0.00", "2026-11-04T19:14:45Z", "p11"),
]
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = []
for i, (cid, ad, st, back, at, payer) in enumerate(ROWS):
    out.append({"key": f"pay:{cid}", "value": json.dumps({
        "capture_id": cid, "order_id": f"LOCAL{i:02d}", "status": st, "amount": "49.00", "currency": "USD", "ad": ad,
        "source": "fb", "click_id": f"IwARlocal{i:02d}", "captured_at": at, "refunded_amount": back, "fee": "1.97",
        "payer_key": payer, "payer_email_sha256": f"local-placeholder-{payer}", "evidence": True})})
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
    json.dump(out, f); path = f.name
cmd = ["npx", "--yes", "wrangler", "kv", "bulk", "put", path, "--binding", "LEDGER", "--local", "--config", "wrangler.jsonc"]
r = subprocess.run(cmd, cwd=here, shell=(os.name == "nt"), capture_output=True, text=True, encoding="utf-8", errors="replace")
print((r.stdout or "")[-400:], (r.stderr or "")[-400:])
sys.exit(r.returncode)
