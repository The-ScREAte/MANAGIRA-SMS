// Unified interface over OpenRouter, Telnyx, OpenAI, and Anthropic. Callers never
// talk to a provider SDK directly - they call `streamCompletion()` and get
// the same event shape back regardless of which provider (or mock mode)
// served it. Automatic fallback: tries each configured provider in
// priority order until one succeeds.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

// OpenRouter first: one key can reach many vendors' models (including
// OpenAI's and Anthropic's), so it's the most useful default when present.
// Telnyx is the second choice - a real, independently-hosted fallback so a
// full turn still completes (not a mock/canned reply) if OpenRouter itself
// is unreachable or out of credit, not just if the request errors. Direct
// OpenAI/Anthropic keys still work standalone/as further fallbacks if
// configured.
//
// (An OpenRouter prompt-size limit of ~10,700 tokens once failed every real turn; it no longer
// applies - OpenRouter served all of Mira's turns in Nov 2026, prompts of 18,000+ tokens
// included - so nothing is sent to Telnyx first any more.)
const MIRA_TEMPERATURE = Math.min(1, Math.max(0, Number(process.env.MIRA_TEMPERATURE ?? 0.2) || 0));
const PROVIDER_PRIORITY = ["openrouter", "telnyx", "openai", "anthropic"];

// Claude 4.6 and later reject temperature (OpenRouter doesn't list it for them, and the direct
// API answers 400), so it's sent only to models that take it; low temperature still applies to
// the others (gpt-4o-mini, Telnyx's Kimi). Claude 5.x think before answering instead: how much is
// set per task (reasoning effort) - low for lookups and plain turns, which need speed, medium for
// drafting and changes.
const NO_TEMPERATURE = /claude-(?:haiku|sonnet|opus|fable|mythos)-(?:5|4[.-][6-9])/;
const takesTemperature = (model) => !NO_TEMPERATURE.test(String(model || ""));
const THINKS = /claude-(?:haiku|sonnet|opus|fable|mythos)-5/;
const EFFORT_BY_TASK = { classify: "low", lookup: "low", default: "low", draft: "medium", reasoning: "medium" };
const effortFor = (model, task) => (THINKS.test(String(model || "")) ? EFFORT_BY_TASK[task] || "low" : null);
// Room for the thinking as well as the reply: a Claude 5.x answer's thinking counts toward its
// max_tokens, and a cut-off reply's tool calls are never run (readAnthropicStream).
const maxTokensFor = (model) => (THINKS.test(String(model || "")) ? 4096 : 2048);

// Strict tool schemas (Claude's `strict: true`: the model can only send details that fit the
// schema). Off unless MIRA_STRICT_TOOLS=true, until a live call confirms the provider accepts
// them; the orchestrator checks every call's details in code either way (services/argCheck.js).
const STRICT_TOOLS = String(process.env.MIRA_STRICT_TOOLS || "").toLowerCase() === "true";

// The tool's schema in the form strict mode needs (additionalProperties: false on every object),
// or null when the schema can't be strict without changing what it accepts: a free-form object
// (no listed fields, e.g. report filters) or a keyword strict mode doesn't take.
const STRICT_UNSUPPORTED = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "oneOf", "allOf", "not"]);
function strictSchema(schema) {
  let ok = true;
  const walk = (node) => {
    if (!ok || !node || typeof node !== "object" || Array.isArray(node)) return node;
    if (Object.keys(node).some((key) => STRICT_UNSUPPORTED.has(key))) { ok = false; return node; }
    const out = { ...node };
    if (out.type === "object") {
      if (!out.properties || !Object.keys(out.properties).length) { ok = false; return node; }
      out.properties = Object.fromEntries(Object.entries(out.properties).map(([key, value]) => [key, walk(value)]));
      out.additionalProperties = false;
    }
    if (out.items) out.items = walk(out.items);
    return out;
  };
  const result = walk(schema);
  return ok ? result : null;
}

function isProviderConfigured(provider) {
  if (provider === "openrouter") return !!process.env.OPENROUTER_API_KEY;
  if (provider === "telnyx") return !!process.env.TELNYX_API_KEY;
  if (provider === "openai") return !!process.env.OPENAI_API_KEY;
  return !!process.env.ANTHROPIC_API_KEY;
}

const MOCK_MODE = String(process.env.MIRA_MOCK_LLM || "").toLowerCase() === "true" || !PROVIDER_PRIORITY.some(isProviderConfigured);

// Model IDs differ per provider (OpenRouter prefixes with the vendor, e.g.
// "openai/gpt-4o-mini", while a direct OpenAI/Anthropic key uses their own
// bare model names) - one map per provider, same task keys throughout.
// "default" is what every real chat turn actually runs on - including all
// the multi-step tool calling (creating/renaming/deleting records) built
// out across this file's callers. It was pinned to the cheapest tier
// (gpt-4o-mini) while lighter, simpler tasks (draft/reasoning) got the
// stronger model - backwards, and the direct cause of tool calls going out
// with empty/wrong arguments in longer or multi-entity conversations
// (e.g. "create this class, add this subject to it, and these two
// graduation year groups" - gpt-4o-mini repeatedly called create_subject
// with {} instead of filling in values right there in the conversation).
// Bumped to the same tier as draft/reasoning.
const TASK_MODEL_MAPS = {
  // 2026-11-22: every chat turn moved off gpt-4o-mini, which dropped tool details and misread
  // long results. Claude Haiku 5.5 (OpenRouter $0.10 / $0.50 per million tokens, cheaper than
  // gpt-4o-mini's $0.15 / $0.60) answers lookups, plain turns and the classifying; Claude
  // Sonnet 5.5 ($2 / $10, cheaper than Sonnet 4.5's $3 / $15) drafts and works through changes
  // and compound questions. IDs as OpenRouter's /api/v1/models lists them.
  // 2026-11-23: every task on Haiku 5.5. Sonnet 5.5 made 86% of the cost (25 of 157 calls in a
  // 50-question run) for the same eval score; the accuracy checks are in code, not in the model.
  // MIRA_STRONG_MODEL=anthropic/claude-sonnet-5.5 puts drafting and changes back on Sonnet.
  openrouter: {
    classify: "anthropic/claude-haiku-5.5",
    lookup: "anthropic/claude-haiku-5.5",
    draft: process.env.MIRA_STRONG_MODEL || "anthropic/claude-haiku-5.5",
    reasoning: process.env.MIRA_STRONG_MODEL || "anthropic/claude-haiku-5.5",
    default: "anthropic/claude-haiku-5.5",
  },
  openai: {
    classify: "gpt-4o-mini",
    lookup: "gpt-4o-mini",
    draft: "gpt-4o",
    reasoning: "gpt-4o",
    default: "gpt-4o",
  },
  anthropic: {
    classify: "claude-haiku-5-5",
    lookup: "claude-haiku-5-5",
    draft: "claude-sonnet-5-5",
    reasoning: "claude-sonnet-5-5",
    default: "claude-haiku-5-5",
  },
  // Telnyx's open-model catalog (https://developers.telnyx.com/docs/inference/models)
  // doesn't have an established "cheap/small" tier the way OpenAI does, so
  // one solid tool-calling model covers every task here rather than
  // guessing at a lighter model's exact id. Kimi K2 is Moonshot AI's
  // agentic/tool-use-oriented model - a reasonable single choice for a
  // fallback path that still needs to drive Mira's full tool set reliably.
  telnyx: {
    classify: "moonshotai/Kimi-K2.5",
    lookup: "moonshotai/Kimi-K2.5",
    draft: "moonshotai/Kimi-K2.5",
    reasoning: "moonshotai/Kimi-K2.5",
    default: "moonshotai/Kimi-K2.5",
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

// ---- Tool-call history messages ----
// The orchestrator represents "the model called a tool, here's the result"
// as two provider-neutral message shapes: an assistant message carrying
// `toolCalls: [{id, name, args}, ...]` (content null, ONE OR MORE calls -
// models routinely call several tools in parallel in a single response,
// e.g. "create this class, this subject, and these two grad year groups"
// naturally becomes 4 parallel calls), and a `role: "tool_results"` message
// carrying `results: [{toolCallId, content}, ...]`, one per call being
// answered. Previously this was faked as plain text ("[Called X with Y]" /
// "Tool result: ..."), which isn't the real tool-calling protocol either
// provider expects; fixing that to a *single*-call-shaped native format
// then surfaced the real bug: parallel tool calls were being collapsed
// into one corrupted buffer (all calls' JSON arguments concatenated
// together byte-for-byte, since only the first call's buffer was ever
// created and every subsequent call's argument fragments kept getting
// appended onto it) - producing invalid JSON that silently parsed to `{}`,
// which looked exactly like "the model keeps forgetting the arguments"
// but was actually this parser discarding 2 of every 3 parallel calls'
// real arguments. These adapt the neutral shape to each provider's actual
// wire format right before the call, same principle as
// adaptForOpenAI/adaptForAnthropic above.
// Prompt caching for Claude through OpenRouter: the long, unchanging opening (Mira's instructions)
// is marked once, so the next call in the turn - and the next turn - reads it from the cache at a
// tenth of the price instead of paying for ~10,000 tokens again. Other models are sent as before.
function cacheForClaude(model, wire) {
  if (!/^anthropic\//.test(String(model || ""))) return wire;
  const first = wire.findIndex((m) => m.role === "system");
  if (first < 0) return wire;
  const out = wire.slice();
  const text = typeof out[first].content === "string" ? out[first].content : (out[first].content || []).map((b) => b.text || "").join("");
  out[first] = { ...out[first], content: [{ type: "text", text, cache_control: { type: "ephemeral" } }] };
  return out;
}

function toOpenAIMessages(m) {
  if (m.role === "assistant" && m.toolCalls?.length) {
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } })),
      },
    ];
  }
  if (m.role === "tool_results") {
    return m.results.map((r) => ({ role: "tool", tool_call_id: r.toolCallId, content: typeof r.content === "string" ? r.content : JSON.stringify(r.content) }));
  }
  return [{ ...m, content: adaptForOpenAI(m.content) }];
}

function toAnthropicMessages(m) {
  if (m.role === "assistant" && m.toolCalls?.length) {
    return [{ role: "assistant", content: m.toolCalls.map((tc) => ({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args || {} })) }];
  }
  if (m.role === "tool_results") {
    // Anthropic requires every tool_result answering a turn's tool_use
    // blocks to live in ONE subsequent user message (multiple content
    // blocks), not one message per result.
    return [{ role: "user", content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.toolCallId, content: typeof r.content === "string" ? r.content : JSON.stringify(r.content) })) }];
  }
  return [{ ...m, content: adaptForAnthropic(m.content) }];
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
function mockPhraseToolResult(messages) {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "tool_results" || !lastMessage.results?.length) return null;

  let result;
  try {
    result = JSON.parse(lastMessage.results[0].content);
  } catch {
    result = null;
  }

  // Managira's own summary of the lookup (services/facts.js), used as written.
  if (result && typeof result === "object" && !Array.isArray(result) && result.summary_text) {
    return [result.summary_text, result.table].filter(Boolean).join("\n\n");
  }

  const calledMessage = [...messages].reverse().find((m) => m.role === "assistant" && m.toolCalls?.length);
  const toolName = calledMessage?.toolCalls?.[0]?.name || null;

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

  // Tests only: "[mira-test-reply]" always answers with the text in MIRA_TEST_REPLY, and
  // "[mira-test-lookup] tool {json}" calls that tool once, then answers with it - so a test can
  // prove that an unbacked reply never reaches the person (orchestrator.js). The reply is kept
  // out of the message itself: the person's own words count as evidence.
  if (/^\s*\[mira-test-reply\]\s*$/.test(rawText)) return { type: "text", content: String(process.env.MIRA_TEST_REPLY || "") };
  const lookupThenReply = rawText.match(/^\s*\[mira-test-lookup\]\s+([a-z_]+)\s+(\{[\s\S]*\})\s*$/);
  if (lookupThenReply) {
    if (messages.some((m) => m.role === "tool_results")) return { type: "text", content: String(process.env.MIRA_TEST_REPLY || "") };
    try {
      return { type: "tool_call", toolName: lookupThenReply[1], arguments: JSON.parse(lookupThenReply[2]) };
    } catch (_) {
      return { type: "text", content: "That test lookup's details aren't valid JSON." };
    }
  }

  const toolResultReply = mockPhraseToolResult(messages);
  if (toolResultReply) return { type: "text", content: toolResultReply };

  const available = new Set((tools || []).map((t) => t.name));

  // Tests only (mock mode never runs with a real provider): "[mira-test-call] tool {json}"
  // calls that tool, so a browser test can drive previews and confirmations end to end.
  const forced = rawText.match(/^\s*\[mira-test-call\]\s+([a-z_]+)\s+(\{[\s\S]*\})\s*$/);
  if (forced) {
    try {
      return { type: "tool_call", toolName: forced[1], arguments: JSON.parse(forced[2]) };
    } catch (_) {
      return { type: "text", content: "That test call's details aren't valid JSON." };
    }
  }

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
    onToolCall(decision.toolName, decision.arguments, `mock-${Date.now()}`);
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
async function runOpenAICompatibleStream(client, { model, task, messages, tools, onToken, onToolCall }) {
  // Strict schemas only for Claude models (OpenAI's strict mode needs every field required, which
  // Mira's tools aren't), and only when MIRA_STRICT_TOOLS is on.
  const strict = STRICT_TOOLS && /^anthropic\//.test(model);
  const stream = await client.chat.completions.create({
    model,
    messages: cacheForClaude(model, messages.flatMap(toOpenAIMessages)),
    tools: tools?.length
      ? tools.map((t) => {
        const strictParams = strict ? strictSchema(t.parameters) : null;
        return { type: "function", function: { name: t.name, description: t.description, parameters: strictParams || t.parameters, ...(strictParams ? { strict: true } : {}) } };
      })
      : undefined,
    // Without a cap, some providers (via OpenRouter) reserve credits against
    // the model's full max output (tens of thousands of tokens) just to
    // start a request, even for an ordinary chat reply - this was failing
    // every call outright ("requires more credits... requested up to 64000
    // tokens") on an account with a modest balance. A real chat reply or
    // tool call never needs anywhere near this; matches the cap the direct
    // Anthropic path below already sets.
    max_tokens: maxTokensFor(model),
    // Low temperature where the model takes it: Mira reports facts from tool results; creative
    // variation is where invented names and numbers come from.
    ...(takesTemperature(model) ? { temperature: MIRA_TEMPERATURE } : {}),
    ...(effortFor(model, task) ? { reasoning: { effort: effortFor(model, task) } } : {}),
    stream: true,
  });

  // Keyed by the stream's own `index` field, NOT array position - a model
  // that calls several tools in parallel (very common for a compound
  // request) streams one fragment set per call, each tagged with its own
  // index; every fragment must accumulate into ITS call's buffer, not get
  // appended onto whichever buffer happened to exist first.
  const toolCallBuffers = new Map();
  let usage = null;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) onToken(delta.content);
    if (delta?.tool_calls?.length) {
      for (const call of delta.tool_calls) {
        const index = call.index ?? 0;
        if (!toolCallBuffers.has(index)) {
          // `id` and `function.name` only arrive on the first chunk of a
          // given tool call; later chunks for that same index carry only
          // argument fragments to append.
          toolCallBuffers.set(index, { id: call.id, name: call.function?.name || "", args: "" });
        }
        if (call.function?.arguments) toolCallBuffers.get(index).args += call.function.arguments;
      }
    }
    if (chunk.usage) usage = chunk.usage;
  }
  if (toolCallBuffers.size) {
    for (const buffer of toolCallBuffers.values()) {
      // Details that aren't valid JSON are never turned into {} and run: the call is flagged
      // and the orchestrator sends it back to the model to make again (services/argCheck.js).
      let parsedArgs = {};
      let unreadable = false;
      try {
        parsedArgs = JSON.parse(buffer.args || "{}");
      } catch {
        unreadable = true;
      }
      onToolCall(buffer.name, parsedArgs, buffer.id, unreadable ? { unreadable: true } : undefined);
    }
    return { finishReason: "tool_call", usage };
  }
  return { finishReason: "stop", usage };
}

// The SDK's own default (10 minutes) means a provider that stalls instead of
// erroring - connects but never sends data, or hangs mid-stream - blocks the
// whole turn for up to 10 minutes with no fallback and no error surfaced to
// the frontend, which just reads as "spins forever". Capping it here makes a
// stalled provider fail fast (APIConnectionTimeoutError) so streamCompletion's
// try/catch loop below moves on to the next configured provider instead.
const PROVIDER_TIMEOUT_MS = 25000;

async function openaiStreamCompletion({ model, task, messages, tools, onToken, onToolCall }) {
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: PROVIDER_TIMEOUT_MS });
  return runOpenAICompatibleStream(client, { model, task, messages, tools, onToken, onToolCall });
}

async function openrouterStreamCompletion({ model, task, messages, tools, onToken, onToolCall }) {
  const OpenAI = require("openai");
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: PROVIDER_TIMEOUT_MS,
    defaultHeaders: {
      "HTTP-Referer": process.env.MAIN_APP_PUBLIC_URL || process.env.MAIN_APP_INTERNAL_BASE_URL || "http://localhost:4100",
      "X-Title": "Mira",
    },
  });
  return runOpenAICompatibleStream(client, { model, task, messages, tools, onToken, onToolCall });
}

// Telnyx's chat completions endpoint is deliberately OpenAI-compatible
// (https://developers.telnyx.com/docs/inference/ai-assistants/custom-llm) -
// same wire format as OpenRouter/OpenAI, just a different base URL and key.
async function telnyxStreamCompletion({ model, task, messages, tools, onToken, onToolCall }) {
  const OpenAI = require("openai");
  const client = new OpenAI({
    apiKey: process.env.TELNYX_API_KEY,
    baseURL: "https://api.telnyx.com/v2/ai",
    timeout: PROVIDER_TIMEOUT_MS,
  });
  return runOpenAICompatibleStream(client, { model, task, messages, tools, onToken, onToolCall });
}

async function anthropicStreamCompletion({ model, task, messages, tools, onToken, onToolCall }) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: PROVIDER_TIMEOUT_MS });

  // Anthropic's API takes one flat `system` string, not multiple system-role
  // messages in the array - the base prompt, RAG context, class scope, and
  // custom instructions are each their own system message upstream, so all
  // of them have to be joined here or everything after the first (including
  // the user's own custom instructions) silently never reaches the model.
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversational = messages.filter((m) => m.role !== "system");

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokensFor(model),
    ...(takesTemperature(model) ? { temperature: MIRA_TEMPERATURE } : {}),
    ...(effortFor(model, task) ? { output_config: { effort: effortFor(model, task) } } : {}),
    system: systemMessages.map((m) => extractText(m.content)).filter(Boolean).join("\n\n"),
    messages: conversational.flatMap(toAnthropicMessages),
    tools: tools?.length
      ? tools.map((t) => {
        const strictParams = STRICT_TOOLS ? strictSchema(t.parameters) : null;
        return { name: t.name, description: t.description, input_schema: strictParams || t.parameters, ...(strictParams ? { strict: true } : {}) };
      })
      : undefined,
  });

  return readAnthropicStream(stream, { onToken, onToolCall });
}

// The SDK (1.8) reads a tool call's streamed JSON leniently: cut-off JSON ({"studentId": 5) comes
// back as {} with no error, and malformed JSON throws a SyntaxError inside the stream, which the
// SDK wraps as a plain AnthropicError and finalMessage() rejects with - so the whole provider
// looked down. Here each call's id, name and raw JSON are recorded from the stream's own events
// and parsed strictly; a call that doesn't parse is flagged { unreadable: true } (the
// orchestrator sends it back to the model), never run as {}. Only that parse error is caught:
// API errors (APIError: rate limits, auth, overload, timeouts) still fail the provider as before.
function isToolJsonError(error) {
  const { AnthropicError, APIError } = require("@anthropic-ai/sdk");
  return error instanceof AnthropicError && !(error instanceof APIError) && /JSON/i.test(String(error.message || ""));
}

async function readAnthropicStream(stream, { onToken, onToolCall }) {
  // index -> { id, name, json, startInput }
  const calls = new Map();
  stream.on("text", (text) => onToken(text));
  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start" && event.content_block && event.content_block.type === "tool_use") {
      calls.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: "", startInput: event.content_block.input });
    } else if (event.type === "content_block_delta" && event.delta && event.delta.type === "input_json_delta" && calls.has(event.index)) {
      calls.get(event.index).json += event.delta.partial_json || "";
    }
  });

  let finalMessage = null;
  try {
    finalMessage = await stream.finalMessage();
  } catch (error) {
    if (!calls.size || !isToolJsonError(error)) throw error;
  }

  // Anthropic natively supports multiple tool_use blocks in one response
  // (parallel tool calls) - only using the first silently dropped every
  // other one the model tried to make in the same turn.
  if (calls.size) {
    // A reply that broke off (malformed JSON), was cut off at max_tokens or stopped by a refusal
    // can leave any of its calls incomplete though they still parse: none of them are run.
    const brokeOff = !finalMessage || finalMessage.stop_reason === "max_tokens" || finalMessage.stop_reason === "refusal";
    for (const [, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      let args = {};
      let unreadable = brokeOff;
      try {
        args = call.json.trim() ? JSON.parse(call.json) : (call.startInput || {});
      } catch (_) {
        unreadable = true;
      }
      onToolCall(call.name, unreadable ? {} : args, call.id, unreadable ? { unreadable: true } : undefined);
    }
    return { finishReason: "tool_call", usage: finalMessage ? finalMessage.usage : null };
  }
  return { finishReason: "stop", usage: finalMessage.usage };
}

async function callProvider(provider, { model, task, messages, tools, onToken, onToolCall }) {
  if (provider === "openrouter") return openrouterStreamCompletion({ model, task, messages, tools, onToken, onToolCall });
  if (provider === "telnyx") return telnyxStreamCompletion({ model, task, messages, tools, onToken, onToolCall });
  if (provider === "openai") return openaiStreamCompletion({ model, task, messages, tools, onToken, onToolCall });
  return anthropicStreamCompletion({ model, task, messages, tools, onToken, onToolCall });
}

/**
 * streamCompletion({task, messages, tools, onToken, onToolCall})
 * Picks a provider/model for the task, streams tokens via onToken(text),
 * and calls onToolCall(name, args, id) at most once if the model chooses a
 * tool instead of replying directly - `id` must be threaded back into the
 * next call's message history (see orchestrator.js) so the follow-up
 * "here's the tool result" message uses the provider's real tool-call
 * protocol instead of being faked as plain text. Tries every configured provider in
 * priority order (openrouter, then telnyx, then openai, then anthropic) on
 * error/timeout before giving up.
 */
const restingUntil = new Map();
// Out of credit or over a limit won't fix itself soon; a blip might.
function restFor(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  return [400, 401, 402, 403, 413].includes(status) ? 10 * 60 * 1000 : 60 * 1000;
}

async function streamCompletion({ task = "default", messages, tools = [], onToken, onToolCall }) {
  if (MOCK_MODE) {
    return mockStreamCompletion({ messages, tools, onToken, onToolCall });
  }

  // Every request tries OpenRouter first. (A check that sent prompts over ~10,500 tokens to
  // Telnyx first was removed 2026-11-22: that OpenRouter limit no longer applies - it serves
  // 18,000-token prompts - so large requests were waiting on Telnyx for nothing.)
  const configuredProviders = PROVIDER_PRIORITY.filter(isProviderConfigured);

  // One that just failed waits at the back of the queue for a while, so nobody sits through
  // the same failure on every step of every reply. It's still tried if nothing else answers.
  const now = Date.now();
  const ready = configuredProviders.filter((provider) => !(restingUntil.get(provider) > now));
  const resting = configuredProviders.filter((provider) => restingUntil.get(provider) > now);

  let lastError = null;
  for (const provider of [...ready, ...resting]) {
    let started = false;
    try {
      const taskMap = TASK_MODEL_MAPS[provider];
      const model = taskMap[task] || taskMap.default;
      const result = await callProvider(provider, {
        model, task, messages, tools, onToolCall,
        onToken: (text) => { started = true; onToken(text); },
      });
      restingUntil.delete(provider);
      return { ...result, provider, model };
    } catch (error) {
      console.error(`[mira/modelRouter] ${provider} failed, will try fallback if available:`, error.message);
      lastError = error;
      restingUntil.set(provider, Date.now() + restFor(error));
      // Words already on the person's screen can't be taken back by starting over elsewhere.
      if (started) throw error;
    }
  }
  throw lastError || new Error("No LLM provider is configured (set OPENROUTER_API_KEY, TELNYX_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY).");
}

module.exports = { cacheForClaude, streamCompletion, MOCK_MODE, TASK_MODEL_MAPS, PROVIDER_PRIORITY, takesTemperature, effortFor, maxTokensFor, strictSchema, runOpenAICompatibleStream, readAnthropicStream };
