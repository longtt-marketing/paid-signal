// Layout for the money-flow widget, kept apart from the JSX so node tests can check it.
// stack shares down one side: each item gets y and h in pixels, with a gap between items and a minimum height
export function stack(items, key, height, gap, minH) {
  const n = items.length, free = Math.max(0, height - gap * (n - 1));
  const raw = items.map((it) => Math.max(minH, it[key] * free));
  const scale = free / (raw.reduce((s, h) => s + h, 0) || 1);
  let y = 0;
  const out = {};
  items.forEach((it, i) => { const h = raw[i] * scale; out[it.name] = { y, h }; y += h + gap; });
  return out;
}
