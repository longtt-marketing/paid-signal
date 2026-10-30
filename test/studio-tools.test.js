// The Claude proxy serves only AG Studio's own tools and Paid Signal's. Every tool name the installed AG Studio can send
// must be on that list, or a Studio agent fails mid-run (complete_task was missed once and broke the budget agent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const allowed = new Set(worker.match(/const STUDIO_TOOLS = new Set\(\[([\s\S]*?)\]\)/)[1].match(/"([a-z_]+)"/g).map((s) => s.slice(1, -1)));

const studioDist = new URL("../web/node_modules/ag-studio/dist/package/main.esm.mjs", import.meta.url);

test("every AG Studio tool name is allowed through the Claude proxy", { skip: !existsSync(studioDist) && "install web/ first (npm ci --prefix web)" }, () => {
  const dist = readFileSync(studioDist, "utf8");
  const studio = new Set([...dist.matchAll(/name:\s*"([a-z]+(?:_[a-z]+)+)"/g)].map((m) => m[1]));
  for (const n of ["delegate_to", "complete_task"]) studio.add(n);
  const missing = [...studio].filter((n) => !allowed.has(n));
  assert.deepEqual(missing, []);
});

test("every Paid Signal Studio tool is allowed", () => {
  const tools = readFileSync(new URL("../web/src/agentTools.js", import.meta.url), "utf8");
  const ours = [...tools.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(ours.length >= 5);
  assert.deepEqual(ours.filter((n) => !allowed.has(n)), []);
});
