"""V36 film plan: one payment's journey on the rebuilt judge path (be the customer, PayPal confirms), then the owner's
AG Studio workspace, the agents' PayPal work, Claude selling over MCP and what the agents cannot do; all scenes re-recorded 12 Nov.
Phase 1: python scripts/film-plan-v36.py texts, then PS_FILM=scripts/film-v36.json build-film.py prepare;
phase 2: python scripts/film-plan-v36.py cams, then build-film.py prepare again, render and assemble."""
import json, sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
SRC = APP / "scripts/film-v33.json"
FILM = APP / "scripts/film-v36.json"


def plan(*a, **k):
    src = (APP / "scripts/film-plan-v18.py").read_text("utf8").split("\n{\"texts\"")[0]
    ns = {"__file__": str(APP / "scripts/film-plan-v18.py")}; exec(src, ns)
    return ns["plan"](*a, **k)


def marks(name): return json.loads((APP / "film/clips" / name / "marks.json").read_text("utf8"))


CLIPS = {"tour1": "tour31a", "tour2": "tour31b", "tour3": "tour31c", "tour4": "tour31d", "money": "money36", "agent": "agent36", "customer": "cust36", "no": "says36"}
CHAT = [1515, 300, 380, 760]
DOT = " · "


def texts():
    old = {s["key"]: s for s in json.loads(SRC.read_text("utf8"))}
    hook = dict(old["hook"])
    hook["text"] = ("Ad reports count chats. PayPal counts money. In a real gift shop's October, matched by hand against its bank transfers, "
                    "the ad with sixty nine percent of the chats brought nineteen percent of the money. And now AI agents send buyers too. "
                    "Paid Signal credits ads and agents only with sales PayPal confirms, and refunds and payouts wait for the owner's click.")
    money = dict(old["money"], text="These are live PayPal sandbox calls. The refund agent returned a forty nine dollar double payment, and PayPal says completed. The ad's creator is paid per confirmed order through PayPal Payouts: fifteen dollars for three paid orders.")
    customer = dict(old["customer"], text="Start as the customer. Ask to book, and the revenue agent drafts a PayPal sandbox invoice; code sets the price. The owner approves, and the send agent sends it on PayPal; the pay link opens here.")
    tour1 = dict(old["tour1"], text="Now the owner's side: the shop's workspace, in AG Studio. One click on the testimonial ad filters the page: the PayPal ledger under it, an AG Grid table, narrows to that ad, and the budget agent's suggestion waits for the owner's approval.")
    tour3 = dict(old["tour3"], text="Ask in plain words. AG Grid's AI Toolkit hands the assistant the grid's schema, and the grid groups the payments by ad and totals the money kept. We measured it: fifty nine of sixty three grouping requests came out right, a hundred and forty nine of a hundred and fifty three overall.")
    agent = {"key": "agent",
             "text": ("Outside AI agents can sell for the shop too. Claude, connected over MCP, started a PayPal sandbox checkout, and the buyer paid on PayPal. "
                      "Only after PayPal confirmed the payment did Claude ask for its commission; the owner approved, and PayPal Payouts paid five dollars to the program's sandbox account. "
                      "An agent with no confirmed sale asks anyway: code says nothing is owed.")}
    close = dict(old["close"])
    close["text"] = "Paid Signal. Ads and AI agents, credited only with sales PayPal confirms. Take the guided tour yourself: no login."
    close["lines"] = [["Paid Signal.", "ink", 110], ["Ads and AI agents, credited only with sales PayPal confirms.", "paid", 50], ["paid-signal.thelongmarketing.workers.dev/studio", "mute", 40]]
    close["span2_end"] = 5.3
    close["chips"] = ["149 of 153 grid requests right", "Agent commission: Payouts SUCCESS", "No login"]
    order = ["hook", "customer", "paid", "tour1", "tour2", "tour3", "tour4", "money", "agent", "no", "close"]
    by = dict(old, hook=hook, money=money, agent=agent, close=close, customer=customer, tour1=tour1, tour3=tour3)
    labels = {"tour1": "Ads vs PayPal", "tour2": "A payment's history", "tour3": "AG Grid AI Toolkit", "tour4": "Read back from PayPal",
              "money": "Live sandbox money", "agent": "Claude sells over MCP", "customer": "Be the customer", "paid": "PayPal confirms", "no": "The agent says no"}
    scenes = []
    for i, k in enumerate(order):
        sc = dict(by[k])
        if k in labels: sc["chip"] = f"{i:02d}{DOT}{labels[k]}"
        if k in CLIPS:
            sc["clip"] = CLIPS[k]; sc["clip_from"] = 0.0; sc["clip_to"] = None
            for f in ("cam", "rings", "callouts", "speed"): sc.pop(f, None)
        scenes.append(sc)
    FILM.write_text(json.dumps(scenes, ensure_ascii=False, indent=1), "utf8")
    print([(s["key"], s.get("chip")) for s in scenes])


def cams():
    tl = json.loads((APP / "film/timeline.json").read_text("utf8"))
    secs = {s["key"]: s["seconds"] for s in tl["scenes"]}
    scenes = json.loads(FILM.read_text("utf8"))
    for sc in scenes:
        if sc["key"] in CLIPS:
            m = marks(sc["clip"])
            m = [dict(x, box=CHAT) if x["name"] == "chat" else x for x in m]
            if sc["key"] == "money": m = [x for x in m if x["name"] in ("r0", "r1", "paid")]
            if sc["key"] == "no": m = [x for x in m if x["name"] != "card"]
            if sc["key"] == "tour4": m = [x for x in m if x["name"] in ("actions", "refund")]
            first = min(x["t"] for x in m)
            lead_in = {"tour4": 0.3, "agent": 1.6}.get(sc["key"], 1.6)
            sc["clip_from"] = round(max(0.0, first - lead_in), 2)
            after = {"money": 1.2, "tour4": 7.0, "agent": 3.4}.get(sc["key"], 5.0 if sc["key"].startswith("tour") else 3.2)
            sc["clip_to"] = round(max(x["t"] for x in m) + after, 2)
            plan(sc, m, secs[sc["key"]], zoom_cap={"customer": 1.2, "no": 1.2, "paid": 1.3, "agent": 1.5}.get(sc["key"], 1.6))
    FILM.write_text(json.dumps(scenes, ensure_ascii=False, indent=1), "utf8")
    print({s["key"]: (s.get("speed"), len(s.get("cam", []))) for s in scenes})


{"texts": texts, "cams": cams}[sys.argv[1]]()
