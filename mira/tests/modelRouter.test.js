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

// ── The models Mira runs on (2026-11-22) ──
const { TASK_MODEL_MAPS, takesTemperature, effortFor, maxTokensFor, PROVIDER_PRIORITY } = require("../services/modelRouter");
const { estimateCost } = require("../services/usageLedger");

test("every chat turn runs on Claude through OpenRouter, never gpt-4o-mini; Telnyx unchanged", () => {
  const map = TASK_MODEL_MAPS.openrouter;
  assert.equal(map.default, "anthropic/claude-haiku-5.5");
  assert.equal(map.lookup, "anthropic/claude-haiku-5.5");
  assert.equal(map.draft, "anthropic/claude-sonnet-5.5");
  assert.equal(map.reasoning, "anthropic/claude-sonnet-5.5");
  assert.ok(!Object.values(map).includes("openai/gpt-4o-mini"));
  assert.ok(Object.values(TASK_MODEL_MAPS.telnyx).every((m) => m === "moonshotai/Kimi-K2.5"));
  assert.deepEqual(PROVIDER_PRIORITY, ["openrouter", "telnyx", "openai", "anthropic"]);
});

test("temperature only where the model takes it; effort and room for thinking on Claude 5", () => {
  assert.equal(takesTemperature("anthropic/claude-haiku-5.5"), false);
  assert.equal(takesTemperature("claude-sonnet-5-5"), false);
  assert.equal(takesTemperature("openai/gpt-4o-mini"), true);
  assert.equal(takesTemperature("moonshotai/Kimi-K2.5"), true);
  assert.equal(effortFor("anthropic/claude-haiku-5.5", "default"), "low");
  assert.equal(effortFor("anthropic/claude-sonnet-5.5", "reasoning"), "medium");
  assert.equal(effortFor("openai/gpt-4o-mini", "default"), null);
  assert.equal(maxTokensFor("claude-haiku-5-5"), 4096);
  assert.equal(maxTokensFor("moonshotai/Kimi-K2.5"), 2048);
});

test("every model Mira can run on has a price", () => {
  for (const map of [TASK_MODEL_MAPS.openrouter, TASK_MODEL_MAPS.anthropic]) {
    for (const model of new Set(Object.values(map))) assert.ok(estimateCost(model, 1_000_000, 0) > 0, model);
  }
  assert.equal(estimateCost("anthropic/claude-haiku-5.5", 1_000_000, 1_000_000), 0.6);
});
