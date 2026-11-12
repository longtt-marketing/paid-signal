"""Paid Signal product film: title cards + real UI captures + synthetic narration + burned captions.
Usage: python scripts/build-film.py prepare|render|assemble   (frames from scripts/capture.py in film/shots)
Needs Pillow, NumPy, edge-tts, FFmpeg. Font: Inter Tight (SIL OFL) in film/fonts, as in the app."""
import asyncio, json, math, subprocess, sys, wave, time
from functools import lru_cache
from pathlib import Path
import edge_tts
import film_motion as fm
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

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
    k = 1.0 if _v33() else 1 - fm.ease_out((t - 3.2) / .6)
    if s.get("chip") and k > 0:
        fm.chip(im, text_img, s["chip"], k)
        if _v33() and t < 1.05:
            move=ease((t-.7)/.35); size=round(54-28*move); ti=text_img(s["chip"],size,"#f4f5f2",650)
            tx=90+(W-56-ti.width-90)*move; ty=78-32*move
            box(im,(tx-18,ty-12,tx+ti.width+18,ty+ti.height+12),(21,23,28,220),(21,23,28,220),14)
            paste(im,ti,tx,ty)
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
        if k == "close" and not _v33(): text(im, "paid-signal.thelongmarketing.workers.dev", 98, 880, 34, "#7ee0a6", 600, t, 3.5)
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
    if os.environ.get("PS_LOOK") == "v33":
        if s["key"] == "hook": im = kinetic_hook(s, t)
        elif s["key"] == "close": im = close_card(s, t)
        elif "cam" in s: im = framed_stage(im, s, t)
    fm.progress(im, frac, dark=s["key"] in ("hook", "close"))
    if os.environ.get("PS_LOOK") == "v33" and s.get("words"):
        draw_word_caption(im, s, t)
    else:
        for a, b, txt in captions_for(s):
            if a <= t - .35 <= b:
                ti = text_img(txt, 34, "#ffffff", 600)
                x = (W - ti.width) / 2; y = 930 if s["key"] not in ("hook", "close") and "cam" not in s else 972
                box(im, (x - 18, y - 12, x + ti.width + 18, y + ti.height + 12), "#15171ce6", "#15171ce6", 10); paste(im, ti, x, y)
    return im.convert("RGB")


def _v33(): return os.environ.get("PS_LOOK") == "v33"


@lru_cache(maxsize=1)
def stage_background():
    """One deterministic ink canvas, with soft radial lights and subtle fixed grain."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    arr = np.empty((H, W, 3), dtype=np.float32); arr[:] = (15, 17, 20)
    for x, y, radius, color, strength in ((450, 400, 570, (43, 210, 122), .19), (1510, 740, 640, (232, 163, 78), .14), (1390, 80, 520, (43, 210, 122), .07)):
        a = (np.exp(-((xx-x)**2 + (yy-y)**2) / (2*radius*radius)) * strength)[..., None]
        arr = arr * (1-a) + np.asarray(color, dtype=np.float32) * a
    rng = np.random.default_rng(3301); arr += rng.normal(0, 2.25, (H, W, 1))
    return Image.fromarray(np.uint8(np.clip(arr, 0, 255)), "RGB").convert("RGBA")


@lru_cache(maxsize=8)
def stage_mask(size):
    w, h = size; m = Image.new("L", size); ImageDraw.Draw(m).rounded_rectangle((0, 0, w-1, h-1), radius=20, fill=255); return m


@lru_cache(maxsize=1)
def stage_shadow():
    m = Image.new("RGBA", (W, H), (0,0,0,0)); ImageDraw.Draw(m).rounded_rectangle((90, 52, 1830, 1040), radius=24, fill=(0,0,0,155)); return m.filter(ImageFilter.GaussianBlur(28))


def framed_stage(im, s, t):
    z = fm.camera(s["cam"], t)[2]
    k = ease((z - 1.0) / .15); scale = .93 + .07*k
    if scale >= .999: return im
    bg = stage_background().copy(); bg.alpha_composite(stage_shadow())
    ww, hh = round(1880*scale), round(1058*scale); x, y = (W-ww)//2, (H-hh)//2
    bar = max(28, round(42*scale)); inner = (ww, hh-bar)
    shell = Image.new("RGBA", (ww, hh), (25,28,32,255)); ImageDraw.Draw(shell).rounded_rectangle((0,0,ww-1,hh-1), radius=20, fill=(24,27,31,255))
    d = ImageDraw.Draw(shell)
    for j,c in enumerate(((255,95,86,235),(255,190,76,235),(45,205,112,235))):
        q=round(15*scale); cx=round((20+24*j)*scale); cy=bar//2; d.ellipse((cx-q//2,cy-q//2,cx+q//2,cy+q//2),fill=c)
    content = im.resize(inner, Image.Resampling.LANCZOS); shell.alpha_composite(content,(0,bar))
    shell.putalpha(stage_mask((ww,hh))); bg.alpha_composite(shell,(x,y)); return bg


def draw_word_caption(im, s, t):
    """Keep the established caption pill while highlighting the currently spoken token."""
    active_t=t-.35; chunks=captions_for(s); chunk=next(((a,b,txt) for a,b,txt in chunks if a<=active_t<=b),None)
    if not chunk: return
    a,b,txt=chunk; words=[w for w in s["words"] if a<=w["t"]<=b]; active=next((w for w in words if w["t"]<=active_t<w["t"]+w["d"]),None)
    f=font(34,600); d=ImageDraw.Draw(im); bits=[]; widths=[]
    for w in words:
        label=w["word"]+" "; widths.append(f.getlength(label)); bits.append(label)
    total=round(sum(widths)); x=(W-total)//2; y=972; height=46
    box(im,(x-18,y-12,x+total+18,y+height+7),(21,23,28,235),(21,23,28,235),12)
    for w,label,ww in zip(words,bits,widths):
        d.text((round(x),y),label,font=f,fill="#2BD27A" if active is w else "#ffffff"); x+=round(ww)


def _perspective_product(src, progress):
    """Map a capture into a settling perspective quad using a solved homography."""
    p=max(0,min(1,progress)); tilt=(1-p)
    to=np.array([[360-120*tilt,270+100*tilt],[1560+80*tilt,210+40*tilt],[1600+130*tilt,810-70*tilt],[320-80*tilt,870-20*tilt]],dtype=float)
    target=np.array([[0,0],[W,0],[W,H],[0,H]],dtype=float); a=[]; b=[]
    for (x,y),(u,v) in zip(to,target):
        a.extend(([x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y])); b.extend((u,v))
    c=np.linalg.solve(np.asarray(a),np.asarray(b))
    return src.transform((W,H),Image.Transform.PERSPECTIVE,tuple(c),Image.Resampling.BICUBIC)


def kinetic_hook(s,t):
    """Timed opening built from the scene's word boundaries."""
    im=Image.new("RGBA",(W,H),(15,17,20,255)); d=ImageDraw.Draw(im)
    by={}
    for word in s.get("words",[]): by.setdefault(word["word"].lower().strip(".,;:!?'\u2019"),word["t"])
    def seen(word): return t>=by.get(word.lower(),999)
    f=font(83,700); x=168; y=175
    for word in ("Ad","reports","count","chats."):
        if seen(word.rstrip(".")):
            d.text((x,y),word,font=f,fill="#f3f4f2"); x+=round(f.getlength(word+" "))
    if seen("PayPal"):
        f2=font(81,700); d.text((168,282),"PayPal counts money.",font=f2,fill="#2BD27A")
        k=ease((t-by.get("money",0)-.15)/.45); d.rounded_rectangle((168,385,168+round(f2.getlength("PayPal counts money.")*k),392),radius=4,fill="#2BD27A")
    label="A real gift shop's October · matched by hand against its bank transfers"
    if t>=by.get("October",999):
        ti=text_img(label,27,"#a7adb4",500); paste(im,ti,170,430,ease((t-by["October"])/.3))
    bars_t=by.get("sixty",999); money_t=by.get("nineteen",999); transition=by.get("does",999)
    if t>=bars_t:
        slide=ease((t-transition)/.55); top=640-round(220*slide); q=ease((t-bars_t)/1.2)
        alpha=int(255*(1-.65*ease((t-money_t)/.4)))
        d.rounded_rectangle((170,top,1750,top+92),radius=20,fill=(35,41,45,255)); d.rounded_rectangle((170,top,170+round(1580*.69*q),top+92),radius=20,fill=(43,210,122,alpha))
        d.text((192,top+20),"Chats",font=font(31,650),fill=(248,249,247,alpha)); d.text((1450,top+11),"69%",font=font(49,700),fill=(248,249,247,alpha))
        if t>=money_t:
            q2=ease((t-money_t)/1.25); yy=top+120
            d.rounded_rectangle((170,yy,1750,yy+92),radius=20,fill=(35,41,45,255)); d.rounded_rectangle((170,yy,170+round(1580*.19*q2),yy+92),radius=20,fill=(232,163,78,255))
            d.text((192,yy+20),"Money",font=font(31,650),fill="#f8f9f7"); d.text((1450,yy+11),"19%",font=font(49,700),fill="#f8f9f7")
    if t>=transition:
        p=ease((t-transition)/1.2); src=clip_frame(os.environ.get("PS_HOOK_CLIP","tour31a"),int(os.environ.get("PS_HOOK_FRAME","150")),(0,0,1920,1080),(W,H)); card=_perspective_product(src,p)
        shade=Image.new("RGBA",(W,H),(0,0,0,0)); shade.putalpha(card.getchannel("A").filter(ImageFilter.GaussianBlur(22)).point(lambda z:int(z*.46)))
        bg=Image.new("RGBA",(W,H),(15,17,20,255)); bg.alpha_composite(shade); bg.alpha_composite(card)
        pbar=ease((t-transition)/1.2); top=400-round(320*pbar); bd=ImageDraw.Draw(bg)
        for j,(label,value,color,opacity) in enumerate((("Chats","69%",(43,210,122),int(255*(1-.65*ease((t-money_t)/.4)))),("Money","19%",(232,163,78),255))):
            yy=top+j*74; bd.rounded_rectangle((360,yy,1560,yy+58),radius=15,fill=(28,33,36,230))
            bd.rounded_rectangle((360,yy,360+round(1200*(.69 if j==0 else .19)),yy+58),radius=15,fill=(*color,opacity))
            bd.text((382,yy+9),label,font=font(27,650),fill=(248,249,247,opacity)); bd.text((1430,yy+4),value,font=font(38,700),fill=(248,249,247,opacity))
        return bg
    return im


def close_card(s,t):
    im=Image.new("RGBA",(W,H),(15,17,20,255)); d=ImageDraw.Draw(im)
    src=clip_frame(os.environ.get("PS_HOOK_CLIP","tour31a"),int(os.environ.get("PS_HOOK_FRAME","150")),(0,0,1920,1080),(1650,928)).filter(ImageFilter.GaussianBlur(7)); src.putalpha(112)
    im.alpha_composite(src,(135+round(18*math.sin(t*.32)),105+round(9*math.cos(t*.3))))
    veil=Image.new("RGBA",(W,H),(10,12,15,165)); im.alpha_composite(veil)
    title=text_img("Paid Signal.",108,"#f4f5f2",700); scale=.85+.15*ease(t/.9); title=title.resize((round(title.width*scale),round(title.height*scale)),Image.Resampling.LANCZOS); paste(im,title,160,210)
    f=font(50,650); d=ImageDraw.Draw(im)
    spans=[(1.05,2.5,165,365,"#f0f2ef"),(2.55,4.0,165,447,"#2BD27A")]
    for start,end,x,y,color in spans:
        selected=[w for w in s.get("words",[]) if start<=w["t"]<end and w["t"]<=t]
        for j,w in enumerate(selected):
            word=w["word"] + ("." if j==len([z for z in s.get("words",[]) if start<=z["t"]<end])-1 else "")
            d.text((x,y),word,font=f,fill=color); x+=round(f.getlength(word+" "))
    url="paid-signal.thelongmarketing.workers.dev/studio"; ti=text_img(url,30,"#dfe5e1",600); x=160; y=560
    d.rounded_rectangle((x-22,y-14,x+ti.width+22,y+ti.height+14),radius=24,fill=(31,37,39,235),outline=(43,210,122,170),width=2); paste(im,ti,x,y)
    for j,label in enumerate(s.get("chips",[])[:3]):
        fade=ease((t-(3.0+j*.35))/.45); ti=text_img(label,24,"#e9edea",600); xx=160+j*535; yy=650
        d.rounded_rectangle((xx,yy,xx+ti.width+32,yy+ti.height+24),radius=16,fill=(35,42,43,round(230*fade)),outline=(81,96,91,round(140*fade)),width=1); paste(im,ti,xx+16,yy+12,fade)
    text(im,"Independent; synthetic narration",164,742,22,"#a4ada7",500,t,3.8)
    return im


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
    tl = render_timeline()
    p = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", str(OUT / "silent.mp4")], stdin=subprocess.PIPE)
    prev, total = None, tl["seconds"]
    for i, s in enumerate(tl["scenes"]):
        for n in range(round(s["seconds"] * FPS)):
            im = frame(s, n / FPS, i, (s["start"] + n / FPS) / total)
            if prev is not None and n < 12:
                k=fm.smooth((n+1)/12)
                im = push_transition(prev, im, k) if _v33() else Image.blend(prev, im, k)
            p.stdin.write(im.tobytes())
        prev = im
    p.stdin.close(); p.wait()


def render_timeline():
    """Use selected-plan art fields with the already prepared word timing and media timeline."""
    tl=json.loads((OUT/"timeline.json").read_text("utf8"))
    if not _v33(): return tl
    plan=json.loads(FILM_JSON.read_text("utf8")); by={x["key"]:x for x in plan}
    merged=[]
    for old in tl["scenes"]:
        new=dict(old); p=by.get(old["key"],{})
        for k,v in p.items():
            if k not in ("start","seconds","words","voice"): new[k]=v
        merged.append(new)
    tl["scenes"]=merged
    return tl


def push_transition(outgoing, incoming, k):
    """Twelve-frame scale-and-push chapter change."""
    ow,oh=round(W*(1+.06*k)),round(H*(1+.06*k))
    out=outgoing.resize((ow,oh),Image.Resampling.BICUBIC)
    canvas=Image.new("RGBA",(W,H),(15,17,20,255)); canvas.alpha_composite(out.convert("RGBA"),((W-ow)//2,(H-oh)//2))
    canvas.putalpha(canvas.getchannel("A").point(lambda a:round(a*(1-.35*k))))
    iw,ih=round(W*(.95+.05*k)),round(H*(.95+.05*k))
    inc=incoming.resize((iw,ih),Image.Resampling.BICUBIC).convert("RGBA")
    layer=Image.new("RGBA",(W,H),(0,0,0,0)); layer.alpha_composite(inc,(round(W*(1-k)),(H-ih)//2))
    canvas.alpha_composite(layer)
    return canvas.convert("RGB")


def synth_wavs(tl):
    """Generate the v33 ambience and reusable SFX using NumPy only."""
    rate=48000; dur=float(tl["seconds"]); n=round(rate*dur); t=np.arange(n,dtype=np.float32)/rate
    # A quiet, slowly shifting D-minor-ish bed; its tones and 0.1 Hz level motion have no percussion.
    chord=((.22*np.sin(2*np.pi*110.00*t)+.18*np.sin(2*np.pi*146.83*t+.18*np.sin(2*np.pi*.018*t))+
            .14*np.sin(2*np.pi*174.61*t+.2*np.sin(2*np.pi*.013*t))+.12*np.sin(2*np.pi*220.15*t)) *
           (.72+.18*np.sin(2*np.pi*.1*t)))
    fade=np.minimum(1,t/1.5)*np.minimum(1,np.maximum(0,(dur-t)/3)); mono=np.asarray(chord*fade*.12,dtype=np.float32)
    write_wav(OUT/"ambient-bed.wav",np.column_stack((mono,mono)),rate)
    rng=np.random.default_rng(331); sw=round(rate*.85); st=np.arange(sw,dtype=np.float32)/rate
    noise=rng.normal(0,1,sw).astype(np.float32); env=np.sin(np.pi*np.minimum(1,st/.85))**2
    sweep=noise*env*.035; write_wav(OUT/"whoosh.wav",np.column_stack((sweep,sweep)),rate)
    sn=round(rate*.095); st=np.arange(sn,dtype=np.float32)/rate; tick=np.sin(2*np.pi*1050*st)*np.exp(-st*44)*.045
    write_wav(OUT/"tick.wav",np.column_stack((tick,tick)),rate)


def write_wav(path, samples, rate):
    pcm=np.asarray(np.clip(samples,-1,1)*32767,dtype="<i2")
    with wave.open(str(path),"wb") as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(rate); f.writeframes(pcm.tobytes())


def assemble():
    if _v33(): return assemble_v33()
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


def assemble_v33():
    tl=render_timeline(); dur=float(tl["seconds"]); synth_wavs(tl)
    args=[]; nodes=[]
    for i,s in enumerate(tl["scenes"]):
        args += ["-i",OUT/s["voice"]]
        nodes.append(f"[{i}:a]aresample=48000,adelay={round((s['start']+.35)*1000)}:all=1,apad,atrim=0:{dur},asetpts=PTS-STARTPTS[v{i}]")
    m=len(tl["scenes"]); voice_inputs="".join(f"[v{i}]" for i in range(m))
    nodes.append(f"{voice_inputs}amix=inputs={m}:normalize=0,asplit=2[vref][vout]")
    args += ["-i",OUT/"ambient-bed.wav"]; bed=m
    nodes.append(f"[{bed}:a]lowpass=f=700,volume=1,atrim=0:{dur}[bed]")
    nodes.append("[bed][vref]sidechaincompress=threshold=0.035:ratio=8:attack=35:release=450:makeup=1[duck]")
    events=[]
    for s in tl["scenes"]:
        events.append((OUT/"whoosh.wav",float(s["start"]),.11))
        for r in s.get("rings",[]): events.append((OUT/"tick.wav",float(s["start"])+float(r.get("from",0)),.10))
    labels=[]
    for j,(path,at,gain) in enumerate(events):
        args += ["-i",path]; idx=m+1+j; label=f"s{j}"; labels.append(f"[{label}]")
        nodes.append(f"[{idx}:a]volume={gain},adelay={round(at*1000)}:all=1,apad,atrim=0:{dur},asetpts=PTS-STARTPTS[{label}]")
    if labels:
        nodes.append("".join(labels)+f"amix=inputs={len(labels)}:normalize=0,lowpass=f=2600[sfx]")
        final_inputs="[vout][duck][sfx]"
        ninputs=3
    else: final_inputs="[vout][duck]"; ninputs=2
    nodes.append(f"{final_inputs}amix=inputs={ninputs}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=8,atrim=0:{dur}[a]")
    run(["ffmpeg","-y","-v","error",*args,"-filter_complex",";".join(nodes),"-map","[a]","-c:a","aac","-b:a","192k",OUT/"voice.m4a"])
    run(["ffmpeg","-y","-v","error","-i",OUT/"silent.mp4","-i",OUT/"voice.m4a","-c:v","copy","-c:a","copy","-shortest","-movflags","+faststart",OUT/"paid-signal.mp4"])
    run(["ffmpeg","-y","-v","error","-i",OUT/"paid-signal.mp4","-c:v","libx264","-preset","slow","-crf","26","-c:a","copy","-movflags","+faststart",OUT/"paid-signal-yt.mp4"])
    print("seconds",probe(OUT/"paid-signal.mp4"))


def still():
    """Still forms: still <seconds> <out.png>, or legacy still <key> <local-seconds> ..."""
    tl=render_timeline()
    if len(sys.argv)==4 and Path(sys.argv[3]).suffix.lower() in (".png",".jpg",".jpeg"):
        target=float(sys.argv[2]); i,s=next((i,s) for i,s in enumerate(tl["scenes"]) if s["start"]<=target<s["start"]+s["seconds"])
        local=target-s["start"]; started=time.perf_counter(); out=Path(sys.argv[3])
        frame(s,local,i,target/tl["seconds"]).save(out); elapsed=time.perf_counter()-started
        print(f"{out} render_seconds={elapsed:.4f} seconds_per_frame={elapsed:.4f}")
        return
    i,s=next((i,s) for i,s in enumerate(tl["scenes"]) if s["key"]==sys.argv[2])
    for t in sys.argv[3:]:
        started=time.perf_counter(); path=OUT/f"still-{s['key']}-{t}.jpg"
        frame(s,float(t),i,0).save(path,quality=85); elapsed=time.perf_counter()-started
        print(f"{path} render_seconds={elapsed:.4f} seconds_per_frame={elapsed:.4f}")


if __name__ == "__main__":
    {"prepare": lambda: asyncio.run(prepare()), "render": render, "assemble": assemble, "still": still}[sys.argv[1]]()
