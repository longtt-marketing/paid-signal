"""V31 film plan: an October shop's ad-to-PayPal mismatch, then a four-step live guided tour of AG Studio and its agents.
Phase 1: PS_FILM=scripts/film-v31.json python scripts/film-plan-v31.py texts, then build-film.py prepare with the same PS_FILM;
phase 2: python scripts/film-plan-v31.py cams, then build-film.py prepare again, render and assemble."""
import json, sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
FILM = APP / "scripts/film-v31.json"


def plan(*a, **k):
    src = (APP / "scripts/film-plan-v18.py").read_text("utf8").split("\n{\"texts\"")[0]
    ns = {"__file__": str(APP / "scripts/film-plan-v18.py")}; exec(src, ns)
    return ns["plan"](*a, **k)


def marks(name): return json.loads((APP / "film/clips" / name / "marks.json").read_text("utf8"))


CLIPS = {"tour1": "tour31a", "tour2": "tour31b", "tour3": "tour31c", "tour4": "tour31d", "customer": "cust23", "no": "says23"}
CHAT = [1515, 300, 380, 760]  # the assistant panel at 1920 x 1080 (its selector reports no size)


def texts():
    v30 = {s["key"]: dict(s) for s in json.loads((APP / "scripts/film-v30.json").read_text("utf8"))}
    hook = {"key": "hook", "lines": [["69% of the chats", "ink", 130], ["19% of the money", "paid", 130], ["A real gift shop's October, matched by hand.", "mute", 44]],
            "text": "In October a small gift shop spent about ten thousand dollars on ads. Matched by hand against its bank transfers, the ad that brought sixty nine percent of its chats brought nineteen percent of its money. Paid Signal runs that check on PayPal payments, and lets AI agents act on it."}
    scenes = [
        hook,
        {"key": "tour1", "chip": "01 · Ads vs PayPal",
         "text": "Judges press one button for a guided tour. One click on the testimonial ad filters AG Studio: the PayPal ledger under it, an AG Grid table, narrows to that ad, and the budget agent's suggestion waits for the owner's approval."},
        {"key": "tour2", "chip": "02 · A payment's history",
         "text": "Open a payment and its history unfolds inside the grid: the ad click, the PayPal capture, and what Meta was told."},
        {"key": "tour3", "chip": "03 · AG Grid AI Toolkit",
         "text": "Ask in plain words. AG Grid's AI Toolkit hands the assistant the grid's schema, and the grid groups the payments by ad and totals the money kept. In our test, {GRIDEVAL} plain-word requests came out right."},
        {"key": "tour4", "chip": "04 · Read back from PayPal",
         "text": "The agents act too. They draft invoices, send reminders, refund double charges and pay creators, each inside a limit set in code, and every action is read back from PayPal. Here, the refund PayPal reports as completed."},
        {"key": "customer", "chip": "05 · Be the customer",
         "text": v30["customer"]["text"].replace("Claude drafts", "the revenue agent drafts")},
        dict(v30["paid"], chip="06 · PayPal confirms"),
        {"key": "no", "chip": "07 · The agent says no",
         "text": "The owner asks to raise the free guide. Thirty one leads, one paid order: the budget agent refuses, and recommends the ad whose PayPal payments show paid orders. The same raise, sent straight to the rule in code, is refused too."},
        dict(v30["close"]),
    ]
    for sc in scenes:
        if sc["key"] in CLIPS:
            sc["clip"] = CLIPS[sc["key"]]; sc["clip_from"] = 0.0; sc["clip_to"] = None
            for k in ("cam", "rings", "callouts"): sc.pop(k, None)
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
            first = min(x["t"] for x in m)
            sc["clip_from"] = round(max(0.0, first - 1.6), 2)
            after = 5.0 if sc["key"].startswith("tour") else 3.2
            sc["clip_to"] = round(max(x["t"] for x in m) + after, 2)
            plan(sc, m, secs[sc["key"]])
    FILM.write_text(json.dumps(scenes, ensure_ascii=False, indent=1), "utf8")
    print({s["key"]: (s.get("speed"), len(s.get("cam", []))) for s in scenes})


{"texts": texts, "cams": cams}[sys.argv[1]]()
