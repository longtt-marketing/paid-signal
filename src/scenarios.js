// Synthetic weeks for the budget agent. The live demo shop has six paid orders spread over four ads, so the honest answer
// there is always "keep and watch". These weeks have enough paid orders for a real decision, and each lists, per ad, the
// changes that are right. They are labelled SYNTHETIC everywhere they appear; none of their payments is a PayPal capture.
// Used by scripts/eval-budget-scenarios.mjs (the agent and a leads-per-dollar rule against the same answers) and by the
// dashboard's "Try a synthetic week" button.

const pay = (prefix) => {
  let n = 0;
  return (ad, amount = "49.00", o = {}) => ({
    capture_id: `SYN${prefix}CAP${String(++n).padStart(3, "0")}X`, order_id: `SYN${prefix}ORD${String(n).padStart(3, "0")}X`, status: "COMPLETED",
    ad, source: "fb", click_id: `IwARsyn${prefix}${n}`, clicked_at: Date.parse("2026-11-02T09:00:00Z") + n * 3600000,
    amount, currency: "USD", captured_at: new Date(Date.parse("2026-11-03T10:00:00Z") + n * 3600000).toISOString(),
    refunded_amount: "0.00", payer_email_sha256: `synpayer${prefix}${n}`, synthetic: true, ...o,
  });
};
const times = (k, f) => Array.from({ length: k }, f);

function week4() {
  const p = pay("W4");
  return {
    id: "week4", name: "Week 4: two ads with enough orders",
    story: "The trial video now has 5 paid orders; the free guide still brings the most leads but only 3 paid orders.",
    ads: [{ ad: "trial_video", spend_cents: 12000, leads: 18 }, { ad: "free_guide", spend_cents: 15000, leads: 40 }, { ad: "parent_carousel", spend_cents: 8000, leads: 12 }, { ad: "holiday_static", spend_cents: 5000, leads: 7 }],
    payments: [...times(5, () => p("trial_video")), ...times(3, () => p("free_guide")), p("parent_carousel")],
    right: { trial_video: ["increase", "keep"], free_guide: ["reduce", "keep"], parent_carousel: ["keep", "fix_tracking"], holiday_static: ["keep", "fix_tracking"] },
    moves: [["trial_video", "increase"], ["free_guide", "reduce"]],
  };
}

function refunds() {
  const p = pay("RF");
  return {
    id: "refunds", name: "Refunds hide behind captures",
    story: "The trial video took 5 payments, but 3 were refunded in full, so it has 2 paid orders; the carousel has 4 on less spend.",
    ads: [{ ad: "trial_video", spend_cents: 10000, leads: 20 }, { ad: "parent_carousel", spend_cents: 9000, leads: 9 }, { ad: "free_guide", spend_cents: 9000, leads: 30 }],
    payments: [...times(3, () => p("trial_video", "49.00", { refunded_amount: "49.00" })), ...times(2, () => p("trial_video")), ...times(4, () => p("parent_carousel")), ...times(3, () => p("free_guide", "35.00"))],
    right: { trial_video: ["keep", "fix_tracking", "reduce"], parent_carousel: ["increase", "keep"], free_guide: ["reduce", "keep"] },
    moves: [["parent_carousel", "increase"]],
  };
}

function duplicate() {
  const p = pay("DU");
  const first = p("holiday_static", "149.00");
  return {
    id: "duplicate", name: "A double payment is not a third order",
    story: "The holiday camp shows 3 captures, but one is the same parent paying twice, minutes apart.",
    ads: [{ ad: "holiday_static", spend_cents: 7000, leads: 6 }, { ad: "trial_video", spend_cents: 9000, leads: 15 }, { ad: "parent_carousel", spend_cents: 9000, leads: 10 }],
    payments: [first, p("holiday_static", "149.00", { payer_email_sha256: first.payer_email_sha256, captured_at: new Date(Date.parse(first.captured_at) + 240000).toISOString() }), p("holiday_static", "149.00"),
      ...times(4, () => p("trial_video")), ...times(3, () => p("parent_carousel"))],
    right: { holiday_static: ["keep", "fix_tracking"], trial_video: ["increase", "keep"], parent_carousel: ["reduce", "keep"] },
    moves: [["trial_video", "increase"]],
  };
}

function leadRich() {
  const p = pay("LR");
  return {
    id: "lead_rich", name: "Most leads, least money",
    story: "The free guide brings 60 leads and 3 small orders; the carousel brings 10 leads and 4 full-price orders.",
    ads: [{ ad: "free_guide", spend_cents: 15000, leads: 60 }, { ad: "parent_carousel", spend_cents: 9000, leads: 10 }, { ad: "trial_video", spend_cents: 6000, leads: 9 }],
    payments: [...times(3, () => p("free_guide", "19.00")), ...times(4, () => p("parent_carousel")), p("trial_video")],
    right: { free_guide: ["reduce", "keep"], parent_carousel: ["increase", "keep"], trial_video: ["keep", "fix_tracking"] },
    moves: [["parent_carousel", "increase"], ["free_guide", "reduce"]],
  };
}

function thin() {
  const p = pay("TH");
  return {
    id: "thin", name: "Too few orders everywhere",
    story: "Four ads, five paid orders between them: no ad has enough evidence for a budget move.",
    ads: [{ ad: "trial_video", spend_cents: 9000, leads: 14 }, { ad: "free_guide", spend_cents: 12000, leads: 35 }, { ad: "parent_carousel", spend_cents: 7000, leads: 9 }, { ad: "holiday_static", spend_cents: 4000, leads: 5 }],
    payments: [...times(2, () => p("trial_video")), p("free_guide"), ...times(2, () => p("parent_carousel"))],
    right: { trial_video: ["keep", "fix_tracking"], free_guide: ["keep", "fix_tracking"], parent_carousel: ["keep", "fix_tracking"], holiday_static: ["keep", "fix_tracking"] },
    moves: [],
  };
}

export const SCENARIOS = [week4(), refunds(), duplicate(), leadRich(), thin()];
export const scenario = (id) => SCENARIOS.find((s) => s.id === id) || null;

/** How a set of proposed actions scores against a scenario's right answers. */
export function grade(s, actions) {
  const wrong = actions.filter((a) => s.right[a.ad] && !s.right[a.ad].includes(a.change)).map((a) => `${a.ad}: ${a.change}`);
  const made = s.moves.filter(([ad, change]) => actions.some((a) => a.ad === ad && a.change === change));
  // right only if nothing contradicts the week's answer and every move it expects was made
  return { ok: wrong.length === 0 && made.length === s.moves.length, wrong, moves_made: made.length, moves_expected: s.moves.length };
}

/** What an ad platform's own optimiser would do: move budget toward the most leads per dollar, away from the fewest. */
export function leadsRule(s) {
  const r = s.ads.map((a) => ({ ad: a.ad, lpd: a.leads / a.spend_cents })).sort((a, b) => b.lpd - a.lpd);
  return [{ ad: r[0].ad, change: "increase" }, { ad: r.at(-1).ad, change: "reduce" }];
}
