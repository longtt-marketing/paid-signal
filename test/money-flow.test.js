// The money-flow widget stacks each ad's share down both sides: heights follow the shares, fill the side exactly,
// and a tiny share still gets a visible band.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stack } from "../web/src/flowLayout.js";

const ads = [{ name: "Free guide", sa: 31 / 62, sb: 49 / 432 }, { name: "Trial", sa: 14 / 62, sb: 147 / 432 }, { name: "Testimonial", sa: 11 / 62, sb: 196 / 432 }, { name: "Holiday", sa: 6 / 62, sb: 40 / 432 }];

test("bands fill the side, in order, with the gaps between them", () => {
  const H = 300, gap = 8, out = stack(ads, "sa", H, gap, 3);
  const last = out.Holiday;
  assert.ok(Math.abs(last.y + last.h - H) < 1e-9);
  assert.equal(out["Free guide"].y, 0);
  assert.ok(Math.abs(out.Trial.y - (out["Free guide"].h + gap)) < 1e-9);
});

test("heights follow the shares", () => {
  const out = stack(ads, "sb", 400, 0, 0);
  assert.ok(Math.abs(out.Testimonial.h / out["Free guide"].h - 196 / 49) < 1e-9);
});

test("a tiny share keeps a minimum band", () => {
  const out = stack([{ name: "big", s: 0.999 }, { name: "tiny", s: 0.001 }], "s", 200, 4, 3);
  assert.ok(out.tiny.h >= 2.9);
});
