import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePayPalCsv, parseAdCsv, reconcile, supportedMoves } from "../src/ledger.js";

// the columns of PayPal's own activity download (Activity > Download > All transactions, CSV)
const HEAD = '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Transaction ID","Item Title","Reference Txn ID","Invoice Number","Custom Number"';
const row = (o) => [o.date || "10/28/2026", o.time || "10:00:00", "PST", o.name || "Buyer", o.type || "Express Checkout Payment", o.status || "Completed", o.cur || "USD",
  o.gross, o.fee || "-1.95", "", o.email || "a@example.com", "shop@example.com", o.id, o.item || "", o.ref || "", o.inv || "", o.custom || ""].map((v) => `"${v}"`).join(",");

test("PayPal activity CSV: payments, refunds against their payment, and the ad from the order's custom_id", () => {
  const csv = [HEAD,
    row({ id: "P1", gross: "49.00", custom: "a=trial_video;s=fb;c=IwAR1;t=0", email: "x@example.com" }),
    row({ id: "P2", gross: "1,049.00", custom: "utm_content=free_guide" }),
    row({ id: "P3", gross: "49.00", item: "Trial class · video", email: "y@example.com" }),
    row({ id: "P4", gross: "49.00", custom: "spring-sale" }),
    row({ id: "R1", type: "Payment Refund", gross: "-9.00", ref: "P1" }),
    row({ id: "R2", type: "Payment Refund", gross: "-1,049.00", ref: "P2" }),
    row({ id: "W1", type: "General Withdrawal", gross: "-100.00" }),
    row({ id: "P5", gross: "49.00", status: "Pending" }),
    row({ id: "P6", gross: "49.00", cur: "EUR" }),
  ].join("\r\n");
  const { payments, summary, errors } = parsePayPalCsv(csv, ["trial_video", "free_guide", "Trial class · video"]);
  assert.deepEqual(payments.map((p) => [p.capture_id, p.ad, p.status, p.refunded_amount]), [
    ["P1", "trial_video", "PARTIALLY_REFUNDED", "9.00"], ["P2", "free_guide", "REFUNDED", "1049.00"], ["P3", "Trial class · video", "COMPLETED", "0.00"], ["P4", "", "COMPLETED", "0.00"]]);
  assert.equal(payments[0].attributed_by, "custom_id");
  assert.equal(payments[1].attributed_by, "utm_content");
  assert.equal(payments[2].attributed_by, "exact ad name");
  assert.equal(payments[0].fee, "1.95");
  assert.equal(summary.tagged, 3); assert.equal(summary.matched_to_export, 3); assert.equal(summary.untagged_net_cents, 4900);
  assert.match(errors.join(" "), /EUR/);
});

test("PayPal activity CSV: an ad tag not in the export is reported, never guessed onto another ad", () => {
  const { payments, summary } = parsePayPalCsv([HEAD, row({ id: "P1", gross: "20.00", custom: "a=old_ad;s=fb;c=x;t=0" })].join("\n"), ["trial_video"]);
  assert.equal(payments[0].ad, "old_ad");
  assert.deepEqual(summary.tags_not_in_export, ["old_ad"]);
  const rec = reconcile(parseAdCsv("ad,spend,leads\ntrial_video,10,3").rows, payments);
  assert.deepEqual(rec.unmatched_captures, ["P1"]);
});

test("PayPal activity CSV: a file that is not an activity download is refused with a reason", () => {
  assert.match(parsePayPalCsv("a,b\n1,2").errors[0], /Type, Gross and Transaction ID/);
  assert.match(parsePayPalCsv("").errors[0], /empty/);
});

test("audit: the same budget rule as the gate runs on a merchant's own two files", () => {
  const csv = [HEAD, ...[1, 2, 3].map((i) => row({ id: `C${i}`, gross: "49.00", custom: "a=carousel;s=fb;c=c;t=0", email: `b${i}@example.com` })), row({ id: "G1", gross: "49.00", custom: "a=guide;s=fb;c=c;t=0" })].join("\n");
  const ads = parseAdCsv("Ad name,Amount spent (USD),Results\ncarousel,71.90,9\nguide,118.40,31").rows;
  const rec = reconcile(ads, parsePayPalCsv(csv, ads.map((a) => a.ad)).payments);
  const moves = supportedMoves(rec);
  assert.equal(moves.carousel.increase, true);
  assert.equal(moves.guide, undefined); // one paid order: no move either way
});

test("the browser copy of the ledger is the same file the Worker runs", () => {
  assert.equal(readFileSync(new URL("../public/lib/ledger.js", import.meta.url), "utf8"), readFileSync(new URL("../src/ledger.js", import.meta.url), "utf8"));
});
