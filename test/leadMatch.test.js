import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePayPalCsv, parseAdCsv, reconcile } from "../src/ledger.js";
import { parseMetaLeadCsv, matchPaymentsToLeads } from "../public/lib/leadMatch.js";

const PAYPAL_HEAD = '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Transaction ID","Item Title","Reference Txn ID","Invoice Number","Custom Number"';
const paypalRow = ({ id, amount = "49.00", email = "buyer@example.com", item = "", invoice = "", custom = "", type = "Invoice Payment", ref = "", date = "10/28/2026", time = "10:00:00" }) =>
  [date, time, "UTC", "Buyer", type, "Completed", "USD", amount, "-1.96", "", email, "shop@example.com", id, item, ref, invoice, custom].map((v) => `"${v}"`).join(",");
const paymentCsv = (...rows) => [PAYPAL_HEAD, ...rows].join("\r\n");
const parsePayments = (csv, keys = ["Creative Workshop", "Winter Guide"]) => parsePayPalCsv(csv, keys).payments;

test("Meta exports accept UTF-16 tab format and UTF-8 comma headers case-insensitively", () => {
  const tab = [
    "CREATED_TIME\tAd_ID\tAd_Name\tEMAIL\tfull_name\tcampaign_name\tform_name\tFavorite color",
    "2026-10-27T08:00:00+0000\tAD-1\tCreative Workshop\tJamie@example.com\tJamie Rivera\tFall\tWorkshop\tBlue",
  ].join("\r\n");
  const utf16 = new Uint8Array(2 + tab.length * 2);
  utf16[0] = 0xff; utf16[1] = 0xfe;
  for (let i = 0; i < tab.length; i++) { const code = tab.charCodeAt(i); utf16[2 + i * 2] = code & 255; utf16[3 + i * 2] = code >> 8; }
  const parsedTab = parseMetaLeadCsv(utf16);
  assert.equal(parsedTab.errors.length, 0);
  assert.equal(parsedTab.leads[0].email, "jamie@example.com");
  assert.equal(parsedTab.leads[0].ad_id, "AD-1");

  const comma = parseMetaLeadCsv('created_time,AD_ID,Ad_Name,Email,full_name,campaign_name,form_name\n2026-10-27T08:00:00Z,AD-2,Winter Guide,casey@example.com,Casey,Fall,Guide');
  assert.equal(comma.errors.length, 0);
  assert.equal(comma.leads[0].ad_name, "Winter Guide");
});

test("email matching trims and ignores case, and chooses the latest lead before payment", () => {
  const csv = paymentCsv(paypalRow({ id: "P1", email: "  JAMIE.RIVERA@Example.com  ", date: "10/30/2026" }));
  const payments = parsePayments(csv);
  payments[0].captured_at = "2026-10-30T10:00:00.000Z";
  const leads = [
    { email: "jamie.rivera@example.com", ad_name: "Winter Guide", created_at_ms: Date.parse("2026-10-28T09:00:00Z") },
    { email: " JAMIE.RIVERA@EXAMPLE.COM ", ad_name: "Creative Workshop", created_at_ms: Date.parse("2026-10-29T09:00:00Z") },
    { email: "jamie.rivera@example.com", ad_name: "Future Ad", created_at_ms: Date.parse("2026-10-31T09:00:00Z") },
  ];
  const result = matchPaymentsToLeads({ payments, paypalInput: csv, leads, adKeys: ["Creative Workshop", "Winter Guide"] });
  assert.equal(result.payments[0].ad, "Creative Workshop");
  assert.equal(result.payments[0].match_label, "matched by email");
  assert.equal(result.counts.email, 1);
});

test("ad name in invoice text matches on whole words after email matching", () => {
  const csv = paymentCsv(paypalRow({ id: "P1", email: "none@example.com", invoice: "INV-204: Creative Workshop / October" }));
  const result = matchPaymentsToLeads({ payments: parsePayments(csv), paypalInput: csv, adKeys: ["Creative Workshop", "Winter Guide"] });
  assert.equal(result.payments[0].ad, "Creative Workshop");
  assert.equal(result.payments[0].match_label, "ad name in the invoice");
  const partial = paymentCsv(paypalRow({ id: "P2", email: "none@example.com", invoice: "INV-CreativeWorkshop-204" }));
  const unmatched = matchPaymentsToLeads({ payments: parsePayments(partial), paypalInput: partial, adKeys: ["Creative Workshop"] });
  assert.equal(unmatched.counts.unmatched, 1);
  const itemCsv = paymentCsv(paypalRow({ id: "P3", email: "none@example.com", item: "October seats for winter guide", date: "10/28/2026" }));
  const itemMatch = matchPaymentsToLeads({ payments: parsePayments(itemCsv), paypalInput: itemCsv, adKeys: ["Creative Workshop", "Winter Guide"] });
  assert.equal(itemMatch.payments[0].ad, "Winter Guide");
  assert.equal(itemMatch.payments[0].match_label, "ad name in the invoice");
  const codeCsv = paymentCsv(paypalRow({ id: "P4", email: "none@example.com", invoice: "INV-AD-204-October" }));
  const codeLead = { ad_id: "AD-204", ad_name: "Creative Workshop", email: "someone@example.com", created_at_ms: Date.parse("2026-10-27T09:00:00Z") };
  const codeMatch = matchPaymentsToLeads({ payments: parsePayments(codeCsv), paypalInput: codeCsv, leads: [codeLead], adKeys: ["Creative Workshop", "Winter Guide"] });
  assert.equal(codeMatch.payments[0].ad, "Creative Workshop");
  assert.equal(codeMatch.payments[0].match_label, "ad name in the invoice");
});

test("order tags take priority over email and receive the ad tag label", () => {
  const csv = paymentCsv(paypalRow({ id: "P1", email: "jamie@example.com", custom: "a=Winter Guide;s=fb;c=click;t=0" }));
  const lead = { email: "jamie@example.com", ad_name: "Creative Workshop", created_at_ms: Date.parse("2026-10-27T09:00:00Z") };
  const result = matchPaymentsToLeads({ payments: parsePayments(csv), paypalInput: csv, leads: [lead], adKeys: ["Creative Workshop", "Winter Guide"] });
  assert.equal(result.payments[0].ad, "Winter Guide");
  assert.equal(result.payments[0].match_label, "ad tag in the order");
  assert.equal(result.counts.tag, 1);
});

test("unmatched amount is counted and refunds remain applied to matched payments", () => {
  const csv = paymentCsv(
    paypalRow({ id: "P1", email: "jamie@example.com" }),
    paypalRow({ id: "R1", amount: "-9.00", email: "", type: "Payment Refund", ref: "P1" }),
    paypalRow({ id: "P2", amount: "25.00", email: "unknown@example.com", invoice: "INV-OTHER" }),
  );
  const payments = parsePayments(csv);
  const lead = { email: "jamie@example.com", ad_name: "Creative Workshop", created_at_ms: Date.parse("2026-10-27T09:00:00Z") };
  const result = matchPaymentsToLeads({ payments, paypalInput: csv, leads: [lead], adKeys: ["Creative Workshop"] });
  assert.equal(result.payments[0].refunded_amount, "9.00");
  assert.equal(result.counts.unmatched, 1);
  assert.equal(result.counts.unmatched_net_cents, 2500);
  const rec = reconcile(parseAdCsv("ad,spend,leads\nCreative Workshop,100,5").rows, result.payments);
  assert.equal(rec.totals.revenue_cents, 4000);
  assert.equal(rec.totals.refunded, 0); // Partial refund reduces the payment's kept revenue, not the order count.
});

test("the invoice shop sample matches two of three payments, shows an unmatched payment, and keeps its refund", () => {
  const root = new URL("../public/data/sample/", import.meta.url);
  const adsCsv = readFileSync(new URL("ads.csv", root), "utf8");
  const paypalCsv = readFileSync(new URL("paypal-activity.csv", root), "utf8");
  const leadsBytes = readFileSync(new URL("meta-leads.csv", root));
  const adRows = parseAdCsv(adsCsv).rows;
  const parsed = parseMetaLeadCsv(leadsBytes);
  assert.deepEqual(parsed.errors, []);
  const payments = parsePayPalCsv(paypalCsv, adRows.map((row) => row.ad)).payments;
  const matched = matchPaymentsToLeads({ payments, paypalInput: paypalCsv, leads: parsed.leads, adKeys: adRows.map((row) => row.ad) });
  assert.deepEqual(matched.counts, { matched: 2, email: 1, tag: 0, invoice: 1, unmatched: 1, unmatched_net_cents: 2500 });
  assert.equal(matched.payments[0].refunded_amount, "9.00");
  const rec = reconcile(adRows, matched.payments);
  assert.equal(rec.totals.revenue_cents, 9900);
  assert.equal(rec.totals.paid, 2);
});
