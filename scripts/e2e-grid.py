"""End-to-end check of the two AG Grid ledgers in a real browser, on a local wrangler dev seeded with scripts/seed-local.py
(no Claude call, no live KV): each check renders the grid and reads what it shows.
  1. Studio ledger: the pinned total row shows every payment and the money kept the ledger computes.
  2. The assistant's view (refunded or held, newest first): the total row follows the filter, and the ids the widget
     reports from AG Grid's row model match the rows on screen, in order.
  3. A payment's trail opened in that sorted view sits right under its payment.
  4. The Decision form: an amount over what is left keeps the button off; a valid one gets the server's answer.
  5. Dashboard ledger: the search box narrows the rows and the total row follows.
Usage: PS_BASE=http://localhost:8792 python scripts/e2e-grid.py docs/proof/e2e-grid-YYYY-MM-DD.json
"""
import json, os, sys, urllib.request
from datetime import date
from playwright.sync_api import sync_playwright

BASE = os.environ.get("PS_BASE", "http://localhost:8792")
OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-grid.json"
led = json.load(urllib.request.urlopen(urllib.request.Request(BASE + "/api/ledger", headers={"User-Agent": "paid-signal-e2e"})))
held = {d["capture_id"] for d in led["duplicates"]}
pays = led["payments"]
def kept(p): return 0.0 if p["capture_id"] in held else float(p["amount"]) - float(p.get("refunded_amount") or 0)
refunded = lambda p: p["status"] == "REFUNDED" or float(p.get("refunded_amount") or 0) > 0
checks = []
def check(name, ok, detail): checks.append({"check": name, "ok": bool(ok), "detail": detail}); print(("OK " if ok else "XX ") + name, detail, flush=True)

ROWS_JS = """(title) => { const w = [...document.querySelectorAll('.ag-studio-layout-widget')].find((x) => x.textContent.includes(title));
  const rows = [...w.querySelectorAll('[row-index]')].filter((r) => /^\\d+$/.test(r.getAttribute('row-index')));
  const by = new Map(); for (const r of rows) { const i = +r.getAttribute('row-index'); const cur = by.get(i) || { i, full: false, id: null, text: '' };
    if (r.classList.contains('ag-full-width-row')) cur.full = true; const t = r.querySelector('[title]'); if (t) cur.id = t.getAttribute('title'); cur.text += r.textContent; by.set(i, cur); }
  return [...by.values()].sort((a, b) => a.i - b.i).map((x) => ({ i: x.i, full: x.full, id: x.id, text: x.text.slice(0, 80) })); }"""
TOTAL_JS = """(title) => { const w = [...document.querySelectorAll('.ag-studio-layout-widget')].find((x) => x.textContent.includes(title)); return w.querySelector('.row-total')?.textContent || ''; }"""
VIEW_JS = """(d) => new Promise((res) => { let done = false; const reply = (x) => { if (!done) { done = true; res(x); } };
  const ask = (n) => { if (done) return; dispatchEvent(new CustomEvent('paid-signal:ledger-view', { detail: { ...d, reply } })); if (n > 0) setTimeout(() => ask(n - 1), 500); else reply(null); }; ask(12); })"""
T = "PayPal ledger (AG Grid)"
money = lambda v: f"${v:,.2f}"

with sync_playwright() as pw:
    b = pw.chromium.launch(channel="msedge"); pg = b.new_page(viewport={"width": 1440, "height": 1000})
    pg.goto(BASE + "/studio"); pg.wait_for_function("() => window.__studio", timeout=90000); pg.wait_for_timeout(6000)
    w = pg.locator(".ag-studio-layout-widget", has_text=T); w.scroll_into_view_if_needed(); pg.wait_for_timeout(1500)
    total = pg.evaluate(TOTAL_JS, T); all_kept = sum(kept(p) for p in pays)
    check("studio total row: every payment, money kept", f"{len(pays)} shown" in total and money(all_kept) in total, {"total_row": total, "expected": [f"{len(pays)} shown", money(all_kept)]})

    r = pg.evaluate(VIEW_JS, {"status": "refunded_or_held", "sort": "date_desc", "label": "refunded or held, newest first"}); pg.wait_for_timeout(1200)
    exp = [p["capture_id"] for p in sorted([p for p in pays if refunded(p) or p["capture_id"] in held], key=lambda p: p["captured_at"], reverse=True)]
    rows = [x for x in pg.evaluate(ROWS_JS, T) if not x["full"]]
    total = pg.evaluate(TOTAL_JS, T)
    check("assistant view: ids from the row model match the rows on screen and the ledger", r and r["ids"] == [x["id"] for x in rows] == exp, {"reported": r and r["ids"], "on_screen": [x["id"] for x in rows], "ledger": exp})
    vk = sum(kept(p) for p in pays if p["capture_id"] in exp)
    check("assistant view: total row follows the filter", f"{len(exp)} shown" in total and money(vk) in total, {"total_row": total, "expected": [f"{len(exp)} shown", money(vk)]})

    second = rows[1]["id"]
    w.locator(f"button.trail-toggle[aria-label$='{second}']").click(); pg.wait_for_timeout(900)
    after = pg.evaluate(ROWS_JS, T)
    pos = next(k for k, x in enumerate(after) if x["id"] == second)
    check("trail row sits right under its payment after AG Grid sorts", pos + 1 < len(after) and after[pos + 1]["full"], {"rows": [(x["i"], "trail" if x["full"] else x["id"]) for x in after]})

    w.locator(".chip-x", has_text="Assistant's view").click(); pg.wait_for_timeout(1200)
    w.locator(".grid-decide", has_text="Keep").first.click(); pg.wait_for_timeout(600)
    pg.locator(".decide-menu button", has_text="Refund").click(); pg.wait_for_timeout(600)
    f = w.locator("form.ledger-ask"); f.locator("input").fill("1000"); pg.wait_for_timeout(300)
    blocked = f.locator(".ledger-ask-go").is_disabled(); note = f.locator(".ledger-ask-note").inner_text()
    f.locator("input").fill("1"); f.locator(".ledger-ask-go").click(); pg.wait_for_timeout(4000)
    said = w.locator(".ledger-w-foot").inner_text()
    check("decision form: over the refundable amount is blocked; a valid amount gets the server's answer", blocked and "left to refund" in note and w.locator("form.ledger-ask").count() == 0 and ("previewed" in said or "Refunded" in said), {"note": note, "server_said": said[:160]})

    pg.goto(BASE + "/"); pg.wait_for_timeout(8000)
    g = pg.locator(".ledger-grid"); g.scroll_into_view_if_needed(); pg.wait_for_timeout(1500)
    before = g.locator(".row-total").first.inner_text()
    g.locator("input[type=search], input[placeholder^='Search']").first.fill("Refunded"); pg.wait_for_timeout(1200)
    after_t = g.locator(".row-total").first.inner_text()
    n_ref = sum(1 for p in pays if p["status"] == "REFUNDED")
    check("dashboard: the search box narrows the rows and the total row follows", f"{len(pays)} shown" in before and f"{n_ref} shown" in after_t, {"before": before, "after": after_t, "refunded_in_ledger": n_ref})
    b.close()

summary = {"run": date.today().isoformat(), "base": BASE, "checks": len(checks), "passed": sum(c["ok"] for c in checks), "results": checks}
open(OUT, "w", encoding="utf-8").write(json.dumps(summary, indent=1, ensure_ascii=False))
print("passed", summary["passed"], "/", summary["checks"])
