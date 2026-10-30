import test from "node:test";
import assert from "node:assert/strict";
import { cleanTurns } from "../src/worker.js";

test("Claude proxy: empty text blocks are dropped and a trailing assistant text is trimmed", () => {
  const out = cleanTurns([
    { role: "user", content: "Review budgets" },
    { role: "assistant", content: [{ type: "text", text: "" }, { type: "tool_use", id: "t1", name: "read_paid_signal", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
    { role: "assistant", content: [{ type: "text", text: "Done.  \n" }] },
  ]);
  assert.deepEqual(out[1].content.map((c) => c.type), ["tool_use"]);
  assert.equal(out[3].content[0].text, "Done.");
  assert.equal(cleanTurns([{ role: "user", content: "  " }])[0].content, "(no text)");
});
