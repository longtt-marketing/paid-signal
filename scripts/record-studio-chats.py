"""Record real AG Studio assistant runs into web/src/saved-threads.json, so the Studio chat opens on recorded agent
work that replays without calling a model. Each starter runs in a fresh page (a new thread) against PS_BASE, with real
Claude and PayPal sandbox calls (the invoice and nudge starters create sandbox drafts and send sandbox reminders).
Usage: python scripts/record-studio-chats.py "Review ad budgets" "Nudge who still owes" "Explain the real shop"
Then rebuild the dashboard (cd web && npm run build)."""
import json, os, sys, time
from datetime import date
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get("PS_BASE", "http://localhost:8790")
OUT = Path(__file__).resolve().parents[1] / "web/src/saved-threads.json"
TITLES = {"Review ad budgets": "Budget agent: proposals through the evidence gate", "Nudge who still owes": "Nudge agent: PayPal reminders",
          "Invoice warm leads": "Revenue agent: PayPal invoice drafts", "Explain the real shop": "The real shop's October",
          "Build a page with Studio's agents": "Studio's agents build a page"}
# runs also replayed through Studio's own agent loop, with no model call
REPLAYS = {"Review ad budgets": "replay-budget.json", "Build a page with Studio's agents": "replay-page.json"}


def slim(thread):
    """Keep what a reader sees; drop the bulky page-health payloads Studio's view_page returns."""
    for m in thread["messages"]:
        for p in m.get("parts", []):
            tc = p.get("toolCall")
            if tc and tc.get("name") in ("view_page", "view_widget") and isinstance(tc.get("result"), dict):
                tc["result"] = {"success": tc["result"].get("success", True), "response": tc["result"].get("response", "")}
    return thread


def record(pw, label):
    b = pw.chromium.launch(channel="msedge")
    # on a local wrangler dev, PS_IP stands in for the visitor address the per-visitor caps count (Cloudflare sets it in production)
    pg = b.new_page(viewport={"width": 1440, "height": 1000}, extra_http_headers={"cf-connecting-ip": os.environ["PS_IP"]} if os.environ.get("PS_IP") else None)
    pg.goto(BASE + "/", wait_until="domcontentloaded"); pg.wait_for_timeout(4000)
    pg.evaluate("() => { location.hash = 'report'; }")  # opens the Report tab, which loads Studio
    pg.wait_for_function("() => window.__studio && window.__psThreads", timeout=90000); pg.wait_for_timeout(3000)
    # the assistant rail may be collapsed in a fresh page: open it, then press the starter
    pg.evaluate("() => { const a = window.__studio, s = a.getState(); a.setState({ ...s, panels: { ...(s.panels || {}), ai: { collapsed: false } } }); }")
    pg.wait_for_timeout(2500)
    # the panel opens on the newest saved thread: start a fresh one so the run is recorded on its own
    pg.evaluate("() => { const n = [...document.querySelectorAll('#studio button')].find((x) => /^New( chat)?$/.test(x.textContent.trim())); if (n) n.click(); }")
    pg.wait_for_timeout(2000)
    pg.evaluate("() => { window.__psRecordTurns = {}; }")  # the adapter keeps every Claude reply, keyed by agent, for replay
    ok = pg.evaluate("(l) => { const b = [...document.querySelectorAll('#studio button')].find((x) => x.textContent.trim() === l); if (b) b.click(); return !!b; }", label)
    if not ok: raise SystemExit(f"starter not found: {label}")
    start, last, still = time.time(), "", 0
    while time.time() - start < 300:  # done when the transcript stops changing for 20 s and ends on the assistant's text
        pg.wait_for_timeout(5000)
        cur = pg.evaluate("() => JSON.stringify([...window.__psThreads.values()].pop() || {})")
        t = json.loads(cur or "{}"); msgs = t.get("messages", [])
        ended = bool(msgs) and msgs[-1].get("role") == "assistant" and any(p.get("type") == "text" for p in msgs[-1].get("parts", []))
        still = still + 1 if cur == last else 0; last = cur
        if ended and still >= 4: break
    turns = pg.evaluate("() => JSON.stringify(window.__psRecordTurns || {})")
    b.close()
    if label in REPLAYS:  # also replayed through Studio's own agent loop (web/src/replay-*.json)
        (OUT.parent / REPLAYS[label]).write_text(json.dumps({"recorded": date.today().isoformat(), "turns": json.loads(turns)}, ensure_ascii=False), "utf8")
    t = slim(json.loads(last))
    t["summary"]["title"] = TITLES.get(label, label)
    t["messages"].append({"id": f"note-{t['summary']['threadId']}", "role": "assistant", "createdAt": len(t["messages"]),
        "parts": [{"type": "text", "text": f"_Recorded from the live app on {date.today().isoformat()}; opening it calls no model." + (" To watch Studio carry it out again, chart included, pick Replay a budget run (no model call)._" if label == "Review ad budgets" else " To watch Studio build the page again, pick Replay Studio building a page (no model call)._" if label in REPLAYS else " What it drafts, and the drafts, sends and reminders already made, are on Studio's Agents → PayPal page, read back from PayPal; ask again to watch it happen live._" if label == "Invoice warm leads" else " Ask again to watch it happen live._")}]})
    return t


if __name__ == "__main__":
    labels = sys.argv[1:] or ["Review ad budgets"]
    saved = json.loads(OUT.read_text("utf8")) if OUT.exists() else {"threads": []}
    keep = [t for t in saved["threads"] if t["summary"].get("title") not in {TITLES.get(l, l) for l in labels}]
    with sync_playwright() as pw:
        for l in labels:
            t = record(pw, l); keep.append(t)
            print(l, len(t["messages"]), "messages", flush=True)
    OUT.write_text(json.dumps({"threads": keep}, ensure_ascii=False, indent=1), "utf8")
    print("wrote", OUT, len(keep), "threads")
