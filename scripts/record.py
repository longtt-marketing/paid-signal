"""Screen-record the live demo for the product film (Playwright video, 1920x1080), one clip per scene, with a visible
cursor. Clips land in film/clips/<name>/00001.jpg... at 30 fps for scripts/build-film.py.
Usage: python scripts/record.py dash agent assistant send signal   (names in SEGMENTS; real Claude and PayPal sandbox calls)"""
import json, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

import os
BASE = os.environ.get("PS_BASE", "https://paid-signal.thelongmarketing.workers.dev")  # a local wrangler dev on the live KV for capped routes
OUT = Path(__file__).resolve().parents[1] / "film"
CURSOR = """addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(21,23,28,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);z-index:2147483647;pointer-events:none;transition:transform .12s';
  document.body.appendChild(c);
  addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { c.style.transform = 'scale(.7)'; }, true);
  addEventListener('mouseup', () => { c.style.transform = ''; }, true);
});"""


MARKS, T0 = [], [0.0]


def mark(pg, name, sel):
    """Note where an element is on screen and when (clip seconds), so the film's rings land on it."""
    loc = pg.locator(sel).first
    if not loc.count(): print("mark: missing", sel, flush=True); return
    b = loc.bounding_box()
    if b: MARKS.append({"name": name, "t": round(time.time() - T0[0], 2), "box": [round(b["x"]), round(b["y"]), round(b["width"]), round(b["height"])]})


def glide(pg, loc, click=True):
    """Move the visible cursor to an element, then click it."""
    loc.scroll_into_view_if_needed(); b = loc.bounding_box()
    pg.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=25); pg.wait_for_timeout(350)
    if click: pg.mouse.down(); pg.wait_for_timeout(90); pg.mouse.up()


def invoices(pg): return pg.evaluate("fetch('/api/invoices').then(r => r.json()).then(d => d.invoices)")


def open_assistant(pg):
    glide(pg, pg.locator("#studio").get_by_role("button", name="Open the Studio assistant"))
    pg.wait_for_selector(".funnel", state="visible", timeout=60000); pg.wait_for_timeout(2500)


def to(pg, sel):
    pg.evaluate(f"document.querySelector({json.dumps(sel)}).scrollIntoView({{behavior: 'smooth', block: 'start'}})"); pg.wait_for_timeout(1600)


def dash(pg):
    """The answer (62 against 6), each ad's path to Meta, the free guide's shortfall, and what Meta received."""
    pg.wait_for_timeout(1200); mark(pg, "hero", ".duo"); glide(pg, pg.locator(".duo"), click=False); pg.wait_for_timeout(2200)
    mark(pg, "flow", ".flow svg"); mark(pg, "flowcap", ".fl-cap")
    glide(pg, pg.locator(".fl-ad.worst"), click=False); pg.wait_for_timeout(2600)
    glide(pg, pg.locator(".fl-cap"), click=False); pg.wait_for_timeout(2600)
    to(pg, "section[aria-label='Per ad']"); pg.wait_for_timeout(500)
    row = pg.locator("section[aria-label='Per ad'] tbody tr", has_text="Free guide").first
    mark(pg, "guide_row", "section[aria-label='Per ad'] tbody tr:has-text('Free guide')")
    glide(pg, row.locator("td.neg"), click=False); pg.wait_for_timeout(3200)
    to(pg, "#signal"); pg.wait_for_timeout(500); mark(pg, "meta_card", ".sig-event dl")
    glide(pg, pg.locator(".sig-event dl div").last, click=False); pg.wait_for_timeout(3500)


def ledger(pg):
    """AG Studio's third page: every payment from its ad, through PayPal, to what Meta received."""
    glide(pg, pg.locator("nav a, nav button", has_text="Report").first)
    pg.wait_for_function("window.__studio && window.__studio.getState", timeout=90000); pg.wait_for_timeout(3000)
    glide(pg, pg.locator(".studio-pages button", has_text="Meta")); pg.wait_for_timeout(3500)
    mark(pg, "pivot", ".studio [class*='widget']:has-text('Each ad')")
    for t in ["Free guide", "Testimonial"]:
        cell = pg.locator(".studio").get_by_text(t, exact=False).first
        if cell.count(): glide(pg, cell, click=False); pg.wait_for_timeout(2000)
    mark(pg, "ledger", ".studio [class*='widget']:has-text('Ledger')")
    meta = pg.locator(".studio").get_by_text("Received by Meta").first
    if meta.count(): glide(pg, meta, click=False)
    pg.wait_for_timeout(4000)


def chase(pg):
    """Sent invoices nobody has paid: the chase agent picks whom to remind and writes the note."""
    to(pg, "#invoices"); pg.wait_for_timeout(600); mark(pg, "chase_btn", "#invoices .sub-head")
    glide(pg, pg.locator("#invoices button", has_text="Chase unpaid"))
    pg.wait_for_selector("#invoices .dec", timeout=180000); pg.wait_for_timeout(1500)
    mark(pg, "chase_result", "#invoices .dec")
    glide(pg, pg.locator("#invoices .dec"), click=False); pg.wait_for_timeout(4000)
    notes = pg.locator("#invoices .cap .agent-say")
    if notes.count(): mark(pg, "chase_note", "#invoices .cap:has(.agent-say)"); glide(pg, notes.first, click=False); pg.wait_for_timeout(4500)


def agent(pg):
    glide(pg, pg.get_by_role("button", name="Ask the agent"))
    pg.wait_for_function("document.body.innerText.includes('Numbers checked') || document.body.innerText.includes('Number check flagged')", timeout=150000); pg.wait_for_timeout(2500)
    glide(pg, pg.locator(".action button.primary").first)
    pg.wait_for_selector(".decided", timeout=20000); pg.wait_for_timeout(3000)


def assistant(pg):
    open_assistant(pg)
    before = {i["lead"] for i in invoices(pg)}
    glide(pg, pg.locator(".studio button", has_text="Invoice warm leads").first)
    for _ in range(80):
        time.sleep(3)
        if {i["lead"] for i in invoices(pg)} - before and not pg.locator(".studio button", has_text="Stop").count(): break
    pg.wait_for_timeout(5000)
    review = pg.locator(".toast button", has_text="Review")
    if review.count(): glide(pg, review)
    else: to(pg, "#invoices")
    pg.wait_for_timeout(5000)


def chart(pg):
    """Studio's own agents build a widget from a plain request, placed where the camera can see it."""
    open_assistant(pg)
    box = pg.locator(".studio textarea").last
    glide(pg, box); box.type("Add a bar chart of paid revenue by ad at the top of this page.", delay=35); pg.wait_for_timeout(400); box.press("Enter")
    mark(pg, "asked", ".studio textarea >> nth=-1")
    t0 = time.time(); quiet = 0
    while time.time() - t0 < 240:  # done once the assistant has shown no Stop button for six seconds
        time.sleep(2)
        quiet = quiet + 2 if not pg.locator(".studio button", has_text="Stop").count() else 0
        if quiet >= 6 and time.time() - t0 > 15: break
    pg.wait_for_timeout(1500)
    mark(pg, "chart", ".studio [class*='widget']:has-text('revenue') >> nth=0")
    pg.mouse.move(700, 400, steps=30); pg.wait_for_timeout(4000)


def budget(pg):
    """The custom Studio agent: the lead hands the budget question to it, it passes the gate, its change lands in the
    approvals column, it asks Studio's page agent for the evidence chart, and the owner approves. Logs timings."""
    t0 = time.time(); marks = {}
    open_assistant(pg)
    n0 = pg.evaluate("Object.keys(window.__studio.getState().pages[0].widgets).length")
    glide(pg, pg.locator(".studio button", has_text="Review ad budgets").first); marks["asked"] = time.time() - t0
    for _ in range(140):
        time.sleep(3)
        if "gated" not in marks and "From the AG Studio budget agent" in pg.locator("#actions").inner_text(): marks["gated"] = time.time() - t0
        if "chart" not in marks and pg.evaluate("Object.keys(window.__studio.getState().pages[0].widgets).length") > n0: marks["chart"] = time.time() - t0
        # the lead agent's last message ends the run; give it time to write, then stop waiting
        if "gated" in marks and "chart" in marks and time.time() - t0 > marks["chart"] + 45: break
    marks["done"] = time.time() - t0
    pg.wait_for_timeout(2500)
    marks["to_approvals"] = time.time() - t0
    glide(pg, pg.locator(".studio-card .card-head button", has_text="Approvals")); pg.wait_for_timeout(2200)
    mark(pg, "proposal", "#actions .action")
    glide(pg, pg.locator(".action button.primary").first); pg.wait_for_selector(".decided", timeout=20000); marks["approved"] = time.time() - t0
    pg.wait_for_timeout(3500)
    print("budget marks", {k: round(v, 1) for k, v in marks.items()}, flush=True)
    for k, v in marks.items(): MARKS.append({"name": k, "t": round(v, 2)})


def send(pg):
    pg.evaluate("document.querySelector('#invoices').scrollIntoView({block: 'start'})"); pg.wait_for_timeout(1500)
    drafts = pg.locator("#invoices .cap", has_text="Lead 08")
    glide(pg, drafts.first.get_by_role("button", name="Send"))
    pg.wait_for_timeout(6000)


def approvesend(pg):
    """A person approves a drafted invoice; the send agent (Claude + PayPal Agent Toolkit) checks it and sends it."""
    to(pg, "#approvals"); pg.wait_for_timeout(800)
    row = pg.locator("#invoices .cap", has_text=sys.argv[sys.argv.index("--lead") + 1] if "--lead" in sys.argv else "Lead 10")
    glide(pg, row.get_by_role("button", name="Approve"))
    pg.wait_for_function("[...document.querySelectorAll('#invoices .agent-say')].some(e => !e.textContent.includes('checking'))", timeout=120000)
    pg.wait_for_timeout(5000)
    pg.mouse.move(1300, 700, steps=30); pg.wait_for_timeout(2500)


def revenue(pg):
    """Claude reads what each unpaid lead wrote, decides who is ready to pay; code prices it; the injection is flagged."""
    mark(pg, "step", "section.loop article:has-text('Invoice the warm leads')")
    glide(pg, pg.get_by_role("button", name="Ask the revenue agent"))
    pg.wait_for_selector("#revenue .headline", timeout=180000); pg.wait_for_timeout(1500)
    to(pg, "#approvals"); pg.wait_for_timeout(600)
    mark(pg, "headline", "#revenue .headline")
    if pg.locator("#revenue .dec.bad").count(): mark(pg, "flagged", "#revenue .dec.bad >> nth=0"); glide(pg, pg.locator("#revenue .dec.bad").first, click=False); pg.wait_for_timeout(2600)
    if pg.locator("#revenue .dec.ok").count(): mark(pg, "drafted", "#revenue .dec.ok >> nth=0"); glide(pg, pg.locator("#revenue .dec.ok").first, click=False); pg.wait_for_timeout(2600)
    waiting = pg.locator("#revenue .dec:not(.ok):not(.bad)")
    if waiting.count(): mark(pg, "waiting", "#revenue .dec:not(.ok):not(.bad) >> nth=0"); glide(pg, waiting.first, click=False); pg.wait_for_timeout(2600)
    pg.wait_for_timeout(1500)


def signal(pg):
    pg.evaluate("document.querySelector('#captures').scrollIntoView({block: 'start'})"); pg.wait_for_timeout(2500)
    for _ in range(6):
        pg.mouse.wheel(0, 140); pg.wait_for_timeout(450)
    pg.wait_for_timeout(2500)


def refund(pg):
    """The duplicate Google-click payment is refunded in full (Google retraction), the first one by $9 (restatement)."""
    caps = sys.argv[sys.argv.index("--refund") + 1].split(",") if "--refund" in sys.argv else ["71264306943252202", "7Y943188M77480212"]
    amounts = [c.split(":")[1] if ":" in c else "" for c in caps]; caps = [c.split(":")[0] for c in caps]
    def answer(d):
        if d.type != "prompt": print("dialog:", d.message, flush=True); return d.dismiss()
        v = amounts.pop(0) if amounts else ""
        return d.accept(v or d.default_value)
    pg.on("dialog", answer)
    to(pg, "#payments"); pg.wait_for_timeout(1000)
    dup = pg.locator("#captures .dup").first
    if dup.count(): glide(pg, dup, click=False); pg.wait_for_timeout(2500)
    for cap in caps:
        glide(pg, pg.locator("#captures .cap", has_text=cap).get_by_role("button", name="Refund")); pg.wait_for_timeout(5000)
    to(pg, "#signal"); pg.wait_for_timeout(1000)
    glide(pg, pg.locator(".sig-side > div").last, click=False); pg.wait_for_timeout(3500)


def week(pg):
    """A synthetic week with enough paid orders: the budget agent makes a real move, the gate checks it, the owner approves."""
    to(pg, "section.loop"); pg.wait_for_timeout(500)
    btn = pg.locator("button", has_text="synthetic week"); mark(pg, "week_btn", "section.loop article:has(button.link-btn)")
    glide(pg, btn)
    pg.wait_for_selector("#actions .synthetic", timeout=180000); pg.wait_for_timeout(1500)
    to(pg, "#approvals"); pg.wait_for_timeout(500)
    mark(pg, "banner", "#actions .synthetic"); glide(pg, pg.locator("#actions .synthetic"), click=False); pg.wait_for_timeout(3000)
    acts = pg.locator("#actions .action")
    mark(pg, "move1", "#actions .action >> nth=0"); glide(pg, acts.nth(0), click=False); pg.wait_for_timeout(3000)
    mark(pg, "move2", "#actions .action >> nth=1"); glide(pg, acts.nth(1), click=False); pg.wait_for_timeout(3000)
    glide(pg, acts.nth(0).locator("button.primary")); pg.wait_for_selector(".decided", timeout=20000)
    mark(pg, "decided", "#actions .action:has(.decided)"); pg.wait_for_timeout(3500)


def trail(pg):
    """The money trail of the live payment: the ad click inside PayPal's custom_id, PayPal's own record, Meta's reply, the ad."""
    pg.goto(BASE + "/trail?capture=3GY34151GC185303G", wait_until="networkidle"); pg.wait_for_selector(".step .card", timeout=60000); pg.wait_for_timeout(1200)
    mark(pg, "loaded", "h1")
    s1 = pg.locator(".step").nth(0); mark(pg, "click", ".step >> nth=0"); glide(pg, s1.locator("code").last, click=False); pg.wait_for_timeout(2200)
    pg.evaluate("document.querySelectorAll('.step')[1].scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1500)
    s2 = pg.locator(".step").nth(1); mark(pg, "paypal", ".step >> nth=1")
    glide(pg, s2.locator("dd", has_text="a=parent_carousel"), click=False); pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelectorAll('.step')[2].scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1500)
    s3 = pg.locator(".step").nth(2); mark(pg, "meta", ".step >> nth=2")
    glide(pg, s3.locator(".gap"), click=False); pg.wait_for_timeout(1400); glide(pg, s3.locator("dd", has_text="events_received"), click=False); pg.wait_for_timeout(2400)
    pg.evaluate("document.querySelectorAll('.step')[3].scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1500)
    s4 = pg.locator(".step").nth(3); mark(pg, "effect", ".step >> nth=3")
    glide(pg, s4.locator("dd", has_text="%"), click=False); pg.wait_for_timeout(3500)


def owner(pg):
    """A labelled synthetic week: the owner asks to raise the ad with the most leads; Claude weighs it against the payments."""
    to(pg, "section.loop"); pg.wait_for_timeout(500)
    btn = pg.locator("button", has_text="raise the ad with the most leads"); mark(pg, "owner_btn", "section.loop article:has(button.link-btn)")
    glide(pg, btn)
    pg.wait_for_selector("#actions .action", timeout=180000); pg.wait_for_timeout(1500)
    to(pg, "#approvals"); pg.wait_for_timeout(500)
    mark(pg, "ask", "#actions .owner-ask"); glide(pg, pg.locator("#actions .owner-ask"), click=False); pg.wait_for_timeout(2500)
    refused = pg.locator("#actions .dec.bad")
    if refused.count(): mark(pg, "refused", "#actions .dec.bad >> nth=0"); glide(pg, refused.first, click=False); pg.wait_for_timeout(3500)
    guide = pg.locator("#actions .action", has_text="Free guide").first
    mark(pg, "guide", "#actions .action:has-text('Free guide')"); glide(pg, guide, click=False); pg.wait_for_timeout(4000)
    up = pg.locator("#actions .action", has=pg.locator(".tag.increase")).first
    if up.count():
        mark(pg, "raise", "#actions .action:has(.tag.increase)"); glide(pg, up, click=False); pg.wait_for_timeout(2500)
        glide(pg, up.locator("button.primary")); pg.wait_for_selector(".decided", timeout=20000)
        mark(pg, "decided", "#actions .action:has(.decided)")
    pg.wait_for_timeout(3500)


def judge(pg):
    """The cold open: /judge replays the recorded live owner request (no Claude turn) and reads the capture behind it."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#capture dl", timeout=60000); pg.wait_for_timeout(1000)
    mark(pg, "vs", "#vs"); glide(pg, pg.locator("#vs .paid b"), click=False); pg.wait_for_timeout(1800)
    pg.evaluate("document.querySelector('#ask').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1200)
    mark(pg, "quote", "#ask .quote"); glide(pg, pg.locator("#ask .quote"), click=False); pg.wait_for_timeout(1800)
    pg.evaluate("document.querySelector('#answer').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1200)
    mark(pg, "verdict", "#answer .verdict"); glide(pg, pg.locator("#answer .verdict"), click=False); pg.wait_for_timeout(1800)
    mark(pg, "rule", "#answer .rule"); glide(pg, pg.locator("#answer .rule"), click=False); pg.wait_for_timeout(2200)
    pg.evaluate("document.querySelector('#capture').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1200)
    mark(pg, "capture", "#capture dl"); glide(pg, pg.locator("#capture dd").nth(1), click=False); pg.wait_for_timeout(2500)


def judge2(pg):
    """V16 cold open: the ad report's winner, PayPal's count, the owner's ask, the refusal, and the live raise beside it."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#capture dl", timeout=60000); pg.wait_for_timeout(1200)
    pg.evaluate("document.querySelector('#vs').scrollIntoView({behavior:'smooth', block:'center'})"); pg.wait_for_timeout(1300)
    mark(pg, "vs", "#vs"); glide(pg, pg.locator("#vs .paid b"), click=False); pg.wait_for_timeout(2200)
    pg.evaluate("document.querySelector('#contrast').scrollIntoView({behavior:'smooth', block:'center'})"); pg.wait_for_timeout(1300)
    mark(pg, "contrast", "#contrast"); glide(pg, pg.locator("#c-live-why"), click=False); pg.wait_for_timeout(3200)
    pg.evaluate("document.querySelector('#ask').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1300)
    mark(pg, "quote", "#ask .quote"); glide(pg, pg.locator("#ask .quote"), click=False); pg.wait_for_timeout(2200)
    pg.evaluate("document.querySelector('#answer').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1300)
    mark(pg, "verdict", "#answer .verdict"); glide(pg, pg.locator("#answer .verdict").first, click=False); pg.wait_for_timeout(2400)
    mark(pg, "rule", "#answer .rule"); glide(pg, pg.locator("#answer .rule").first, click=False); pg.wait_for_timeout(2600)


def tryit(pg):
    """A judge types a customer's message; the revenue agent drafts a real sandbox invoice and PayPal's record is read back."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#try-message", timeout=60000); pg.wait_for_timeout(800)
    pg.evaluate("document.querySelector('#try-it').scrollIntoView({behavior:'smooth', block:'center'})"); pg.wait_for_timeout(1400)
    box = pg.locator("#try-message"); glide(pg, box); box.fill("")
    box.type("Hi! Can you book my daughter Mai for the Saturday trial class? Please send me the invoice.", delay=28)
    mark(pg, "message", "#try-message"); pg.wait_for_timeout(600)
    glide(pg, pg.locator("#try-run")); mark(pg, "asked", "#try-run")
    pg.wait_for_function("() => /PayPal says|Skipped|limit|could not/i.test(document.querySelector('#try-result').innerText)", timeout=90000)
    pg.wait_for_timeout(600); mark(pg, "result", "#try-result"); glide(pg, pg.locator("#try-result"), click=False); pg.wait_for_timeout(5000)


def journey(pg):
    """Be the customer: a message, Claude drafts a real PayPal invoice, the owner approves, the send agent sends it, PayPal says SENT."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#try-message", timeout=60000); pg.wait_for_timeout(600)
    pg.evaluate("document.querySelector('#customer').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1200)
    box = pg.locator("#try-message"); glide(pg, box); box.fill("")
    box.type("Hi! Can I book Saturday's trial class for my daughter Mai? Send me the invoice.", delay=24)
    mark(pg, "message", "#try-message"); pg.wait_for_timeout(400)
    glide(pg, pg.locator("#try-run")); mark(pg, "asked", "#try-run")
    pg.wait_for_function("() => /PayPal says|Skipped|limit|could not/i.test(document.querySelector('#try-result').innerText)", timeout=90000)
    pg.wait_for_timeout(500); mark(pg, "draft", "#try-result .paypal-readback"); glide(pg, pg.locator("#try-result .paypal-readback"), click=False); pg.wait_for_timeout(2200)
    btn = pg.locator(".journey button"); mark(pg, "approve", ".journey button"); glide(pg, btn)
    pg.wait_for_function("() => /Sent by the send agent|Not sent|limit|could not/i.test(document.querySelector('.journey').innerText)", timeout=90000)
    pg.wait_for_timeout(500); mark(pg, "sent", ".journey"); glide(pg, pg.locator(".journey a.btn"), click=False); pg.wait_for_timeout(3500)


def paidpage(pg):
    """PayPal's own page for an invoice a customer paid (Lead 21's, drafted by the revenue agent, sent by the send agent)."""
    pg.goto("https://www.sandbox.paypal.com/invoice/p/#3NS5HPJL3XWTECNC", wait_until="load"); pg.wait_for_timeout(6000)
    mark(pg, "page", "body"); pg.mouse.move(960, 400, steps=20); pg.wait_for_timeout(5000)


def twobuyers(pg):
    """Same double charge, two buyers: Claude declines one and refunds the other, live."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector(".ab-card button", timeout=60000); pg.wait_for_timeout(600)
    pg.evaluate("document.querySelector('#refund').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1400)
    mark(pg, "intro", ".ab > p"); glide(pg, pg.locator(".ab > p").first, click=False); pg.wait_for_timeout(1800)
    cards = pg.locator(".ab-card")
    for i in range(2):
        mark(pg, f"card{i}", f".ab-card >> nth={i}"); glide(pg, cards.nth(i).locator("button"))
        pg.wait_for_function(f"() => /Declines|Refunds|limit|could not/i.test(document.querySelectorAll('.ab-out')[{i}].innerText)", timeout=90000)
        pg.wait_for_timeout(400); mark(pg, f"out{i}", f".ab-card >> nth={i}"); glide(pg, cards.nth(i).locator(".ab-out"), click=False); pg.wait_for_timeout(3000)


def gap(pg):
    """One real shop's October at the top of the judge path: chats against paid money for three ad groups, then the ranking."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_function("() => document.querySelectorAll('#gap-grid .gap-card').length === 3", timeout=60000)
    pg.evaluate("document.querySelector('#gap').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1500)
    mark(pg, "sub", "#gap-sub"); glide(pg, pg.locator("#gap-sub"), click=False); pg.wait_for_timeout(2200)
    cards = pg.locator("#gap-grid .gap-card")
    for i in range(3):
        mark(pg, f"card{i}", f"#gap-grid .gap-card >> nth={i}")
        glide(pg, cards.nth(i).locator(".gap-bar").first, click=False); pg.wait_for_timeout(1300)
        glide(pg, cards.nth(i).locator(".gap-bar.money"), click=False); pg.wait_for_timeout(1700)
    mark(pg, "rank", "#gap-rank"); glide(pg, pg.locator("#gap-rank .go"), click=False); pg.wait_for_timeout(3500)


def loop(pg):
    """One lead's real invoice loop on /judge: the chat, Claude's create_invoice, approval and send, reminder, PayPal paid, Meta."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#loop .loop-row", timeout=60000); pg.wait_for_timeout(800)
    pg.evaluate("document.querySelector('#loop').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1500)
    rows = pg.locator("#loop .loop-row")
    for i in range(rows.count()):
        mark(pg, f"row{i}", f"#loop .loop-row >> nth={i}"); glide(pg, rows.nth(i).locator("span"), click=False); pg.wait_for_timeout(2300)


def replay(pg):
    """The shop's real book run through Paid Signal's ledger code: the result, then the double transfers it holds."""
    pg.goto(BASE + "/judge", wait_until="networkidle")
    pg.evaluate("document.querySelector('#replay').scrollIntoView({behavior:'smooth', block:'center'})"); pg.wait_for_timeout(1800)
    ps = pg.locator("#replay .replay-p")
    mark(pg, "head", "#replay .replay-h"); glide(pg, pg.locator("#replay .replay-h"), click=False); pg.wait_for_timeout(2200)
    mark(pg, "result", "#replay .replay-p >> nth=0"); glide(pg, ps.nth(0), click=False); pg.wait_for_timeout(4200)
    mark(pg, "dups", "#replay .replay-p >> nth=1"); glide(pg, ps.nth(1), click=False); pg.wait_for_timeout(5200)


def moneyout(pg):
    """/judge sections 6 and 7: the refund agent returned a double payment; the commission agent paid the creator via Payouts."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#refund .loop-row", timeout=60000); pg.wait_for_selector("#commission .rule", timeout=60000); pg.wait_for_timeout(800)
    pg.evaluate("document.querySelector('#refund').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1500)
    rows = pg.locator("#refund .loop-row")
    for i in range(rows.count()):
        mark(pg, f"r{i}", f"#refund .loop-row >> nth={i}"); glide(pg, rows.nth(i).locator("span"), click=False); pg.wait_for_timeout(2100)
    pg.evaluate("document.querySelector('#commission').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1500)
    mark(pg, "deal", "#commission > p"); glide(pg, pg.locator("#commission > p").first, click=False); pg.wait_for_timeout(2600)
    mark(pg, "orders", "#commission .loop"); glide(pg, pg.locator("#commission .loop-row").nth(1).locator("span"), click=False); pg.wait_for_timeout(2200)
    paid = pg.locator("#commission .rule").first
    paid.scroll_into_view_if_needed(); pg.wait_for_timeout(600)
    mark(pg, "paid", "#commission .rule >> nth=0"); glide(pg, paid, click=False); pg.wait_for_timeout(3200)


def audit(pg):
    """/audit with the sample files: which ads PayPal confirms, revenue no ad can claim, and what the rule allows."""
    pg.goto(BASE + "/audit", wait_until="networkidle"); pg.wait_for_timeout(1200)
    mark(pg, "files", ".files"); glide(pg, pg.locator(".files"), click=False); pg.wait_for_timeout(1800)
    glide(pg, pg.locator("#sample")); pg.wait_for_selector("#out:not([hidden]) #rows tr", timeout=60000); pg.wait_for_timeout(800)
    pg.evaluate("document.querySelector('#out').scrollIntoView({behavior:'smooth', block:'start'})"); pg.wait_for_timeout(1400)
    mark(pg, "headline", "#headline"); glide(pg, pg.locator("#headline"), click=False); pg.wait_for_timeout(2600)
    mark(pg, "stats", "#stats"); glide(pg, pg.locator("#stats .stat").nth(1), click=False); pg.wait_for_timeout(2400)
    mark(pg, "table", ".tbl"); glide(pg, pg.locator("#rows tr").nth(2), click=False); pg.wait_for_timeout(3000)


def nudge(pg):
    """AG Grid's nudge-bot idea inside AG Studio: the Studio nudge agent reminds who still owes; the scoreboard updates."""
    glide(pg, pg.locator("nav a, nav button", has_text="Report").first)
    pg.wait_for_function("window.__studio && window.__studio.getState", timeout=90000); pg.wait_for_timeout(2500)
    open_assistant(pg)  # waits for the first page to render, so it comes before the page switch
    glide(pg, pg.locator(".studio-pages button", has_text="Who still owes")); pg.wait_for_timeout(3000)
    mark(pg, "board", ".studio [class*='widget']:has(.owes)")
    mark(pg, "asked", ".studio button:has-text('Nudge')")
    glide(pg, pg.locator(".studio button", has_text="Nudge who still owes").first)
    t0 = time.time(); quiet = 0
    while time.time() - t0 < 240:  # done once the assistant has shown no Stop button for six seconds
        time.sleep(2)
        quiet = quiet + 2 if not pg.locator(".studio button", has_text="Stop").count() else 0
        if quiet >= 6 and time.time() - t0 > 15: break
    pg.wait_for_timeout(4000); mark(pg, "board_after", ".studio [class*='widget']:has(.owes)")
    glide(pg, pg.locator(".owes-list li").first, click=False); pg.wait_for_timeout(4000)


# ---- V23: the A2 redesign (cards of rows) ----
def scroll_to(pg, sel, block="start"):
    pg.evaluate(f"document.querySelector({json.dumps(sel)}).scrollIntoView({{behavior:'smooth', block:'{block}'}})"); pg.wait_for_timeout(1400)


def home23(pg):
    """Dashboard: 62 leads against 9 paid, each ad's paid revenue per $1, six agents, the flow from the ad report to Meta."""
    pg.wait_for_selector(".hb-row", timeout=60000); pg.wait_for_timeout(800)
    mark(pg, "hero", ".duo"); glide(pg, pg.locator(".duo"), click=False); pg.wait_for_timeout(2400)
    mark(pg, "byad", ".hero-bars"); glide(pg, pg.locator(".hb-row b").first, click=False); pg.wait_for_timeout(2200)
    glide(pg, pg.locator(".hb-row b.good").first, click=False); pg.wait_for_timeout(2200)
    scroll_to(pg, ".agents"); mark(pg, "agents", ".agent-grid"); glide(pg, pg.locator(".agent-grid article").nth(1), click=False); pg.wait_for_timeout(2600)
    scroll_to(pg, ".flow-card"); mark(pg, "flow", ".flow-card"); glide(pg, pg.locator(".fl-ad.worst"), click=False); pg.wait_for_timeout(3200)


def cust23(pg):
    """Be the customer: a message, Claude drafts a real PayPal invoice, the owner approves, the send agent sends it."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#try-message", timeout=60000); pg.wait_for_timeout(500)
    scroll_to(pg, "#customer")
    box = pg.locator("#try-message"); glide(pg, box); box.fill("")
    box.type("Hi! Can I book Saturday's trial class for my daughter Mai? Please send me the invoice.", delay=24)
    mark(pg, "message", "#try-message"); pg.wait_for_timeout(300)
    glide(pg, pg.locator("#try-run"))
    pg.wait_for_function("() => /Drafted|Skipped|Flagged|used up|Not run/.test(document.querySelector('#try-result').innerText)", timeout=90000)
    pg.wait_for_timeout(500); mark(pg, "draft", "#try-result"); glide(pg, pg.locator("#try-result .row").nth(1), click=False); pg.wait_for_timeout(2600)
    btn = pg.get_by_role("button", name="Approve and send"); mark(pg, "approve", "#try-result .rows"); glide(pg, btn)
    pg.wait_for_function("() => /Now pay|Not sent|used up/.test(document.querySelector('#try-result').innerText)", timeout=90000)
    pg.wait_for_timeout(500); mark(pg, "sent", "#try-result .rows"); glide(pg, pg.locator("#try-result a.btn.go"), click=False); pg.wait_for_timeout(3500)


def impact23(pg):
    """The receipt of a judge's own run (the author's, 5 Nov): what the payment changed, then the Undo refund PayPal made."""
    pg.context.add_cookies([{"name": "ps_vid", "value": os.environ["PS_VID"], "url": BASE}])
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_timeout(500)
    scroll_to(pg, "#customer")
    pg.evaluate("""async (id) => { const d = await (await fetch('/api/judge/try/status?id=' + id)).json();
      document.getElementById('try-result').replaceChildren(); const w = document.createElement('div'); document.getElementById('try-result').append(w); steps(4); showPaid(d.invoice, w); }""", os.environ["PS_INV"])
    pg.wait_for_function("() => /Testimonial ad/.test(document.querySelector('#try-result').innerText)", timeout=60000); pg.wait_for_timeout(800)
    scroll_to(pg, "#try-result", "center")
    rows = pg.locator("#try-result .row")
    for i in range(min(rows.count(), 6)):
        mark(pg, f"row{i}", f"#try-result .row >> nth={i}"); glide(pg, rows.nth(i).locator(".v"), click=False); pg.wait_for_timeout(1900)


def says23(pg):
    """Claude says no: 31 leads, 1 paid order; the owner's raise, Claude's refusal, and the rule in code refusing it too."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_function("() => /Refused|Accepted/.test(document.querySelector('#ask').innerText)", timeout=60000)
    scroll_to(pg, "#answer")
    mark(pg, "vs", "#vs"); glide(pg, pg.locator("#vs .big"), click=False); pg.wait_for_timeout(2200)
    rows = pg.locator("#ask .row")
    for i in range(3):
        mark(pg, f"row{i}", f"#ask .row >> nth={i}"); glide(pg, rows.nth(i).locator(".v"), click=False); pg.wait_for_timeout(2300)


def buyers23(pg):
    """Same double charge, two buyers: live Claude declines one and refunds the other (refund tool simulated)."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#buyers .buyer", timeout=60000)
    scroll_to(pg, "#refund")
    cards = pg.locator("#buyers .buyer")
    for i in range(2):
        mark(pg, f"card{i}", f"#buyers .buyer >> nth={i}"); glide(pg, cards.nth(i).get_by_role("button", name="Ask Claude"))
        pg.wait_for_function(f"() => /Refunds one|Keeps both|used up|limit/.test(document.querySelectorAll('#buyers .buyer')[{i}].innerText)", timeout=90000)
        pg.wait_for_timeout(500); mark(pg, f"out{i}", f"#buyers .buyer >> nth={i}"); glide(pg, cards.nth(i).locator(".out"), click=False); pg.wait_for_timeout(3000)


def money23(pg):
    """The real refund the refund agent made, then the creator paid per paid order through PayPal Payouts."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_function("() => /COMPLETED/.test(document.querySelector('#refund-real').innerText)", timeout=60000)
    pg.wait_for_selector("#commission-body .stat", timeout=60000)
    scroll_to(pg, "#refund-real", "center")
    rows = pg.locator("#refund-real .row")
    for i in range(3):
        mark(pg, f"r{i}", f"#refund-real .row >> nth={i}"); glide(pg, rows.nth(i).locator(".v"), click=False); pg.wait_for_timeout(1900)
    scroll_to(pg, "#commission")
    mark(pg, "paid", "#commission-body .stat >> nth=0"); glide(pg, pg.locator("#commission-body .stat").nth(0), click=False); pg.wait_for_timeout(2200)
    mark(pg, "perlead", "#commission-body .stat >> nth=1"); glide(pg, pg.locator("#commission-body .stat").nth(1), click=False); pg.wait_for_timeout(2600)


def trail23(pg):
    """The money trail of one payment: the ad click, PayPal's record read live, Meta's reply, what it changes."""
    pg.goto(BASE + "/trail?capture=3GY34151GC185303G", wait_until="networkidle"); pg.wait_for_function("() => document.querySelectorAll('#trail .sec').length >= 3", timeout=60000); pg.wait_for_timeout(800)
    secs = pg.locator("#trail .sec")
    for i, k in enumerate(["click", "paypal", "meta", "effect"]):
        if i >= secs.count(): break
        secs.nth(i).scroll_into_view_if_needed(); pg.evaluate(f"document.querySelectorAll('#trail .sec')[{i}].scrollIntoView({{behavior:'smooth', block:'start'}})"); pg.wait_for_timeout(1300)
        mark(pg, k, f"#trail .sec >> nth={i}"); glide(pg, secs.nth(i).locator(".row .v").first, click=False); pg.wait_for_timeout(2400)


def shop23(pg):
    """A real gift shop's October: chats against money for three ad groups, then its book rerun in the ledger."""
    pg.goto(BASE + "/judge", wait_until="networkidle"); pg.wait_for_selector("#gap-grid .shop-card", timeout=60000)
    scroll_to(pg, "#gap")
    cards = pg.locator("#gap-grid .shop-card")
    for i in range(3):
        mark(pg, f"card{i}", f"#gap-grid .shop-card >> nth={i}"); glide(pg, cards.nth(i).locator(".bar.money"), click=False); pg.wait_for_timeout(2000)
    scroll_to(pg, "#replay", "center")
    rows = pg.locator("#replay .row")
    for i in range(2):
        mark(pg, f"r{i}", f"#replay .row >> nth={i}"); glide(pg, rows.nth(i).locator(".v"), click=False); pg.wait_for_timeout(2600)


# ---- V26: AG Studio in the Ledger theme ----
def studio26(pg):
    """AG Studio: the real shop's October page (share of chats vs share of money), then the assistant opening on the
    recorded budget-agent run (proposals through the evidence gate, the chart asked of Studio's page agent)."""
    pg.evaluate("() => { location.hash = 'report'; }")
    pg.wait_for_function("() => window.__studio", timeout=90000); pg.wait_for_timeout(2500)
    shop = pg.locator(".studio-pages button", has_text="Real shop"); glide(pg, shop); pg.wait_for_timeout(3500)
    scroll_to(pg, "#studio")
    mark(pg, "kpis", ".studio [class*='widget'] >> nth=0"); pg.wait_for_timeout(1800)
    gap = pg.locator(".studio .claim.share"); mark(pg, "gap", ".studio .claim.share"); glide(pg, gap.locator(".claim-row").first, click=False); pg.wait_for_timeout(2600)
    glide(pg, gap.locator(".claim-row").nth(1), click=False); pg.wait_for_timeout(2000)
    glide(pg, gap.locator(".claim-row").nth(2), click=False); pg.wait_for_timeout(4500)  # stay on the real shop while the narration quotes it
    # the recorded budget run is about the Ads vs PayPal page: go back to it before opening the assistant
    glide(pg, pg.locator(".studio-pages button", has_text="Ads vs PayPal")); pg.wait_for_timeout(2500)
    btn = pg.locator(".studio-card .btn.dark"); glide(pg, btn); pg.wait_for_timeout(3000)
    mark(pg, "chat", ".studio [class*='ai'] >> nth=0"); pg.wait_for_timeout(5500)


SEGMENTS = {"studio26": studio26, "home23": home23, "cust23": cust23, "impact23": impact23, "says23": says23, "buyers23": buyers23, "money23": money23, "trail23": trail23, "shop23": shop23, "judge2": judge2, "tryit": tryit, "loop": loop, "audit": audit, "judge": judge, "trail": trail, "owner": owner, "week": week, "nudge": nudge, "ledger": ledger, "chase": chase, "revenue": revenue, "approvesend": approvesend, "dash": dash, "agent": agent, "assistant": assistant, "chart": chart, "budget": budget, "send": send, "signal": signal, "refund": refund, "moneyout": moneyout, "journey": journey, "paidpage": paidpage, "twobuyers": twobuyers, "gap": gap, "replay": replay}

with sync_playwright() as p:
    b = p.chromium.launch(channel=os.environ.get("PS_CHANNEL") or None, args=["--mute-audio", "--disable-sync", "--no-first-run", "--no-default-browser-check"])
    try:
        for name in [a for a in sys.argv[1:] if a in SEGMENTS]:
            raw = OUT / "rec" / name; shutil.rmtree(raw, ignore_errors=True)
            ctx = b.new_context(bypass_csp=True, viewport={"width": 1920, "height": 1080}, record_video_dir=str(raw), record_video_size={"width": 1920, "height": 1080})
            ctx.add_init_script(CURSOR)
            pg = ctx.new_page(); t0 = time.time()
            pg.on("response", lambda r: print("API", r.status, r.url.split("/api/")[-1], flush=True) if "/api/" in r.url and r.status >= 400 else None)
            pg.goto(BASE + "/?film=1", wait_until="networkidle"); pg.wait_for_selector("#captures .cap", timeout=60000); pg.wait_for_timeout(3000)
            ready = time.time() - t0
            MARKS.clear(); T0[0] = time.time()
            SEGMENTS[name](pg)
            ctx.close()
            webm = next(raw.glob("*.webm")); dest = OUT / "clips" / name; dest.mkdir(parents=True, exist_ok=True)
            for old in dest.glob("*.jpg"): old.unlink()
            # drop the page load, keep the rest at 30 fps
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{ready:.2f}", "-i", str(webm), "-vf", "fps=30", "-q:v", "3", str(dest / "%05d.jpg")], check=True)
            (dest / "marks.json").write_text(json.dumps(MARKS, indent=1))
            print(name, len(list(dest.glob("*.jpg"))) / 30, "s", MARKS, flush=True)
    finally:
        b.close()
