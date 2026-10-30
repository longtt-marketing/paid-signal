// Every tool call an agent makes is checked against the JSON Schema that tool declares, in code, before it runs.
// A small validator with no dependencies: the subset of JSON Schema the tool definitions use (object, array, string,
// integer, number, boolean, enum, required, minimum/maximum, minItems/maxItems, maxLength, additionalProperties: false).

/**
 * @param {any} value
 * @param {any} schema
 * @param {string} [path]
 * @returns {string[]} problems; empty when the value fits the schema
 */
export function validate(value, schema, path = "input") {
  if (!schema || typeof schema !== "object") return [];
  const out = [];
  const t = schema.type;
  if (schema.enum && !schema.enum.includes(value)) return [`${path} must be one of ${schema.enum.join(", ")}.`];
  if (t === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object.`];
    for (const k of schema.required || []) if (value[k] === undefined) out.push(`${path}.${k} is required.`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) out.push(...validate(v, props[k], `${path}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${path}.${k} is not allowed.`);
    }
  } else if (t === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array.`];
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${path} needs at least ${schema.minItems} item(s).`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${path} allows at most ${schema.maxItems} item(s).`);
    value.forEach((v, i) => out.push(...validate(v, schema.items, `${path}[${i}]`)));
  } else if (t === "string") {
    if (typeof value !== "string") return [`${path} must be a string.`];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${path} must be ${schema.maxLength} characters or fewer.`);
  } else if (t === "integer" || t === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (t === "integer" && !Number.isInteger(value))) return [`${path} must be ${t === "integer" ? "an integer" : "a number"}.`];
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path} must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path} must be at most ${schema.maximum}.`);
  } else if (t === "boolean") {
    if (typeof value !== "boolean") return [`${path} must be true or false.`];
  }
  return out;
}

/** The problems with a tool call, given the agent's declared tools: unknown tool, or input that breaks its schema. */
export function checkCall(tools, call) {
  const tool = tools.find((x) => x.name === call.name);
  if (!tool) return [`Unknown tool ${call.name}.`];
  return validate(call.input ?? {}, tool.input_schema);
}
