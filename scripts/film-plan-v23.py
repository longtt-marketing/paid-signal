"""V23 film plan: the A2 redesign. One judge's payment from ask to undo, Claude saying no, money back and paid out, the
money trail, a real shop's book, AG Studio. Clips from scripts/record.py (home23 cust23 impact23 says23 buyers23 money23
trail23 shop23, chart cut to chart23 with scripts/cut-clip.py); the PayPal page is the paidpage clip.
Phase 1 (python scripts/film-plan-v23.py texts) writes scripts/film.json; run build-film.py prepare;
phase 2 (python scripts/film-plan-v23.py cams) sets speed, camera and rings from each clip's marks and the voice length;
run build-film.py prepare again, then render and assemble."""
import json, sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
FILM = APP / "scripts/film.json"


def plan(*a, **k):
    src = (APP / "scripts/film-plan-v18.py").read_text("utf8").split("\n{\"texts\"")[0]
    ns = {"__file__": str(APP / "scripts/film-plan-v18.py")}; exec(src, ns)
    return ns["plan"](*a, **k)


def marks(name): return json.loads((APP / "film/clips" / name / "marks.json").read_text("utf8"))


CLIPS = {"home": "home23", "customer": "cust23", "impact": "impact23", "no": "says23", "buyers": "buyers23", "money": "money23", "trail": "trail23", "shop": "shop23", "chart": "chart23"}


def texts():
    v18 = {s["key"]: dict(s) for s in json.loads((APP / "scripts/film-v18.json").read_text("utf8"))}
    hook = {"key": "hook", "lines": [["31 leads", "ink", 150], ["1 paid order", "paid", 150], ["The ad report counts leads. PayPal counts money.", "mute", 44]],
            "text": "In this sandbox demo, the ad report gives the free guide thirty one leads. PayPal shows one paid order. Paid Signal lets AI agents act on the second number."}
    s = [hook,
         {"key": "home", "chip": "01 · The dashboard", "text": "Sixty two leads, nine paid orders. By ad, the free guide brings forty one cents back per dollar; the testimonial ad, two seventy three."},
         {"key": "customer", "chip": "02 · Be the customer", "text": "On the judge path, you are the customer. Ask to book, and Claude drafts a real PayPal sandbox invoice; code sets the price. You approve, and the send agent sends it to you."},
         dict(v18["paid"], chip="03 · PayPal confirms", text="Payment happens on PayPal's own page, as the sandbox buyer; here is one a customer paid. No real money moves.", callouts=[]),
         {"key": "impact", "chip": "04 · What your payment changed", "text": "Then you see what your payment changed. In this recorded run by the author, paying moved the testimonial ad from four to five paid orders, the budget rule re-ran, and no Meta event was sent, since there was no ad click. Then Undo refunded it through PayPal, and the count went back to four."},
         {"key": "no", "chip": "05 · Claude says no", "text": "The owner asks to raise the free guide. Thirty one leads, one paid order: Claude refuses, and recommends the ad PayPal says is paying. The same raise, sent straight to the rule in code, is refused too."},
         {"key": "buyers", "chip": "06 · Money back", "text": "The same double charge, from two buyers. One paid for a second child: Claude keeps both. One pressed Pay twice: Claude refunds one. Here the refund tool is simulated."},
         {"key": "money", "chip": "07 · Real refund, real payout", "text": "With real sandbox money, the refund agent returned a double payment, and PayPal says completed. The ad's creator is paid per paid order through PayPal Payouts: fifteen dollars for three paid orders. Paid per lead, the free guide alone would have cost one fifty five, for one paid order."},
         {"key": "trail", "chip": "08 · The money trail", "text": "Every payment has a money trail: the ad click, PayPal's own record read live, Meta's reply, and what it changes for the budget."},
         {"key": "shop", "chip": "09 · A real shop", "text": "And the problem is real. In a gift shop the author runs ads for, the attention video brought sixty nine percent of the chats, but nineteen percent of the money. Its own book, run through Paid Signal's ledger, gives the same seven hundred and five orders, and holds all seven double payments."},
         {"key": "chart", "chip": "10 · AG Studio", "text": "In the AG Studio report, the owner asks for a bar chart of paid revenue by ad. Studio's own agents, running on Claude, add it from the same PayPal-confirmed numbers; the wait is cut."},
         dict(v18["close"])]
    for sc in s:
        if sc["key"] in CLIPS:
            sc["clip"] = CLIPS[sc["key"]]; sc["clip_from"] = 0.0; sc["clip_to"] = None
            for k in ("cam", "rings", "callouts"): sc.pop(k, None)
    FILM.write_text(json.dumps(s, ensure_ascii=False, indent=1), "utf8")
    print([(x["key"], x.get("chip")) for x in s])


def cams():
    tl = json.loads((APP / "film/timeline.json").read_text("utf8"))
    secs = {x["key"]: x["seconds"] for x in tl["scenes"]}
    f = json.loads(FILM.read_text("utf8"))
    for sc in f:
        if sc["key"] in CLIPS:
            m = marks(sc["clip"])
            if sc["key"] == "home": m = [x for x in m if x["name"] in ("hero", "byad")]  # the page scrolls away at 9.6 s: end before it
            first = min(x["t"] for x in m)
            sc["clip_from"] = round(max(0.0, first - 1.6), 2)
            sc["clip_to"] = 9.3 if sc["key"] == "home" else round(max(x["t"] for x in m) + 3.2, 2)
            plan(sc, m, secs[sc["key"]])
    FILM.write_text(json.dumps(f, ensure_ascii=False, indent=1), "utf8")
    print({x["key"]: (x.get("speed"), len(x.get("cam", []))) for x in f})


{"texts": texts, "cams": cams}[sys.argv[1]]()
