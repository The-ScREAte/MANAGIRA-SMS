// Unified interface over OpenRouter, OpenAI, and Anthropic. Callers never
// talk to a provider SDK directly - they call `streamCompletion()` and get
// the same event shape back regardless of which provider (or mock mode)
// served it. Automatic fallback: tries each configured provider in
// priority order until one succeeds.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

// OpenRouter first: one key can reach many vendors' models (including
// OpenAI's and Anthropic's), so it's the most useful default when present.
// Direct OpenAI/Anthropic keys still work standalone if OpenRouter isn't
// configured.
const PROVIDER_PRIORITY = ["openrouter", "openai", "anthropic"];

function isProviderConfigured(provider) {
  if (provider === "openrouter") return !!process.env.OPENROUTER_API_KEY;
  if (provider === "openai") return !!process.env.OPENAI_API_KEY;
  return !!process.env.ANTHROPIC_API_KEY;
}

const MOCK_MODE = String(process.env.MIRA_MOCK_LLM || "").toLowerCase() === "true" || !PROVIDER_PRIORITY.some(isProviderConfigured);

// Model IDs differ per provider (OpenRouter prefixes with the vendor, e.g.
// "openai/gpt-4o-mini", while a direct OpenAI/Anthropic key uses their own
// bare model names) - one map per provider, same task keys throughout.
const TASK_MODEL_MAPS = {
  openrouter: {
    classify: "openai/gpt-4o-mini",
    lookup: "openai/gpt-4o-mini",
    draft: "anthropic/claude-3.5-sonnet",
    reasoning: "anthropic/claude-3.5-sonnet",
    default: "openai/gpt-4o-mini",
  },
  openai: {
    classify: "gpt-4o-mini",
    lookup: "gpt-4o-mini",
    draft: "gpt-4o-mini",
    reasoning: "gpt-4o-mini",
    default: "gpt-4o-mini",
  },
  anthropic: {
    classify: "claude-sonnet-4-5",
    lookup: "claude-sonnet-4-5",
    draft: "claude-sonnet-4-5",
    reasoning: "claude-sonnet-4-5",
    default: "claude-sonnet-4-5",
  },
};

// ---- Multimodal content: messages built by the orchestrator use a
// provider-neutral shape - content is either a plain string, or an array
// of {type:"text", text} / {type:"image", image:{dataUrl}} blocks. Each
// real provider needs its own wire format, adapted right before the call
// so the rest of the codebase (mock mode, persistence, RAG) never has to
// know about either provider's specific schema.
function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  return "";
}
function hasImage(content) {
  return Array.isArray(content) && content.some((b) => b.type === "image");
}
function parseDataUrl(dataUrl) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl || "");
  return match ? { mimeType: match[1], base64: match[2] } : null;
}
function adaptForOpenAI(content) {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") return { type: "image_url", image_url: { url: block.image.dataUrl } };
    return block;
  });
}
function adaptForAnthropic(content) {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image") {
      const parsed = parseDataUrl(block.image.dataUrl);
      return { type: "image", source: { type: "base64", media_type: parsed?.mimeType || block.image.mimeType, data: parsed?.base64 || "" } };
    }
    return block;
  });
}

// ---- Mock provider: deterministic, keyword-triggered tool selection so
// the full orchestrator loop (including real tool execution against real
// tenant-scoped data) is provably correct without live API keys. Swapping
// in real keys later requires no code change - only MIRA_MOCK_LLM=false
// (or simply setting the keys, since mock mode auto-disables once a key
// is present).
// The orchestrator's second pass (after a tool call) re-invokes the model
// with the tool's real result folded into a "Tool result: <json>. Reply to
// the user based on this." message, expecting a natural-language answer.
// Without this, mock mode fell through to the same generic "demo mode"
// line every time - identical output whether a search found 3 students or
// zero, which reads as broken rather than just unphrased.
function mockPhraseToolResult(messages, rawText) {
  const match = rawText.match(/^Tool result: ([\s\S]*)\. Reply to the user based on this\.$/);
  if (!match) return null;

  let result;
  try {
    result = JSON.parse(match[1]);
  } catch {
    result = null;
  }

  const calledMessage = [...messages].reverse().find((m) => m.role === "assistant" && /^\[Called /.test(extractText(m.content)));
  const toolName = calledMessage ? (extractText(calledMessage.content).match(/^\[Called (\w+)/) || [])[1] : null;

  if (toolName === "find_student" && Array.isArray(result)) {
    if (!result.length) return "I couldn't find any students matching that - try a different name or spelling.";
    const names = result
      .slice(0, 5)
      .map((s) => [s.first_name, s.last_name].filter(Boolean).join(" ") + (s.class_name ? ` (${s.class_name})` : ""))
      .join(", ");
    const more = result.length > 5 ? `, and ${result.length - 5} more` : "";
    return `Found ${result.length} student${result.length === 1 ? "" : "s"}: ${names}${more}.`;
  }

  if (toolName === "find_contact" && Array.isArray(result)) {
    if (!result.length) return "I couldn't find any guardians matching that - try a different name or spelling.";
    const names = result
      .slice(0, 5)
      .map((g) => {
        const kids = (g.student_names || []).filter(Boolean);
        return [g.first_name, g.last_name].filter(Boolean).join(" ") + (kids.length ? ` (guardian of ${kids.join(", ")})` : "");
      })
      .join(", ");
    const more = result.length > 5 ? `, and ${result.length - 5} more` : "";
    return `Found ${result.length} guardian${result.length === 1 ? "" : "s"}: ${names}${more}.`;
  }

  if (toolName === "get_class" && Array.isArray(result)) {
    if (!result.length) return "I couldn't find any classes matching that.";
    const rows = result.slice(0, 8).map((c) => `${c.class_name} (${c.student_count} student${c.student_count === 1 ? "" : "s"})`).join(", ");
    const totalStudents = result.reduce((sum, c) => sum + (c.student_count || 0), 0);
    return `${result.length} class${result.length === 1 ? "" : "es"}, ${totalStudents} student${totalStudents === 1 ? "" : "s"} total: ${rows}.`;
  }

  if (toolName === "get_term" && Array.isArray(result)) {
    if (!result.length) return "No terms are set up yet for your school.";
    const current = result.find((t) => t.current || t.current_term);
    const names = result.slice(0, 5).map((t) => t.term_name + (t === current ? " (current)" : "")).join(", ");
    return `Found ${result.length} term${result.length === 1 ? "" : "s"}: ${names}.`;
  }

  if (toolName === "list_projects" && Array.isArray(result)) {
    const org = result[0];
    return org?.organization_name ? `You're working in ${org.organization_name}.` : "I couldn't load your school's details.";
  }

  return "I'm running in demo mode, so I can run the tool but can't fully phrase every kind of result yet - the raw data came back fine though.";
}

// Text left over after stripping the intent's own keywords - used as the
// search query for name-lookup tools. Falls back to null (rather than an
// empty-string query, which would search on the class/tool name instead
// of a real query) when nothing meaningful remains.
function stripKeywords(text, words) {
  const re = new RegExp("\\b(" + words.join("|") + ")\\b", "gi");
  const cleaned = text.replace(re, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function mockDecide({ messages, tools }) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const rawText = extractText(lastUser?.content);
  const text = rawText.toLowerCase();

  const toolResultReply = mockPhraseToolResult(messages, rawText);
  if (toolResultReply) return { type: "text", content: toolResultReply };

  const available = new Set((tools || []).map((t) => t.name));

  // Class/grade counts and rosters - checked before student search so
  // "how many students in JSS" routes here (class counts) instead of a
  // broken name search on "in jss".
  if (available.has("get_class") && /\b(class|classes|grade|jss|sss|form)\b/.test(text) && /\b(how many|how much|list|show|what|which)\b/.test(text)) {
    const classMatch = text.match(/\b(jss\s?\d?|sss\s?\d?|grade\s?\d+|form\s?\d+)\b/i);
    return { type: "tool_call", toolName: "get_class", arguments: { query: classMatch ? classMatch[0].trim() : "" } };
  }

  // Terms / school years
  if (available.has("get_term") && /\b(term|terms|semester|school year)\b/.test(text)) {
    return { type: "tool_call", toolName: "get_term", arguments: {} };
  }

  // Which school/org this session is in
  if (available.has("list_projects") && /\b(what|which)\s+(school|org|organization)\b/.test(text)) {
    return { type: "tool_call", toolName: "list_projects", arguments: {} };
  }

  // Guardian/parent/contact search - checked before student search so it
  // doesn't fall through to searching students by a guardian's name.
  if (available.has("find_contact") && /\b(guardian|guardians|parent|parents|contact|contacts)\b/.test(text) && /\b(find|search|look ?up)\b/.test(text)) {
    const query = stripKeywords(text, ["find", "search", "for", "of", "look ?up", "guardian", "guardians", "parent", "parents", "contact", "contacts", "a", "an", "me", "the"]);
    if (!query) return { type: "text", content: "Which guardian would you like me to find? Try \"find guardian <name>\"." };
    return { type: "tool_call", toolName: "find_contact", arguments: { query } };
  }

  // Student search - broadest match, checked last so the more specific
  // intents above get first claim on ambiguous wording.
  if (available.has("find_student") && (/\bstudents?\b/.test(text) || /\bfind\b/.test(text) || /\bsearch\b/.test(text))) {
    const nameMatch = text.match(/(?:find|search for|look up)\s+(?:me\s+)?(?:a\s+)?(?:student\s+)?(?:named\s+|called\s+)?([a-z][a-z .'-]{1,40})/i);
    const query = nameMatch ? nameMatch[1].trim() : stripKeywords(text, ["find", "search", "for", "of", "student", "students", "me", "a", "an", "named", "called"]);
    if (!query) return { type: "text", content: "Who would you like me to find? Try \"find <name>\"." };
    return { type: "tool_call", toolName: "find_student", arguments: { query } };
  }

  if (hasImage(lastUser?.content)) {
    return {
      type: "text",
      content:
        "I can see you've attached an image, but I'm running in demo mode right now (no live model key configured) so I can't actually look at it yet. Once a real API key is added, I'll be able to read images too.",
    };
  }

  return {
    type: "text",
    content:
      "I'm running in demo mode right now (no live model key configured), so I can only answer using the tools I have wired up so far - try asking me to find a student, find a guardian, list classes, or list terms.",
  };
}

async function mockStreamCompletion({ messages, tools, onToken, onToolCall }) {
  const decision = mockDecide({ messages, tools });
  if (decision.type === "tool_call") {
    onToolCall(decision.toolName, decision.arguments);
    return { finishReason: "tool_call", provider: "mock", model: "mock", usage: { promptTokens: 0, completionTokens: 0 } };
  }
  for (const word of decision.content.split(" ")) {
    onToken(word + " ");
  }
  return {
    finishReason: "stop",
    provider: "mock",
    model: "mock",
    usage: { promptTokens: 0, completionTokens: decision.content.split(" ").length },
  };
}

// ---- Real providers ----

// Shared by OpenAI and OpenRouter - both speak the same chat-completions
// wire format (OpenRouter is deliberately OpenAI-API-compatible), so only
// the client construction (base URL / key / headers) differs between them.
async function runOpenAICompatibleStream(client, { model, messages, tools, onToken, onToolCall }) {
  const stream = await client.chat.completions.create({
    model,
    messages: messages.map((m) => ({ ...m, content: adaptForOpenAI(m.content) })),
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

async function openaiStreamCompletion({ model, messages, tools, onToken, onToolCall }) {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return runOpenAICompatibleStream(client, { model, messages, tools, onToken, onToolCall });
}

async function openrouterStreamCompletion({ model, messages, tools, onToken, onToolCall }) {
  const OpenAI = require("openai");
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.MAIN_APP_PUBLIC_URL || process.env.MAIN_APP_INTERNAL_BASE_URL || "http://localhost:4100",
      "X-Title": "Mira",
    },
  });
  return runOpenAICompatibleStream(client, { model, messages, tools, onToken, onToolCall });
}

async function anthropicStreamCompletion({ model, messages, tools, onToken, onToolCall }) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemMessage = messages.find((m) => m.role === "system");
  const conversational = messages.filter((m) => m.role !== "system");

  const stream = client.messages.stream({
    model,
    max_tokens: 1024,
    system: extractText(systemMessage?.content),
    messages: conversational.map((m) => ({ ...m, content: adaptForAnthropic(m.content) })),
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
  if (provider === "openrouter") return openrouterStreamCompletion({ model, messages, tools, onToken, onToolCall });
  if (provider === "openai") return openaiStreamCompletion({ model, messages, tools, onToken, onToolCall });
  return anthropicStreamCompletion({ model, messages, tools, onToken, onToolCall });
}

/**
 * streamCompletion({task, messages, tools, onToken, onToolCall})
 * Picks a provider/model for the task, streams tokens via onToken(text),
 * and calls onToolCall(name, args) at most once if the model chooses a
 * tool instead of replying directly. Tries every configured provider in
 * priority order (openrouter, then openai, then anthropic) on error/
 * timeout before giving up.
 */
async function streamCompletion({ task = "default", messages, tools = [], onToken, onToolCall }) {
  if (MOCK_MODE) {
    return mockStreamCompletion({ messages, tools, onToken, onToolCall });
  }

  const configuredProviders = PROVIDER_PRIORITY.filter(isProviderConfigured);

  let lastError = null;
  for (const provider of configuredProviders) {
    try {
      const taskMap = TASK_MODEL_MAPS[provider];
      const model = taskMap[task] || taskMap.default;
      const result = await callProvider(provider, { model, messages, tools, onToken, onToolCall });
      return { ...result, provider, model };
    } catch (error) {
      console.error(`[mira/modelRouter] ${provider} failed, will try fallback if available:`, error.message);
      lastError = error;
    }
  }
  throw lastError || new Error("No LLM provider is configured (set OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY).");
}

module.exports = { streamCompletion, MOCK_MODE, TASK_MODEL_MAPS, PROVIDER_PRIORITY };
