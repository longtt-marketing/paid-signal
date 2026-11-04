import test from "node:test";
import assert from "node:assert/strict";
import { possibleDuplicates, reconcile } from "../src/ledger.js";

const pay = (id, t, extra = {}) => ({ capture_id: id, payer_email_sha256: "h1", ad: "trial_video", amount: "49.00", currency: "USD", captured_at: t, ...extra });

test("duplicates: a second payment a person confirmed as a separate order is no longer held", () => {
  const two = [pay("A", "2026-11-01T10:00:00Z"), pay("B", "2026-11-01T10:03:00Z")];
  assert.deepEqual(possibleDuplicates(two).map((d) => d.capture_id), ["B"]);
  const confirmed = [two[0], { ...two[1], confirmed_distinct: { at: "2026-11-05T00:00:00Z", reason: "second child" } }];
  assert.deepEqual(possibleDuplicates(confirmed), []);
  const ads = [{ ad: "trial_video", spend_cents: 5000, leads: 2 }];
  const held = reconcile(ads, two).ads.find((a) => a.ad === "trial_video");
  const counted = reconcile(ads, confirmed).ads.find((a) => a.ad === "trial_video");
  assert.equal(held.paid, 1);
  assert.equal(counted.paid, 2);
});
