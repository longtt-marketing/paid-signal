// October weeks as labels that sort in order: "W1 · 1-7 Oct" ... "W5 · 29-31 Oct"; a late payment in November goes on to
// "W6 · 1-7 Nov", so it is never filed under an October week
export const weekOf = (d) => {
  const day = Number(d.slice(8, 10)) || 1, nov = d.slice(5, 7) === "11";
  const w = nov ? 5 + Math.ceil(day / 7) : Math.min(5, Math.ceil(day / 7)), k = nov ? w - 5 : w, a = (k - 1) * 7 + 1, b = Math.min(nov ? 30 : 31, k * 7);
  return `W${w} · ${a}-${b} ${nov ? "Nov" : "Oct"}`;
};
