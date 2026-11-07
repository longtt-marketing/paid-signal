"""Held-out eval: does the Studio assistant drive the AG Grid ledger to the state a request asks for?

Each request runs live (real Claude through the Worker's proxy) in a fresh chat on /studio. Two checks per request:
  1. understood: the show_payments_in_ledger call's status, ad and sort match what the request asks for (written below
     by hand before any run);
  2. grid: the capture ids the AG Grid ledger actually shows, in order, match the set and order computed here
     independently from /api/ledger (refunded = PayPal REFUNDED or any amount refunded; held = flagged double payment;
     kept = 0 when held, else captured minus refunded).
Usage: PS_BASE=http://localhost:8791 python scripts/eval-grid-agent.py docs/proof/grid-agent-eval-YYYY-MM-DD.json
"""
import json, os, sys, time, urllib.request
from datetime import date
from playwright.sync_api import sync_playwright

BASE = os.environ.get("PS_BASE", "http://localhost:8791")
OUT = sys.argv[1] if len(sys.argv) > 1 else "grid-agent-eval.json"

# request -> expected (status, ad, sort); None = the request does not ask for it
CASES = [
    ("In the PayPal ledger, show only the payments that were refunded.", ("refunded", None, None)),
    ("Show me the held payments in the ledger.", ("held", None, None)),
    ("Which payments are on hold as possible double payments? Show them in the grid.", ("held", None, None)),
    ("List refunded or held payments, newest first.", ("refunded_or_held", None, "date_desc")),
    ("Show every payment in the ledger, newest first.", ("all", None, "date_desc")),
    ("Show the paid payments, most money kept first.", ("paid", None, "kept_desc")),
    ("In the grid, show the Testimonial ad's payments, newest first.", ("all", "parent_carousel", "date_desc")),
    ("Show refunds on the trial class video ad.", ("refunded", "trial_video", None)),
    ("Show the holiday camp ad's refunded payments.", ("refunded", "holiday_static", None)),
    ("Show the free guide's payments in the ledger.", ("all", "free_guide", None)),
    ("Which payments on the trial class ad are held? Show them.", ("held", "trial_video", None)),
    ("Show payments that still count as paid for the Testimonial carousel.", ("paid", "parent_carousel", None)),
    ("Sort the ledger by money kept, highest first.", ("all", None, "kept_desc")),
    ("Put the newest payments first in the PayPal ledger.", ("all", None, "date_desc")),
    ("Show anything refunded or on hold for the holiday camp ad.", ("refunded_or_held", "holiday_static", None)),
    ("Show paid payments on the trial class video ad, newest first.", ("paid", "trial_video", "date_desc")),
    ("Filter the ledger to money that came back to buyers.", ("refunded", None, None)),
    ("Show me where we kept the most money: paid payments, biggest kept first.", ("paid", None, "kept_desc")),
    ("Show the Testimonial ad's refunded or held payments.", ("refunded_or_held", "parent_carousel", None)),
    ("Show the free guide's paid payments.", ("paid", "free_guide", None)),
    ("Show refunded payments, newest first.", ("refunded", None, "date_desc")),
    ("Grid: held payments only, newest first.", ("held", None, "date_desc")),
    ("Show all the holiday camp payments, most kept first.", ("all", "holiday_static", "kept_desc")),
    ("Show the trial class video payments, newest first.", ("all", "trial_video", "date_desc")),
]

ledger = json.load(urllib.request.urlopen(BASE + "/api/ledger"))
held_ids = {d["capture_id"] for d in ledger["duplicates"]}
pay = {p["capture_id"]: p for p in ledger["payments"]}
def refunded(p): return p["status"] == "REFUNDED" or float(p.get("refunded_amount") or 0) > 0
def kept(p): return 0.0 if p["capture_id"] in held_ids else float(p["amount"]) - float(p.get("refunded_amount") or 0)
TEST = {"all": lambda p: True, "refunded": refunded, "held": lambda p: p["capture_id"] in held_ids,
        "refunded_or_held": lambda p: refunded(p) or p["capture_id"] in held_ids,
        "paid": lambda p: p["capture_id"] not in held_ids and p["status"] != "REFUNDED"}
def expected_rows(status, ad, sort):
    rows = [p for p in ledger["payments"] if TEST[status or "all"](p) and (not ad or p["ad"] == ad)]
    if sort == "date_desc": rows.sort(key=lambda p: p["captured_at"], reverse=True)
    if sort == "kept_desc": rows.sort(key=lambda p: kept(p), reverse=True)
    return [p["capture_id"] for p in rows]
def same_order(ids, sort):
    if sort == "date_desc": key = lambda i: pay[i]["captured_at"]
    elif sort == "kept_desc": key = lambda i: kept(pay[i])
    else: return True
    vals = [key(i) for i in ids]
    return all(vals[k] >= vals[k + 1] for k in range(len(vals) - 1))

results = []
# Studio's chat stops accepting input after about 20 new chats in one page: run the cases in fresh pages of 10
def run_batch(pw, batch, offset):
    b = pw.chromium.launch(channel="msedge")
    pg = b.new_page(viewport={"width": 1440, "height": 1000}, extra_http_headers={"cf-connecting-ip": os.environ["PS_IP"]} if os.environ.get("PS_IP") else None)
    pg.goto(BASE + "/studio", wait_until="domcontentloaded")
    pg.wait_for_function("() => window.__studio && window.__psThreads", timeout=90000); pg.wait_for_timeout(4000)
    pg.evaluate("() => [...document.querySelectorAll('.judge-strip button')].find(x => /replay a run/.test(x.textContent)).click()")
    pg.wait_for_timeout(4000)
    for n, (req, (st, ad, sort)) in enumerate(batch, offset):
        # on a local wrangler dev, each case stands in as its own visitor, so the per-visitor turn cap does not end the run
        if os.environ.get("PS_IP_BASE"): pg.set_extra_http_headers({"cf-connecting-ip": f"{os.environ['PS_IP_BASE']}.{100 + n}"})
        pg.evaluate("() => { const n = [...document.querySelectorAll('#studio button')].find((x) => /^New( chat)?$/.test(x.textContent.trim())); if (n) n.click(); }")
        pg.wait_for_timeout(1500)
        box = pg.locator("textarea[placeholder^='Ask the AI']")
        box.fill(req); box.press("Enter")
        t0, call = time.time(), None
        while time.time() - t0 < 120:
            pg.wait_for_timeout(2500)
            s = pg.evaluate("""() => { const t = [...window.__psThreads.values()].pop(); if (!t) return null;
              const parts = t.messages.flatMap((m) => m.parts || []);
              const c = parts.map((p) => p.toolCall).filter((x) => x && x.name === 'show_payments_in_ledger').pop();
              const last = t.messages[t.messages.length - 1];
              return { call: c ? { args: c.args, result: c.result?.data || null } : null, done: last?.role === 'assistant' && (last.parts || []).some((p) => p.type === 'text') }; }""")
            if s and s["call"] and s["call"]["result"] and s["done"]: call = s["call"]; break
        pg.wait_for_timeout(1500)
        # the rows AG Grid itself holds after its filter and sort (forEachNodeAfterFilterAndSort), as the widget reports them
        shown = ((call or {}).get("result") or {}).get("capture_ids")
        args = (call or {}).get("args") or {}
        # the tool takes an ad key; an ad's name also works in the widget, so a name counts as that key
        a0 = str(args.get("ad") or "").lower()
        adk = next((k for k, w in (("free_guide", "free"), ("trial_video", "trial"), ("parent_carousel", "testimonial"), ("parent_carousel", "carousel"), ("holiday_static", "holiday")) if w in a0 or a0 == k), None) if a0 else None
        got = (args.get("status") or "all", adk, args.get("sort") or None)
        understood = call is not None and got[0] == (st or "all") and got[1] == ad and (sort is None or got[2] == sort)
        exp = expected_rows(got[0], got[1], got[2])  # what the grid should show for the call the agent made
        grid_ok = shown is not None and set(shown) == set(exp) and same_order(shown, got[2])
        results.append({"request": req, "expected": {"status": st, "ad": ad, "sort": sort}, "agent_call": args, "understood": understood,
                        "grid_shows": shown, "grid_should_show": exp, "grid_ok": grid_ok})
        print(("OK " if understood and grid_ok else "XX ") + req, got, len(shown or []), "rows", flush=True)
    b.close()

with sync_playwright() as pw:
    for i in range(0, len(CASES), 10): run_batch(pw, CASES[i:i + 10], i)

summary = {"run": date.today().isoformat(), "base": BASE, "cases": len(results),
           "understood": sum(r["understood"] for r in results), "grid_ok": sum(r["grid_ok"] for r in results),
           "both": sum(r["understood"] and r["grid_ok"] for r in results), "results": results}
open(OUT, "w", encoding="utf-8").write(json.dumps(summary, indent=1, ensure_ascii=False))
print("understood", summary["understood"], "/", len(results), "· grid matches", summary["grid_ok"], "/", len(results), "· both", summary["both"])
