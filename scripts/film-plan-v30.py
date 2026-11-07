"""V30 film plan: AG Studio first. After the hook, three Studio scenes (clips from scripts/record.py studio30a studio30b
studio30c): a band click filters the page and the PayPal ledger widget under it, a payment's trail, the Decision menu;
agents that write to PayPal, each read back with its limit in code, and the recorded run that drafts an invoice; a budget
run replayed through Studio's own agent loop. Then the judge path scenes kept from V26 (be the customer, PayPal's page,
Claude says no, real refund and payout, the real shop) and the close.
Phase 1: PS_FILM=scripts/film-v30.json python scripts/film-plan-v30.py texts, then build-film.py prepare (same PS_FILM);
phase 2: python scripts/film-plan-v30.py cams, then build-film.py prepare again, render and assemble."""
import json, sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
FILM = APP / "scripts/film-v30.json"


def plan(*a, **k):
    src = (APP / "scripts/film-plan-v18.py").read_text("utf8").split("\n{\"texts\"")[0]
    ns = {"__file__": str(APP / "scripts/film-plan-v18.py")}; exec(src, ns)
    return ns["plan"](*a, **k)


def marks(name): return json.loads((APP / "film/clips" / name / "marks.json").read_text("utf8"))


CLIPS = {"studio1": "studio30a", "studio2": "studio30b", "studio3": "studio30c", "customer": "cust23", "no": "says23", "money": "money23", "shop": "shop23"}
CHAT = [1515, 300, 380, 760]  # the assistant panel at 1920 x 1080 (its selector reports no size)


def texts():
    v18 = {s["key"]: dict(s) for s in json.loads((APP / "scripts/film-v18.json").read_text("utf8"))}
    hook = {"key": "hook", "lines": [["31 leads", "ink", 150], ["1 paid order", "paid", 150], ["The ad report counts leads. PayPal counts money.", "mute", 44]],
            "text": "In this sandbox demo, the ad report gives the free guide thirty one leads. PayPal shows one paid order. Paid Signal lets AI agents act on the second number, inside AG Studio."}
    s = [hook,
         {"key": "studio1", "chip": "01 · AG Studio investigates",
          "text": "Judges land on AG Studio. One click on the testimonial ad filters the page, and the budget agent's verdict, checked by a rule in code, waits for the owner's approval. Under it, the PayPal ledger is an AG Grid table, narrowed to that ad: eleven leads, four paid. Open a payment for its trail, from the ad click to PayPal to what Meta heard, and decide it right in the cell; the server checks every decision."},
         {"key": "studio2", "chip": "02 · Agents write, PayPal confirms",
          "text": "These agents do not only read. They draft invoices, send reminders, refund and pay out on PayPal, each inside a limit set in code, and Paid Signal reads each PayPal object back: thirty six of thirty six found today. The assistant opens on a recorded run where the revenue agent drafts a real sandbox invoice for the one lead ready to book, and flags a prompt injection."},
         {"key": "studio3", "chip": "03 · Replayed in Studio's agent loop",
          "text": "Replay a budget run plays a recorded run back through Studio's own agent loop, with no model call. The budget agent's proposal passes the evidence gate on its second try, Studio's page agent adds the chart, and its widget agent fills it in."},
         {"key": "customer", "chip": "04 · Be the customer", "text": "On the judge path, you are the customer. Ask to book, and Claude drafts a real PayPal sandbox invoice; code sets the price. You approve, and the send agent sends it on PayPal; the pay link opens here."},
         dict(v18["paid"], chip="05 · PayPal confirms", text="Payment happens on PayPal's own page, as the sandbox buyer; here is one a sandbox buyer paid. No real money moves.", callouts=[]),
         {"key": "no", "chip": "06 · Claude says no", "text": "The owner asks to raise the free guide. Thirty one leads, one paid order: Claude refuses, and recommends the ad PayPal says is paying. The same raise, sent straight to the rule in code, is refused too."},
         {"key": "money", "chip": "07 · Real refund, real payout", "text": "In the PayPal sandbox, the refund agent returned a double payment, and PayPal says completed. The ad's creator is paid per paid order through PayPal Payouts: fifteen dollars for three paid orders."},
         {"key": "shop", "chip": "08 · A real shop", "text": "And the problem is real. In a gift shop the author runs ads for, the attention video brought sixty nine percent of the chats, but nineteen percent of the money. That shop is paid by bank transfer, not PayPal, and its own book, run through the same ledger code, gives the same seven hundred and five orders."},
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
            m = [dict(x, box=CHAT) if x["name"] == "chat" else x for x in m]
            if sc["key"] == "studio3": m = [x for x in m if x["name"] in ("chat", "chart")]  # the starter list scrolls as the run starts
            if sc["key"] == "money": m = [x for x in m if x["name"] in ("r0", "r1", "paid")]  # the narration ends on the payout; past it the page scrolls to the shop
            first = min(x["t"] for x in m)
            sc["clip_from"] = round(max(0.0, first - 1.6), 2)
            sc["clip_to"] = round(max(x["t"] for x in m) + (5.0 if sc["key"].startswith("studio") else 3.2), 2)
            plan(sc, m, secs[sc["key"]])
    FILM.write_text(json.dumps(f, ensure_ascii=False, indent=1), "utf8")
    print({x["key"]: (x.get("speed"), len(x.get("cam", []))) for x in f})


{"texts": texts, "cams": cams}[sys.argv[1]]()
