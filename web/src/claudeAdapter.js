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
        const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: options?.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error?.message || data.error || `Claude proxy HTTP ${res.status}`);
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
