import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("judge timestamps are formatted in UTC and carry the UTC label", () => {
  const source = readFileSync(new URL("../public/judge.js", import.meta.url), "utf8");
  assert.match(source, /timeZone:\s*"UTC"/);
  assert.match(source, /\}\s*UTC`/);
  assert.doesNotMatch(source, /dateStyle:\s*"medium",\s*timeStyle:\s*"short"\s*\}\)/);
});

test("judge keeps approval status, labels recorded results, and marks completed steps", () => {
  const js = readFileSync(new URL("../public/judge.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/judge.html", import.meta.url), "utf8");
  assert.match(js, /paypalStatus\?\.replaceWith\(status\(inv\.status\)\)/);
  assert.match(js, /showRecordedPayment\(wrap, approvedRow\)/);
  assert.match(js, /className: "recorded-changes"/);
  assert.match(js, /textContent = i \+ 1 < n \? "✓"/);
  assert.match(html, /Last run: Refused/);
  assert.match(html, /Last run: Refunded/);
});
