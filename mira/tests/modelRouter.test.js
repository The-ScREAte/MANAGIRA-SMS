const test = require("node:test");
const assert = require("node:assert/strict");

// No OPENAI_API_KEY/ANTHROPIC_API_KEY is set in the test environment, so
// modelRouter's MOCK_MODE is true automatically - these tests exercise the
// real mock-decision logic (deterministic tool selection), the same code
// path that was verified end-to-end against live org-63 data manually
// during development.
const { streamCompletion, MOCK_MODE } = require("../services/modelRouter");

test("mock mode is enabled when no provider key is configured", () => {
  assert.equal(MOCK_MODE, true);
});

test("mock mode selects find_student for a student-lookup message", async () => {
  let toolCall = null;
  await streamCompletion({
    messages: [{ role: "user", content: "find student named jane" }],
    tools: [{ name: "find_student", description: "x", parameters: {} }],
    onToken: () => {},
    onToolCall: (name, args) => {
      toolCall = { name, args };
    },
  });
  assert.equal(toolCall.name, "find_student");
  assert.ok(toolCall.args.query.length > 0);
});

test("mock mode does not select a tool that isn't offered", async () => {
  let toolCall = null;
  let tokens = "";
  await streamCompletion({
    messages: [{ role: "user", content: "find student named jane" }],
    tools: [], // no tools offered this turn
    onToken: (t) => {
      tokens += t;
    },
    onToolCall: (name, args) => {
      toolCall = { name, args };
    },
  });
  assert.equal(toolCall, null);
  assert.ok(tokens.length > 0);
});

test("mock mode falls back to a canned text reply for non-tool messages", async () => {
  let tokens = "";
  let toolCall = null;
  await streamCompletion({
    messages: [{ role: "user", content: "hello there" }],
    tools: [{ name: "find_student", description: "x", parameters: {} }],
    onToken: (t) => {
      tokens += t;
    },
    onToolCall: (name) => {
      toolCall = name;
    },
  });
  assert.equal(toolCall, null);
  assert.ok(tokens.length > 0);
});

test("mock completion result reports zero-cost usage (mock provider/model)", async () => {
  const result = await streamCompletion({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    onToken: () => {},
    onToolCall: () => {},
  });
  assert.equal(result.provider, "mock");
  assert.equal(result.model, "mock");
  assert.ok(typeof result.usage.completionTokens === "number");
});
