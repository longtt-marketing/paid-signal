"""Motion layer for the product film (V4 boards on the Claude Design canvas): the product fills the frame, a camera
eases into the part that matters, a ring with a spotlight marks it, a callout card rises in, a chapter chip sits top
left and a progress bar runs along the bottom. Imported by build-film.py; every coordinate is in source pixels."""
from functools import lru_cache
import os
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
PAPER = (246, 245, 241)


def smooth(v):
    v = min(1, max(0, v)); return v * v * (3 - 2 * v)


def ease_out(v):
    v = min(1, max(0, v)); return 1 - (1 - v) ** 3


@lru_cache(maxsize=24)
def fitted(path):
    """Any screenshot or recorded frame, scaled to 1920 wide; shorter ones are centred on paper to 1080 high."""
    im = Image.open(path).convert("RGB")
    if im.width != W: im = im.resize((W, round(im.height * W / im.width)), Image.Resampling.LANCZOS)
    if im.height < H:
        bg = Image.new("RGB", (W, H), PAPER); bg.paste(im, (0, (H - im.height) // 2)); im = bg
    return im


def offset_y(path):
    """Vertical offset a short source got when centred (ring boxes are given in the original pixels)."""
    im = Image.open(path)
    h = round(im.height * W / im.width)
    return (H - h) // 2 if h < H else 0, W / im.width


def camera(keys, t):
    """keys: [[t, cx, cy, zoom], ...]; eased between keyframes."""
    if t <= keys[0][0]: return keys[0][1:]
    for a, b in zip(keys, keys[1:]):
        if t <= b[0]:
            k = smooth((t - a[0]) / max(1e-6, b[0] - a[0]))
            return [a[i] + (b[i] - a[i]) * k for i in (1, 2, 3)]
    return keys[-1][1:]


def view(src, cx, cy, z):
    w, h = W / z, H / z
    x0 = min(max(cx - w / 2, 0), src.width - w); y0 = min(max(cy - h / 2, 0), src.height - h)
    return x0, y0, w, h


def shoot(src, keys, t):
    cx, cy, z = camera(keys, t)
    if os.environ.get("PS_LOOK") == "v33": z = min(1.6, z)
    x0, y0, w, h = view(src, cx, cy, z)
    filt = Image.Resampling.LANCZOS if os.environ.get("PS_LOOK") == "v33" else Image.Resampling.BILINEAR
    img = src.crop((round(x0), round(y0), round(x0 + w), round(y0 + h))).resize((W, H), filt)
    return img.convert("RGBA"), (x0, y0, z)


def spotlight(im, box, cam, a):
    """Dim everything but the box, then draw a green ring round it."""
    if a <= 0: return
    x0, y0, z = cam
    bx, by, bw, bh = box
    r = ((bx - x0) * z - 10, (by - y0) * z - 10, (bx + bw - x0) * z + 10, (by + bh - y0) * z + 10)
    if os.environ.get("PS_LOOK") == "v33":
        # A quarter-size blur is much cheaper than filtering every full-size frame.
        low = im.convert("RGB").resize((W // 4, H // 4), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(1.4))
        blur = low.resize((W, H), Image.Resampling.BILINEAR).convert("RGBA")
        keep = Image.new("L", (W, H), round(118 * a))
        ImageDraw.Draw(keep).rounded_rectangle(r, radius=16, fill=0)
        blur.putalpha(keep); im.alpha_composite(blur)
        dim = Image.new("RGBA", (W, H), (12, 14, 17, round(55 * a)))
        ImageDraw.Draw(dim).rounded_rectangle(r, radius=16, fill=(0, 0, 0, 0))
        im.alpha_composite(dim)
    else:
        dim = Image.new("RGBA", (W, H), (21, 23, 28, round(90 * a)))
        ImageDraw.Draw(dim).rounded_rectangle(r, radius=16, fill=(0, 0, 0, 0))
        im.alpha_composite(dim)
    ImageDraw.Draw(im).rounded_rectangle(r, radius=16, outline=(47, 191, 113, round(255 * a)), width=6)


def callout(im, text_img, k, t_big, side, a, y=360):
    """Dark card with a green kicker and a large line; rises in."""
    if a <= 0: return
    ki = text_img(k, 26, "#9fd7b8", 600); ti = text_img(t_big, 46, "#ffffff", 700)
    w = max(ki.width, ti.width) + 56; h = ki.height + ti.height + 58
    x = W - 72 - w if side == "right" else 72
    yy = y + (1 - a) * 28
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, w - 1, h - 1), radius=20, fill=(21, 23, 28, round(240 * a)))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x + 6, yy + 14, x + w + 6, yy + h + 14), radius=22, fill=(21, 23, 28, round(60 * a)))
    im.alpha_composite(shadow); im.alpha_composite(card, (round(x), round(yy)))
    for img, dy in ((ki, 26), (ti, 26 + ki.height + 8)):
        if a < .999: img = img.copy(); img.putalpha(img.getchannel("A").point(lambda v: int(v * a)))
        im.alpha_composite(img, (round(x + 28), round(yy + dy)))


def chip(im, text_img, label, a=1.0):
    ti = text_img(label, 26, "#15171c", 600)
    w = ti.width + 76; h = 56; x, y = W - 56 - w, 44  # top right: the product's own headings sit top left
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    d.rounded_rectangle((x, y, x + w, y + h), radius=28, fill=(255, 255, 255, round(240 * a)))
    d.rounded_rectangle((x + 12, y + 12, x + 44, y + 44), radius=9, fill=(21, 23, 28, round(255 * a)))
    d.ellipse((x + 21, y + 21, x + 35, y + 35), fill=(47, 191, 113, round(255 * a)))
    if a < .999: ti = ti.copy(); ti.putalpha(ti.getchannel("A").point(lambda v: int(v * a)))
    im.alpha_composite(layer)
    im.alpha_composite(ti, (x + 58, y + (h - ti.height) // 2))


def progress(im, frac, dark=False):
    d = ImageDraw.Draw(im)
    d.rectangle((0, H - 8, W, H), fill=(255, 255, 255, 24) if dark else (21, 23, 28, 20))
    d.rectangle((0, H - 8, round(W * frac), H), fill=(47, 191, 113, 255))
