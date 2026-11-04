"""Joins time windows of a recorded clip into a new clip (frames renumbered, marks shifted), so a long wait can be cut
and the film says so. Usage: python scripts/cut-clip.py <src> <dst> <from>-<to> [<from>-<to> ...]  (seconds)"""
import json, shutil, sys
from pathlib import Path

FPS = 30
APP = Path(__file__).resolve().parents[1]
src, dst = APP / "film/clips" / sys.argv[1], APP / "film/clips" / sys.argv[2]
windows = [tuple(float(x) for x in w.split("-")) for w in sys.argv[3:]]
if dst.exists(): shutil.rmtree(dst)
dst.mkdir(parents=True)
marks = json.loads((src / "marks.json").read_text("utf8"))
n, out_marks, offset = 0, [], 0.0
for a, b in windows:
    for f in range(int(a * FPS) + 1, int(b * FPS) + 1):
        p = src / f"{f:05d}.jpg"
        if not p.exists(): break
        n += 1; shutil.copy(p, dst / f"{n:05d}.jpg")
    out_marks += [dict(m, t=round(m["t"] - a + offset, 2)) for m in marks if a <= m["t"] <= b]
    offset += b - a
(dst / "marks.json").write_text(json.dumps(out_marks), "utf8")
print(dst.name, n, "frames", round(n / FPS, 2), "s", out_marks)
