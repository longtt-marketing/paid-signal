import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("judge timestamps are formatted in UTC and carry the UTC label", () => {
  const source = readFileSync(new URL("../public/judge.js", import.meta.url), "utf8");
  assert.match(source, /timeZone:\s*"UTC"/);
  assert.match(source, /\}\s*UTC`/);
  assert.doesNotMatch(source, /dateStyle:\s*"medium",\s*timeStyle:\s*"short"\s*\}\)/);
});
