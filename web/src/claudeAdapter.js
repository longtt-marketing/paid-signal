// AG Studio AgLlmAdapter for Claude. Studio's agent loop runs in the browser; each turn goes to the Worker's
// /api/ai/turn proxy (which holds the Anthropic key) and comes back as AG-UI events plus a final AgLlmResponse.
// Translation: Studio items (OpenAI-Responses-like) <-> Anthropic Messages content blocks.

const text = (c) => (c || []).map((p) => p.text || p.refusal || "").join("");

/** Studio conversation items -> Anthropic messages, merging consecutive turns of the same role. */
export function toMessages(items) {
  const out = [];
  const push = (role, block) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block); else out.push({ role, content: [block] });
  };
  for (const it of items) {
    if (it.type === "message" && it.kind === "input") { const t = text(it.content); if (t) push("user", { type: "text", text: t }); }
    else if (it.type === "message" && it.kind === "output") { const t = text(it.content); if (t) push("assistant", { type: "text", text: t }); }
    else if (it.type === "function_call") {
      let input = {}; try { input = it.arguments ? JSON.parse(it.arguments) : {}; } catch { input = { raw: it.arguments }; }
      push("assistant", { type: "tool_use", id: it.callId, name: it.name, input });
    } else if (it.type === "function_call_output") push("user", { type: "tool_result", tool_use_id: it.callId, content: String(it.output ?? "") });
    // reasoning items are not replayed
  }
  if (out[0]?.role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "Continue." }] });
  return out;
}

// Replay: a recorded run is played back turn by turn through Studio's own agent loop, so Studio really executes the
// recorded tool calls (the page agent adds the chart) while no model is called. Turns are keyed by the agent (a hash of
// its instructions) and taken in order. Recording fills window.__psRecordTurns the same way (scripts/record-studio-chats.py).
import REPLAY_BUDGET from "./replay-budget.json";
import REPLAY_PAGE from "./replay-page.json";
// each recorded run is started by its own prompt; a run with no recorded turns offers no starter
const RUNS = [{ prompt: "Replay the recorded budget run", turns: REPLAY_BUDGET.turns || {} }, { prompt: "Replay the recorded page build", turns: REPLAY_PAGE.turns || {} }];
export const REPLAY_PROMPT = RUNS[0].prompt, PAGE_REPLAY_PROMPT = RUNS[1].prompt;
export const HAS_REPLAY = Object.keys(RUNS[0].turns).length > 0, HAS_PAGE_REPLAY = Object.keys(RUNS[1].turns).length > 0;
let REPLAY = { turns: {} }, RUN_PROMPT = "";
const hash = (s) => { let h = 5381; for (const ch of String(s)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const firstUser = (items) => text((items || []).find((it) => it.type === "message" && it.kind === "input")?.content);
let used = {}, replaying = false;

const toolChoice = (c) => (!c || c === "auto" ? undefined : c === "none" ? { type: "none" } : c === "required" ? { type: "any" } : { type: "tool", name: c.name });

export function claudeAdapter({ endpoint = "/api/ai/turn", model = "claude-sonnet-5-5" } = {}) {
  return {
    executeTurn(request, options) {
      let resolve, reject;
      const complete = new Promise((res, rej) => { resolve = res; reject = rej; });
      void complete.catch(() => {});
      const events = [];
      async function run() {
        let system = request.instructions || "";
        if (request.responseFormat?.type === "json_schema" || request.responseFormat?.schema) {
          system += `\n\nRespond with JSON only, matching this schema:\n${JSON.stringify(request.responseFormat.schema || request.responseFormat)}`;
        }
        const body = {
          model: request.model?.id || model, max_tokens: 6000, system,
          messages: toMessages(request.input || []),
          tools: (request.tools || []).filter((t) => t.kind !== "provided").map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters || { type: "object", properties: {} } })),
          tool_choice: toolChoice(request.toolChoice),
        };
        // the agent, by the opening of its instructions (the rest carries live page state that differs between runs)
        const key = hash(String(request.instructions || "").slice(0, 160));
        const items = request.input || [];
        const run0 = RUNS.find((r) => firstUser(items).startsWith(r.prompt));
        if (run0 && !items.some((it) => it.kind === "output")) { used = {}; replaying = true; REPLAY = run0; RUN_PROMPT = run0.prompt; }
        let data;
        if (replaying && REPLAY.turns?.[key] && (used[key] || 0) < REPLAY.turns[key].length) {
          // the recorded reply for this agent's next turn; a short pause so the run reads at a human pace
          const n = used[key] = (used[key] || 0) + 1, list = REPLAY.turns[key];
          data = list[n - 1];
          await new Promise((r) => setTimeout(r, 700));
          // the lead's last recorded turn (no tool call) ends the replay
          if (firstUser(items).startsWith(RUN_PROMPT) && !(data.content || []).some((b) => b.type === "tool_use")) replaying = false;
        } else {
          const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: options?.signal });
          data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error?.message || data.error || `Claude proxy HTTP ${res.status}`);
          if (typeof window !== "undefined" && window.__psRecordTurns) (window.__psRecordTurns[key] ||= []).push(data);
        }
        const output = [];
        for (const [i, b] of (data.content || []).entries()) {
          if (b.type === "text" && b.text) {
            const id = `${data.id}-t${i}`;
            events.push({ type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" }, { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: b.text }, { type: "TEXT_MESSAGE_END", messageId: id });
            output.push({ id, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: b.text, annotations: [] }] });
          } else if (b.type === "tool_use") {
            const args = JSON.stringify(b.input ?? {});
            events.push({ type: "TOOL_CALL_START", toolCallId: b.id, toolCallName: b.name }, { type: "TOOL_CALL_ARGS", toolCallId: b.id, delta: args }, { type: "TOOL_CALL_END", toolCallId: b.id });
            output.push({ id: b.id, kind: "output", type: "function_call", callId: b.id, name: b.name, arguments: args, status: "completed" });
          }
        }
        return {
          id: data.id, createdAt: Date.now(), model: data.model, output, status: data.stop_reason === "max_tokens" ? "incomplete" : "completed",
          ...(data.stop_reason === "max_tokens" ? { incompleteDetails: { reason: "max_output_tokens" } } : {}),
          usage: data.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens, totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0), cachedInputTokens: data.usage.cache_read_input_tokens } : undefined,
        };
      }
      async function* stream() {
        let response;
        try { response = await run(); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return; }
        for (const e of events) yield e;
        resolve(response);
      }
      const it = stream();
      return { stream: { [Symbol.asyncIterator]: () => it }, complete };
    },
  };
}
