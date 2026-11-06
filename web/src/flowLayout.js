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

// the first sentence of an agent's reason, for a one-line verdict ("$2.73" and "Testimonial · carousel" stay whole)
export function firstSentence(text, max = 170) {
  const t = String(text || "").trim();
  const m = t.match(/^.*?[.!?](?=\s+[A-Z]|$)/);
  const s = m ? m[0] : t;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:]$/, "").trimEnd()}…`;
}
