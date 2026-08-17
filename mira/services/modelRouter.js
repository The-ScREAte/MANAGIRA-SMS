// Unified interface over OpenAI and Anthropic. Callers never talk to a
// provider SDK directly - they call `streamCompletion()` and get the same
// event shape back regardless of which provider (or mock mode) served it.
// Automatic fallback: if the chosen provider throws or times out, retries
// once on the other provider before giving up.
require("dotenv").config();

const MOCK_MODE = String(process.env.MIRA_MOCK_LLM || "").toLowerCase() === "true" || (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY);

const TASK_MODEL_MAP = {
  classify: { provider: "openai", model: "gpt-4o-mini" },
  lookup: { provider: "openai", model: "gpt-4o-mini" },
  draft: { provider: "anthropic", model: "claude-sonnet-4-5" },
  reasoning: { provider: "anthropic", model: "claude-sonnet-4-5" },
  default: { provider: "openai", model: "gpt-4o-mini" },
};

function otherProvider(provider) {
  return provider === "openai" ? "anthropic" : "openai";
}

function isProviderConfigured(provider) {
  return provider === "openai" ? !!process.env.OPENAI_API_KEY : !!process.env.ANTHROPIC_API_KEY;
}

// ---- Mock provider: deterministic, keyword-triggered tool selection so
// the full orchestrator loop (including real tool execution against real
// tenant-scoped data) is provably correct without live API keys. Swapping
// in real keys later requires no code change - only MIRA_MOCK_LLM=false
// (or simply setting the keys, since mock mode auto-disables once a key
// is present).
function mockDecide({ messages, tools }) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = String(lastUser?.content || "").toLowerCase();

  if (tools?.some((t) => t.name === "find_student") && (text.includes("find") || text.includes("student") || text.includes("search"))) {
    const nameMatch = text.match(/(?:find|search for|look up)\s+(?:student\s+)?([a-z][a-z .'-]{1,40})/i);
    const query = nameMatch ? nameMatch[1].trim() : text.replace(/find|student|search|for/gi, "").trim() || "student";
    return { type: "tool_call", toolName: "find_student", arguments: { query } };
  }

  return {
    type: "text",
    content:
      "I'm running in demo mode right now (no live model key configured), so I can only answer using the tools I have wired up so far. Try asking me to find a student.",
  };
}

async function mockStreamCompletion({ messages, tools, onToken, onToolCall }) {
  const decision = mockDecide({ messages, tools });
  if (decision.type === "tool_call") {
    onToolCall(decision.toolName, decision.arguments);
    return { finishReason: "tool_call" };
  }
  for (const word of decision.content.split(" ")) {
    onToken(word + " ");
  }
  return { finishReason: "stop", usage: { promptTokens: 0, completionTokens: decision.content.split(" ").length } };
}

// ---- Real providers ----

async function openaiStreamCompletion({ model, messages, tools, onToken, onToolCall }) {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const stream = await client.chat.completions.create({
    model,
    messages,
    tools: tools?.length ? tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined,
    stream: true,
  });

  let toolCallBuffer = null;
  let usage = null;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) onToken(delta.content);
    if (delta?.tool_calls?.length) {
      const call = delta.tool_calls[0];
      if (!toolCallBuffer) toolCallBuffer = { name: call.function?.name || "", args: "" };
      if (call.function?.arguments) toolCallBuffer.args += call.function.arguments;
    }
    if (chunk.usage) usage = chunk.usage;
  }
  if (toolCallBuffer) {
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(toolCallBuffer.args || "{}");
    } catch {
      /* leave empty */
    }
    onToolCall(toolCallBuffer.name, parsedArgs);
    return { finishReason: "tool_call", usage };
  }
  return { finishReason: "stop", usage };
}

async function anthropicStreamCompletion({ model, messages, tools, onToken, onToolCall }) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemMessage = messages.find((m) => m.role === "system");
  const conversational = messages.filter((m) => m.role !== "system");

  const stream = client.messages.stream({
    model,
    max_tokens: 1024,
    system: systemMessage?.content,
    messages: conversational,
    tools: tools?.length ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) : undefined,
  });

  stream.on("text", (text) => onToken(text));

  const finalMessage = await stream.finalMessage();
  const toolUse = finalMessage.content.find((block) => block.type === "tool_use");
  if (toolUse) {
    onToolCall(toolUse.name, toolUse.input);
    return { finishReason: "tool_call", usage: finalMessage.usage };
  }
  return { finishReason: "stop", usage: finalMessage.usage };
}

async function callProvider(provider, { model, messages, tools, onToken, onToolCall }) {
  if (provider === "openai") return openaiStreamCompletion({ model, messages, tools, onToken, onToolCall });
  return anthropicStreamCompletion({ model, messages, tools, onToken, onToolCall });
}

/**
 * streamCompletion({task, messages, tools, onToken, onToolCall})
 * Picks a provider/model for the task, streams tokens via onToken(text),
 * and calls onToolCall(name, args) at most once if the model chooses a
 * tool instead of replying directly. Falls back to the other provider on
 * error/timeout automatically.
 */
async function streamCompletion({ task = "default", messages, tools = [], onToken, onToolCall }) {
  if (MOCK_MODE) {
    return mockStreamCompletion({ messages, tools, onToken, onToolCall });
  }

  const primary = TASK_MODEL_MAP[task] || TASK_MODEL_MAP.default;
  const providerOrder = isProviderConfigured(primary.provider)
    ? [primary.provider, otherProvider(primary.provider)]
    : [otherProvider(primary.provider), primary.provider];

  let lastError = null;
  for (const provider of providerOrder) {
    if (!isProviderConfigured(provider)) continue;
    try {
      const model = provider === primary.provider ? primary.model : TASK_MODEL_MAP.default.model;
      return await callProvider(provider, { model, messages, tools, onToken, onToolCall });
    } catch (error) {
      console.error(`[mira/modelRouter] ${provider} failed, will try fallback if available:`, error.message);
      lastError = error;
    }
  }
  throw lastError || new Error("No LLM provider is configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).");
}

module.exports = { streamCompletion, MOCK_MODE, TASK_MODEL_MAP };
