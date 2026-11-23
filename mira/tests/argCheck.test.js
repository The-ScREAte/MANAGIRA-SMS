// A tool call's details are checked before the tool runs (services/argCheck.js), and details that
// aren't valid JSON are flagged instead of being run as {} (services/modelRouter.js).
const test = require("node:test");
const assert = require("node:assert/strict");

const { checkArgs, refusal, unreadable } = require("../services/argCheck");
const { listToolSchemas } = require("../tools");
const { forModelSchema } = require("../services/orchestrator");
const { strictSchema, runOpenAICompatibleStream } = require("../services/modelRouter");

const SCHEMA = {
  type: "object",
  properties: {
    studentId: { type: "number" },
    days: { type: "integer" },
    status: { type: "string", enum: ["open", "closed"] },
    date: { type: "string", description: "YYYY-MM-DD" },
    from: { type: "string", description: "Reports from this day: YYYY-MM-DD, \"today\" or \"yesterday\"." },
    month: { type: "string", description: "First day: YYYY-MM-DD (or a month as YYYY-MM)." },
    notify: { type: "boolean" },
    names: { type: "array", items: { type: "string" } },
  },
  required: ["studentId"],
};

test("an empty {} never passes for a tool with required details - every tool", () => {
  const withRequired = listToolSchemas().map(forModelSchema).filter((s) => (s.parameters.required || []).length);
  assert.ok(withRequired.length > 50, "expected many tools with required details");
  for (const schema of withRequired) {
    const result = checkArgs({}, schema.parameters);
    assert.equal(result.ok, false, `${schema.name} accepted {}`);
    assert.match(result.problems.join(" "), /is required/);
  }
});

test("details that aren't an object never pass", () => {
  for (const bad of [null, undefined, "studentId=5", [1, 2], 7]) {
    assert.equal(checkArgs(bad, SCHEMA).ok, false);
  }
});

test("required, types, choices and real dates are checked", () => {
  assert.equal(checkArgs({ studentId: 5 }, SCHEMA).ok, true);
  assert.equal(checkArgs({ studentId: "" }, SCHEMA).ok, false, "blank required");
  assert.equal(checkArgs({ studentId: "five" }, SCHEMA).ok, false, "word for a number");
  assert.equal(checkArgs({ studentId: 5, days: 2.5 }, SCHEMA).ok, false, "fraction for a whole number");
  assert.equal(checkArgs({ studentId: 5, status: "pending" }, SCHEMA).ok, false, "not a listed choice");
  assert.equal(checkArgs({ studentId: 5, notify: "maybe" }, SCHEMA).ok, false);
  assert.equal(checkArgs({ studentId: 5, names: "Ama" }, SCHEMA).ok, false, "text for a list");
  assert.equal(checkArgs({ studentId: 5, names: ["Ama", 3] }, SCHEMA).ok, false, "wrong item in a list");
  assert.equal(checkArgs({ studentId: 5, date: "2026-02-30" }, SCHEMA).ok, false, "impossible date");
  assert.equal(checkArgs({ studentId: 5, date: "next Tuesday" }, SCHEMA).ok, false, "not a date");
  assert.equal(checkArgs({ studentId: 5, date: "2026-11-22" }, SCHEMA).ok, true);
  assert.equal(checkArgs({ studentId: 5, date: "2026-11-22T09:30:00Z" }, SCHEMA).ok, true);
  assert.equal(checkArgs({ studentId: 5, from: "today" }, SCHEMA).ok, true, "a word the description allows");
  assert.equal(checkArgs({ studentId: 5, month: "2026-11" }, SCHEMA).ok, true, "a month where allowed");
  assert.equal(checkArgs({ studentId: 5, date: "2026-11" }, SCHEMA).ok, false, "a month where not allowed");
});

test("plain spellings are read as what they are, and optional blanks are left out", () => {
  const result = checkArgs({ studentId: "5", days: "30", notify: "true", status: "" }, SCHEMA);
  assert.equal(result.ok, true);
  assert.deepEqual(result.args, { studentId: 5, days: 30, notify: true, status: "" });
});

test("the model is told what's wrong and that nothing happened", () => {
  assert.match(refusal("get_fees", ["studentId is required"]), /Not run.*studentId is required.*Nothing was looked up or changed/);
  assert.match(unreadable("get_fees"), /weren't readable.*Nothing was looked up or changed/);
});

// A fake OpenAI-compatible client streaming one call with broken JSON and one with good JSON.
function fakeClient(chunks) {
  return { chat: { completions: { create: async () => (async function* () { for (const c of chunks) yield c; })() } } };
}

test("broken JSON from the model is flagged, never handed on as {}", async () => {
  const calls = [];
  const client = fakeClient([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "get_fees", arguments: "{\"studentId\": 5" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: "b", function: { name: "get_term", arguments: "{}" } }] } }] },
  ]);
  const out = await runOpenAICompatibleStream(client, { model: "openai/gpt-4o-mini", messages: [], tools: [], onToken: () => {}, onToolCall: (name, args, id, flags) => calls.push({ name, args, id, flags }) });
  assert.equal(out.finishReason, "tool_call");
  assert.deepEqual(calls[0].flags, { unreadable: true });
  assert.equal(calls[1].flags, undefined);
  assert.deepEqual(calls[1].args, {});
});

test("strict schemas: every object closed, free-form objects left non-strict", () => {
  const strict = strictSchema({ type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } } } });
  assert.equal(strict.additionalProperties, false);
  assert.equal(strict.properties.a.additionalProperties, false);
  assert.equal(strictSchema({ type: "object", properties: { filters: { type: "object" } } }), null);
  assert.equal(strictSchema({ type: "object", properties: { n: { type: "number", minimum: 1 } } }), null);
});

// ── A refused call is never recorded as made (orchestrator.js screenToolCall) ──
const { screenToolCall, MAX_TOOL_CALLS_PER_TURN } = require("../services/orchestrator");
const FEES = { type: "object", properties: { studentId: { type: "number" } }, required: ["studentId"] };

test("a retried bad call gets the real reason again, not 'you already called it'", () => {
  const made = new Set();
  const first = screenToolCall({ name: "get_fees", args: {} }, made, FEES);
  const retry = screenToolCall({ name: "get_fees", args: {} }, made, FEES);
  assert.match(first.refuse, /Not run.*studentId is required/);
  assert.match(retry.refuse, /Not run.*studentId is required/);
  assert.equal(made.size, 0, "a refused call isn't recorded");
  const unreadableTwice = [1, 2].map(() => screenToolCall({ name: "get_fees", args: {}, unreadable: true }, made, FEES));
  unreadableTwice.forEach((r) => assert.match(r.refuse, /weren't readable/));
  assert.equal(made.size, 0);
  assert.deepEqual(screenToolCall({ name: "get_fees", args: { studentId: "5" } }, made, FEES), { args: { studentId: 5 } });
  assert.match(screenToolCall({ name: "get_fees", args: { studentId: 5 } }, made, FEES).refuse, /already called/, "a real repeat is still caught");
});

test("refused calls don't count toward the per-message ceiling", () => {
  const made = new Set();
  for (let i = 0; i < 30; i++) screenToolCall({ name: "get_fees", args: {} }, made, FEES);
  for (let i = 1; i <= MAX_TOOL_CALLS_PER_TURN; i++) {
    assert.deepEqual(screenToolCall({ name: "get_fees", args: { studentId: i } }, made, FEES), { args: { studentId: i } }, `call ${i} should run`);
  }
  assert.match(screenToolCall({ name: "get_fees", args: { studentId: 999 } }, made, FEES).refuse, /enough lookups/);
});

// ── The direct Anthropic path (modelRouter.js readAnthropicStream), through the real SDK stream ──
const { MessageStream } = require("@anthropic-ai/sdk/lib/MessageStream");
const { readAnthropicStream } = require("../services/modelRouter");

function sdkStream(events) {
  const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  return MessageStream.fromReadableStream(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }));
}
function reply({ tools, stopReason = "tool_use" }) {
  const events = [{ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }];
  tools.forEach(([name, json], index) => {
    events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: `t${index}`, name, input: {} } });
    events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json } });
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } }, { type: "message_stop" });
  return sdkStream(events);
}
async function callsFrom(stream) {
  const calls = [];
  const out = await readAnthropicStream(stream, { onToken: () => {}, onToolCall: (name, args, id, flags) => calls.push({ name, args, id, flags }) });
  return { out, calls };
}

test("Anthropic: good details pass, cut-off JSON is flagged instead of becoming {}", async () => {
  const { out, calls } = await callsFrom(reply({ tools: [["get_term", "{}"], ["get_fees", "{\"studentId\": 5}"], ["get_attendance", "{\"studentId\": 7"]] }));
  assert.equal(out.finishReason, "tool_call");
  assert.deepEqual(calls.map((c) => [c.name, c.args, c.flags]), [
    ["get_term", {}, undefined],
    ["get_fees", { studentId: 5 }, undefined],
    ["get_attendance", {}, { unreadable: true }],
  ]);
});

test("Anthropic: malformed JSON flags the calls instead of failing the provider", async () => {
  const { out, calls } = await callsFrom(reply({ tools: [["get_fees", "{\"studentId\": ]"]] }));
  assert.equal(out.finishReason, "tool_call");
  assert.deepEqual(calls, [{ name: "get_fees", args: {}, id: "t0", flags: { unreadable: true } }]);
});

test("Anthropic: a reply cut off at max_tokens runs none of its calls", async () => {
  const { calls } = await callsFrom(reply({ tools: [["get_fees", "{\"studentId\": 5}"]], stopReason: "max_tokens" }));
  assert.deepEqual(calls[0].flags, { unreadable: true });
});

test("Anthropic: API errors still fail the provider", async () => {
  const { RateLimitError } = require("@anthropic-ai/sdk");
  const stream = { on() {}, finalMessage: async () => { throw new RateLimitError(429, { type: "error" }, "rate limited", new Headers()); } };
  await assert.rejects(readAnthropicStream(stream, { onToken: () => {}, onToolCall: () => {} }), RateLimitError);
});
