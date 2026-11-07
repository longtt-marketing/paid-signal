"""Paid Signal product film: title cards + real UI captures + synthetic narration + burned captions.
Usage: python scripts/build-film.py prepare|render|assemble   (frames from scripts/capture.py in film/shots)
Needs Pillow, NumPy, edge-tts, FFmpeg. Font: Inter Tight (SIL OFL) in film/fonts, as in the app."""
import asyncio, json, math, subprocess, sys, wave
from functools import lru_cache
from pathlib import Path
import edge_tts
import film_motion as fm
import numpy as np
from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parents[1]
OUT = APP / "film"; OUT.mkdir(exist_ok=True)
SHOTS = OUT / "shots"
import os
FILM_JSON = APP / os.environ.get("PS_FILM", "scripts/film.json")  # which film plan to build (V30: scripts/film-v30.json)
FONT = OUT / "fonts/InterTight.ttf"  # the app's typeface (SIL OFL, google/fonts ofl/intertight), so film and product match
W, H, FPS = 1920, 1080, 30
PAPER, INK, MUTE, FAINT, LINE = "#f6f5f1", "#15171c", "#4a4f5a", "#6b7080", "#e3e0d8"
PAID, GAP, GAPBG, GO, CARD = "#1a7a48", "#8a4b00", "#fff4e0", "#2fbf71", "#ffffff"
def _numbers():
    """Narration quotes the live reconciliation, never a hand-typed figure."""
    import urllib.request
    csv = (APP / "public/data/demo-ads.csv").read_text("utf8")
    req = urllib.request.Request("https://paid-signal.thelongmarketing.workers.dev/api/reconcile", data=json.dumps({"csv": csv}).encode(),
                                 headers={"content-type": "application/json", "User-Agent": "paid-signal-film"})
    t = json.load(urllib.request.urlopen(req))["reconciliation"]["totals"]
    # the hook and the dashboard clip show the ledger before the film's on-screen full refund, so count those back in
    shown = sum(len(s.get("refunds_on_screen", [])) for s in json.loads((FILM_JSON).read_text("utf8")))
    return {"{LEADS}": str(t["leads"]), "{PAYERS}": str(t["paid"] + shown)}


_raw = (FILM_JSON).read_text("utf8")
for _k, _v in (_numbers().items() if len(sys.argv) > 1 and sys.argv[1] == "prepare" else []): _raw = _raw.replace(_k, _v)
SCRIPT = json.loads(_raw)


def run(a): subprocess.run([str(x) for x in a], check=True)
def probe(p): return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]))


@lru_cache(maxsize=64)
def font(size, weight=500):
    f = ImageFont.truetype(str(FONT), size); f.set_variation_by_axes([weight]); return f


@lru_cache(maxsize=2048)
def text_img(txt, size, color, weight, spacing=10):
    f = font(size, weight); d = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    b = d.multiline_textbbox((0, 0), txt, font=f, spacing=spacing)
    im = Image.new("RGBA", (max(1, b[2] - b[0] + 4), max(1, b[3] - b[1] + 4)))
    ImageDraw.Draw(im).multiline_text((2 - b[0], 2 - b[1]), txt, font=f, fill=color, spacing=spacing)
    return im


def wrap(txt, size, weight, width):
    """Break a line at spaces so it fits `width` pixels in this font; explicit newlines are kept."""
    f = font(size, weight); out = []
    for para in txt.split("\n"):
        line = ""
        for w in para.split(" "):
            if line and f.getlength(f"{line} {w}") > width: out.append(line); line = w
            else: line = f"{line} {w}".strip()
        out.append(line)
    return "\n".join(out)


def ease(v): v = min(1, max(0, v)); return 1 - (1 - v) ** 3


def paste(im, obj, x, y, a=1.0):
    if a <= 0: return
    if a < .999: obj = obj.copy(); obj.putalpha(obj.getchannel("A").point(lambda v: int(v * a)))
    im.paste(obj, (round(x), round(y)), obj)


def text(im, txt, x, y, size=40, color=INK, weight=500, t=9, delay=0):
    a = ease((t - delay) / .6); paste(im, text_img(txt, size, color, weight), x, y + (1 - a) * 24, a)


def box(im, xy, fill=CARD, outline=LINE, r=18, width=2):
    ImageDraw.Draw(im).rounded_rectangle(tuple(round(v) for v in xy), radius=r, fill=fill, outline=outline, width=width)


@lru_cache(maxsize=16)
def shot_img(name): return Image.open(SHOTS / name).convert("RGBA")


@lru_cache(maxsize=32)
def shot_crop(name, crop, size): return shot_img(name).crop(crop).resize(size, Image.Resampling.LANCZOS)


@lru_cache(maxsize=16)
def clip_len(name): return len(list((OUT / "clips" / name).glob("*.jpg")))


@lru_cache(maxsize=4)
def clip_frame(name, n, crop, size):
    """Frame n of a screen recording (scripts/record.py), cropped and scaled like a still."""
    n = max(1, min(n, clip_len(name)))
    return Image.open(OUT / "clips" / name / f"{n:05d}.jpg").convert("RGBA").crop(crop).resize(size, Image.Resampling.LANCZOS)


def base(kicker, i, t):
    im = Image.new("RGBA", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((94, 60, 128, 94), radius=9, fill=INK); d.ellipse((104, 70, 118, 84), fill=GO)
    text(im, "Paid Signal", 144, 58, 32, INK, 700)
    text(im, f"{i:02d} / {len(SCRIPT)}", 1700, 64, 24, FAINT)
    if kicker: text(im, kicker, 94, 150, 25, PAID, 650, t, 0)
    d.line((94, 1005, 1826, 1005), fill=LINE, width=2)
    text(im, "PayPal sandbox · real API calls · demo shop is fictional · synthetic narration", 94, 1022, 20, FAINT)
    return im


def ui_scene(s, t):
    """Product first (V4 boards): the screenshot or recording fills the frame and the camera moves over it."""
    if "clip" in s:
        n = round(min(s.get("clip_from", 0) + t * s.get("speed", 1), s.get("clip_to", 1e9)) * FPS) + 1
        n = max(1, min(n, clip_len(s["clip"]))); path = OUT / "clips" / s["clip"] / f"{n:05d}.jpg"; oy, sc = 0, 1
    else:
        path = SHOTS / s["shot"]; oy, sc = fm.offset_y(path)
    im, cam = fm.shoot(fm.fitted(str(path)), s["cam"], t)
    for r in s.get("rings", []):
        a = fm.ease_out((t - r["from"]) / .5) * (1 - fm.ease_out((t - r.get("to", 1e9)) / .4))
        b = r["box"]; fm.spotlight(im, (b[0] * sc, b[1] * sc + oy, b[2] * sc, b[3] * sc), cam, a)
    for c in s.get("callouts", []):
        a = fm.ease_out((t - c["from"]) / .5) * (1 - fm.ease_out((t - c.get("to", 1e9)) / .4))
        fm.callout(im, text_img, c["k"], c["t"], c.get("side", "right"), a, c.get("y", 360))
    k = 1 - fm.ease_out((t - 3.2) / .6)  # the chapter chip names the scene, then gets out of the way
    if s.get("chip") and k > 0: fm.chip(im, text_img, s["chip"], k)
    return im


def hook(s, t):
    """Two big numbers; the ad platform's is struck through, PayPal's stays (FilmHook board)."""
    im = Image.new("RGBA", (W, H), INK)
    (l1, _, s1), (l2, _, s2), (l3, _, s3) = s["lines"]
    text(im, l1, 120, 270, s1, "#f2f1ec", 700, t, .2)
    text(im, l2, 120, 420, s2, "#7ee0a6", 700, t, 1.6)
    text(im, l3, 124, 600, s3, "#c9cbd2", 500, t, 3.2)
    w = text_img(l1, s1, "#f2f1ec", 700).width
    k = fm.ease_out((t - 2.4) / .5)
    if k > 0: ImageDraw.Draw(im).rectangle((120, 270 + s1 * .55, 120 + w * k, 270 + s1 * .55 + 12), fill="#f5b971")
    return im


def scene(s, t, i):
    k = s["key"]
    if "cam" in s: return ui_scene(s, t)
    if k == "hook": return hook(s, t)
    if k in ("hook", "close"):
        im = Image.new("RGBA", (W, H), INK)
        d = ImageDraw.Draw(im); d.rounded_rectangle((94, 60, 128, 94), radius=9, fill="#2b2f38"); d.ellipse((104, 70, 118, 84), fill=GO)
        text(im, "Paid Signal", 144, 58, 32, "#f2f1ec", 700)
        for j, (line_, col, size) in enumerate(s["lines"]):
            text(im, line_, 94, 300 + j * 140, size, {"ink": "#f2f1ec", "paid": "#7ee0a6", "gap": "#f5b971", "mute": "#c9cbd2"}[col], 700 if size > 60 else 500, t, .3 + j * 1.1)
        if k == "close": text(im, "paid-signal.thelongmarketing.workers.dev", 98, 880, 34, "#7ee0a6", 600, t, 3.5)
        return im
    im = base(s.get("kicker"), i, t)
    if s.get("title"): text(im, s["title"], 94, 200, 70, INK, 700, t, .1)
    if "shot" in s or "clip" in s:
        x, y, w, h = s.get("frame", [94, 330, 1732, 640])
        c = tuple(s.get("crop", [0, 0, 1920, 1080]))
        a = ease((t - .3) / .7)
        box(im, (x - 4, y - 4, x + w + 4, y + h + 4), CARD, LINE, 14)
        # a clip plays from clip_from seconds at `speed`, holding its last frame; long waits are sped up, never cut
        img = clip_frame(s["clip"], round(min(s.get("clip_from", 0) + t * s.get("speed", 1), s.get("clip_to", 1e9)) * FPS) + 1, c, (w, h)) if "clip" in s else shot_crop(s["shot"], c, (w, h))
        paste(im, img, x + (1 - a) * 30, y, a)
        for j, n in enumerate(s.get("notes", [])):
            pill_x, pill_y = n.get("at", [x + 20, y + h - 60])
            tag = text_img(n["text"], 24, "#ffffff", 650)
            if t > n.get("from", 2):
                box(im, (pill_x, pill_y, pill_x + tag.width + 32, pill_y + tag.height + 22), n.get("fill", INK), n.get("fill", INK), 12)
                paste(im, tag, pill_x + 16, pill_y + 11)
    if "cards" in s:
        n = len(s["cards"]); cw = (1732 - 24 * (n - 1)) / n
        for j, c in enumerate(s["cards"]):
            x = 94 + j * (cw + 24); a = ease((t - .4 - j * .5) / .6)
            if a <= 0: continue
            box(im, (x, 360 + (1 - a) * 20, x + cw, 760 + (1 - a) * 20), c.get("fill", CARD), c.get("line", LINE), 18)
            text(im, c["k"], x + 28, 390, 22, c.get("kc", FAINT), 650)
            t_txt = wrap(c["t"], 36, 700, cw - 56)
            text(im, t_txt, x + 28, 440, 36, INK, 700)
            text(im, wrap(c["b"], 26, 500, cw - 56), x + 28, 440 + 52 * (t_txt.count("\n") + 1) + 28, 26, MUTE, 500)
    return im


def captions_for(s):
    """Caption chunks of up to ~46 characters that never run across a sentence end (the TTS words carry no punctuation)."""
    import re
    tokens = re.findall(r"\S+", s["text"]); ti = 0
    words = s["words"]; out = []; cur = []; start = None
    for w in words:
        if start is None: start = w["t"]
        cur.append(w["word"])
        ends = False
        while ti < len(tokens):  # find this word in the script text to learn whether a sentence ends here
            tok = tokens[ti]; ti += 1
            if re.sub(r"\W", "", tok).lower().startswith(re.sub(r"\W", "", w["word"]).lower()[:3]): ends = tok.endswith((".", "?", "!")); break
        if len(" ".join(cur)) > 46 or ends:
            out.append((start, w["t"] + w["d"], " ".join(cur))); cur = []; start = None
    if cur: out.append((start, words[-1]["t"] + words[-1]["d"], " ".join(cur)))
    return out


def frame(s, t, i, frac=0):
    im = scene(s, t, i + 1)
    fm.progress(im, frac, dark=s["key"] in ("hook", "close"))
    for a, b, txt in captions_for(s):
        if a <= t - .35 <= b:
            ti = text_img(txt, 34, "#ffffff", 600)
            x = (W - ti.width) / 2; y = 930 if s["key"] not in ("hook", "close") and "cam" not in s else 972
            box(im, (x - 18, y - 12, x + ti.width + 18, y + ti.height + 12), "#15171ce6", "#15171ce6", 10); paste(im, ti, x, y)
    return im.convert("RGB")


async def prepare():
    cursor = 0
    for i, s in enumerate(SCRIPT):
        mp3, tj = OUT / f"voice-{i:02}.mp3", OUT / f"voice-{i:02}.json"
        if mp3.exists() and tj.exists() and json.loads(tj.read_text())["text"] == s["text"]: words = json.loads(tj.read_text())["words"]
        else:
            words = []; c = edge_tts.Communicate(s["text"], "en-US-AndrewMultilingualNeural", rate="+4%", boundary="WordBoundary")
            with mp3.open("wb") as f:
                async for ch in c.stream():
                    if ch["type"] == "audio": f.write(ch["data"])
                    elif ch["type"] == "WordBoundary": words.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7, "word": ch["text"]})
            tj.write_text(json.dumps({"text": s["text"], "words": words}), "utf8")
        dur = math.ceil((probe(mp3) + .9) * FPS) / FPS
        s.update(start=cursor, seconds=dur, words=words, voice=mp3.name); cursor += dur
        print(s["key"], round(dur, 2), flush=True)
    (OUT / "timeline.json").write_text(json.dumps({"seconds": cursor, "scenes": SCRIPT}), "utf8")
    print("total", round(cursor, 1))


def render():
    tl = json.loads((OUT / "timeline.json").read_text())
    p = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", str(OUT / "silent.mp4")], stdin=subprocess.PIPE)
    prev, total = None, tl["seconds"]
    for i, s in enumerate(tl["scenes"]):
        for n in range(round(s["seconds"] * FPS)):
            im = frame(s, n / FPS, i, (s["start"] + n / FPS) / total)
            if prev is not None and n < 12: im = Image.blend(prev, im, fm.smooth((n + 1) / 12))  # crossfade from the last scene
            p.stdin.write(im.tobytes())
        prev = im
    p.stdin.close(); p.wait()


def assemble():
    tl = json.loads((OUT / "timeline.json").read_text()); dur = tl["seconds"]
    ins, fl = [], []
    for i, s in enumerate(tl["scenes"]):
        ins += ["-i", OUT / s["voice"]]; fl.append(f"[{i}:a]aresample=48000,adelay={round((s['start'] + .35) * 1000)}:all=1[v{i}]")
    m = len(tl["scenes"])
    fl.append("".join(f"[v{i}]" for i in range(m)) + f"amix=inputs={m}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=8,apad,atrim=0:{dur}[a]")
    run(["ffmpeg", "-y", "-v", "error", *ins, "-filter_complex", ";".join(fl), "-map", "[a]", "-c:a", "aac", "-b:a", "160k", OUT / "voice.m4a"])
    run(["ffmpeg", "-y", "-v", "error", "-i", OUT / "silent.mp4", "-i", OUT / "voice.m4a", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", OUT / "paid-signal.mp4"])
    run(["ffmpeg", "-y", "-v", "error", "-i", OUT / "paid-signal.mp4", "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-c:a", "copy", "-movflags", "+faststart", OUT / "paid-signal-yt.mp4"])
    print("seconds", probe(OUT / "paid-signal.mp4"))


def still():
    """python scripts/build-film.py still <key> <seconds>...: frames of one scene, to check rings and text before a full render."""
    tl = json.loads((OUT / "timeline.json").read_text()); i, s = next((i, s) for i, s in enumerate(tl["scenes"]) if s["key"] == sys.argv[2])
    for t in sys.argv[3:]: frame(s, float(t), i, 0).save(OUT / f"still-{s['key']}-{t}.jpg", quality=85); print(OUT / f"still-{s['key']}-{t}.jpg")


if __name__ == "__main__":
    {"prepare": lambda: asyncio.run(prepare()), "render": render, "assemble": assemble, "still": still}[sys.argv[1]]()
