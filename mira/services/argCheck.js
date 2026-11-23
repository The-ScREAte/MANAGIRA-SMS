// A tool's details are checked against its own schema before it runs or is previewed (enforced in
// code, never left to the model): the details must be an object, every required field must be
// there, each value must be the type the schema says, one of its listed choices, and a date field
// ("YYYY-MM-DD" in its description) must be a real calendar date. A call that fails is never run;
// the model gets back exactly what's wrong and calls again or asks the person.
//
// A number or true/false sent as text ("2", "true") is read as what it plainly is: that's the
// model's spelling, not a wrong detail. Fields the schema doesn't list are left alone (some tools
// read details their schema leaves loose).

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MONTH = /^(\d{4})-(\d{2})$/;

function realDate(year, month, day) {
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return d.getUTCFullYear() === Number(year) && d.getUTCMonth() === Number(month) - 1 && d.getUTCDate() === Number(day);
}

// A field described with YYYY-MM-DD takes a real date, a month when the description allows
// YYYY-MM, or one of the words it quotes ("today", "yesterday").
function dateProblem(value, description) {
  const text = String(value).trim();
  const date = text.match(DATE);
  if (date) return realDate(date[1], date[2], date[3]) ? null : `"${text}" isn't a real date`;
  const month = text.match(MONTH);
  if (month && /YYYY-MM(?!-)/.test(description) && Number(month[2]) >= 1 && Number(month[2]) <= 12) return null;
  const words = (description.match(/"([a-z ]+)"/gi) || []).map((w) => w.replace(/"/g, "").toLowerCase());
  if (words.includes(text.toLowerCase())) return null;
  return `"${text}" isn't a date as YYYY-MM-DD`;
}

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

// Returns [problems, value]: value is the detail as it will be used (a "2" read as 2).
function checkValue(value, schema, path) {
  if (!schema || typeof schema !== "object") return [[], value];
  const type = schema.type;
  let v = value;
  if ((type === "number" || type === "integer") && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) v = Number(v.trim());
  if (type === "boolean" && typeof v === "string" && /^(true|false)$/i.test(v.trim())) v = v.trim().toLowerCase() === "true";

  const problems = [];
  const actual = typeOf(v);
  if (type === "integer" && !(actual === "number" && Number.isInteger(v))) problems.push(`${path} must be a whole number`);
  else if (type === "number" && !(actual === "number" && Number.isFinite(v))) problems.push(`${path} must be a number`);
  else if (["string", "boolean", "array", "object"].includes(type) && actual !== type) problems.push(`${path} must be ${type === "array" ? "a list" : type === "object" ? "a set of details" : `a ${type}`}`);
  if (problems.length) return [problems, v];

  if (Array.isArray(schema.enum) && !schema.enum.includes(v)) {
    problems.push(`${path} must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (type === "string" && v.trim() && /YYYY-MM-DD/.test(String(schema.description || ""))) {
    const bad = dateProblem(v, String(schema.description || ""));
    if (bad) problems.push(`${path}: ${bad}`);
  }
  if (type === "object" && schema.properties) {
    const [inner, fixed] = checkObject(v, schema, path);
    problems.push(...inner);
    v = fixed;
  }
  if (type === "array" && schema.items) {
    v = v.map((item, i) => {
      const [inner, fixed] = checkValue(item, schema.items, `${path}[${i}]`);
      problems.push(...inner);
      return fixed;
    });
  }
  return [problems, v];
}

const MISSING = (value) => value === undefined || value === null || (typeof value === "string" && !value.trim());

function checkObject(obj, schema, path) {
  const problems = [];
  const out = { ...obj };
  const props = schema.properties || {};
  (schema.required || []).forEach((key) => {
    if (MISSING(out[key])) problems.push(`${path ? `${path}.` : ""}${key} is required`);
  });
  for (const [key, sub] of Object.entries(props)) {
    // An optional field left empty is just left out.
    if (MISSING(out[key])) continue;
    const [inner, fixed] = checkValue(out[key], sub, path ? `${path}.${key}` : key);
    problems.push(...inner);
    out[key] = fixed;
  }
  return [problems, out];
}

/**
 * checkArgs(args, parameters) -> { ok, problems, args }
 * `parameters` is the tool's JSON schema as the model was shown it. `args` comes back with plain
 * spellings read ("2" -> 2); use it in place of what the model sent.
 */
function checkArgs(args, parameters) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, problems: ["the details must be a set of named fields"], args: {} };
  }
  if (!parameters || parameters.type !== "object") return { ok: true, problems: [], args };
  const [problems, fixed] = checkObject(args, parameters, "");
  return { ok: problems.length === 0, problems, args: fixed };
}

// What the model is told when a call isn't run.
function refusal(name, problems) {
  return `Not run: the details for ${name} don't fit what it needs (${problems.join("; ")}). Nothing was looked up or changed. Call ${name} again with the corrected details, taking each one from the person's words or a tool result. If a detail isn't known, ask the person for it; never guess it.`;
}

// What the model is told when its call's details weren't readable at all (broken JSON).
function unreadable(name) {
  return `Not run: the details you sent for ${name} weren't readable (not valid JSON). Nothing was looked up or changed. Call ${name} again with its details as valid JSON.`;
}

module.exports = { checkArgs, refusal, unreadable, dateProblem };
