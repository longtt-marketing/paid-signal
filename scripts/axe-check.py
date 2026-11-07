# Usage: python scripts/axe-check.py https://paid-signal.thelongmarketing.workers.dev docs/proof/axe-YYYY-MM-DD.json
# axe-core accessibility check of Paid Signal's pages at phone (390 px) and desktop (1440 px) widths.
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8791"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("axe-report.json")
# axe-core 4.10.2 from npm: npm i --no-save axe-core@4.10.2 (or set AXE_JS to its axe.min.js)
import os
AXE = Path(os.environ.get("AXE_JS") or Path(__file__).resolve().parents[1] / "node_modules/axe-core/axe.min.js").read_text("utf8")
PAGES = [("/studio", ".ledger-w .row-group"), ("/", ".ledger-grid .grid-decide"), ("/judge", "h1"), ("/trail", "h1"), ("/audit", "h1"), ("/proof", "h1"), ("/connect", "h1"), ("/data", "h1"), ("/scenarios", "h1")]
report = {"base": BASE, "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "axe": "4.10.2", "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], "pages": []}
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (390, 1440):
        for path, ready in PAGES:
            pg = b.new_page(viewport={"width": w, "height": 900}, bypass_csp=True)
            pg.goto(BASE + path)
            try: pg.wait_for_selector(ready, timeout=60000, state="attached")
            except Exception: pass
            time.sleep(4)
            pg.add_script_tag(content=AXE)
            res = pg.evaluate("""async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] } });
              return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, targets: v.nodes.slice(0, 4).map(n => n.target.join(' ')) })); }""")
            report["pages"].append({"path": path, "width": w, "violations": res})
            print(w, path, [(v["id"], v["impact"], v["count"]) for v in res], flush=True)
            pg.close()
    b.close()
OUT.write_text(json.dumps(report, indent=1), "utf8")
print("wrote", ascii(str(OUT)))
