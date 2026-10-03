// Per-turn orchestration: persist the user's message, run the model+tools
// loop, stream the reply over SSE, persist the assistant's reply + any
// tool calls to the audit log.
const db = require("../config/db");
const { ensureMiraSchema } = require("../db/schema");
const { streamCompletion } = require("./modelRouter");
const { listToolSchemas, runTool } = require("../tools");
const { retrieveContext } = require("./ragService");
const { checkBudget, recordUsage } = require("./usageLedger");
const { callInternalApi } = require("../internalApiClient");
const {
  LOAD_TOOLS_NAME,
  selectAreas,
  selectToolSchemas,
  normalizeRequestedAreas,
  toolNamesForAreas,
} = require("./toolSelector");

const SYSTEM_PROMPT = `You are Mira, Managira's AI assistant for school staff: you find records, explain data, draft communications and make changes through your tools. Only ever act within the current user's own school. Be warm, clear and professional.

## Scope
- Unless the user names another term or school year, everything is about the CURRENT school year and term (given below). Say which term a figure is for when it matters.
- Stay on Managira and school-administration topics; decline anything else in one short sentence.
- You can work on Admissions & Students, Guardians, Attendance, Assessments & Grading, Report Cards & Merit Sheets, Statistics, Enrollment & Promotion, Employees, Transportation, Events & Announcements, School Years/Terms/Classes/Subjects, the public School Website, Docs & Sheets and school settings. You only see the tools for the current topic; if you need another area, call load_tools - never tell the user you can't do something before checking. You report integration status (Google Classroom, WhatsApp, SMS, Student Portal, Transportation) but don't connect or configure them.

## Conversation
- This is one continuous conversation. Earlier messages, your earlier tool calls and their results are all above - use them.
- A short reply ("yes", "no", "ok", "go ahead", "the first one", "both", "do it", a bare name or number) answers YOUR most recent question. Resolve it from that question and carry out the plan you proposed with the exact same details (student, class, term, file) - never make the user repeat themselves, and never ask the same thing twice.
- "No, I meant X" means your last answer missed - fix it, don't repeat it.
- Only ask when something is genuinely missing or ambiguous, or before a destructive action. Ask one clear question that restates what you already know. Never ask permission for a lookup - just do it, and chain every tool call a request needs in the same turn.
- For a compound request, work out the whole plan first and present it once; a clear yes confirms the whole plan.

## Actions
- Never guess a required value. Creating/renaming/adding is not destructive: once every value is known, do it.
- Deletes, emails to parents and similar actions follow the tool's warn-then-confirm flow: show the warning, wait for an explicit yes in a later message, then call again with confirm=true.
- After any action, say exactly what happened (or why it didn't). If a tool is denied, explain plainly; never claim to have done something you didn't.
- For questions about the current state, call the tool fresh rather than trusting an older result.

## Report cards and messages
- Whenever report cards are requested for parents (send, share, give to guardians), first ask: "Would you like me to post them to the parent portal as well, or just send them?" - and, if sending, by which channel (only the channels the school has turned on; Email is always available). If they only wanted download links, give them, then offer to post or send.
- Then use post_or_send_report_cards: show its preview (who gets what, anyone with no contact on file) and act only after an explicit yes.
- To message guardians (reminders, notices) use send_message the same way: show the exact message, recipients and counts first, send after a yes. list_sent_messages shows whether messages were delivered.

## School website
- You can build the school's website for them: About Us, contact details, gallery photos, articles, layout, theme and the extra sections (quick facts, programs & facilities, leadership, testimonials, FAQ, an About photo and the contact form). Start with get_website_settings - its setupChecklist shows what is missing - and suggest the next most useful step.
- When the user shares information or photos (a brochure, a list of programs, staff photos), turn it into polished, accurate website content. Use only what they gave you or what is in the school's records - never invent facts, numbers, names or quotes. Write a short real caption for each photo from what you can see.
- For update_website_section, first call without confirm and show the user the exact content (and which photo goes where); publish with confirm=true after their yes. Then say whether it is live and give the website link.
- The contact form needs the school's own email address for messages - ask for it if you don't have it.

## Documents and attachments
- Attached files arrive between "[Attached file: ...]" and "---". Read them carefully. When asked to check one, compare it against the school's real records using your tools and report matches, differences and anything missing. Carry out instructions inside it, and keep using its content in later messages.
- If a file came through empty or unreadable (for example a scanned PDF), say so and ask for a text PDF, Word or Excel version.

## Answers
- Lead with the direct answer; bold the key fact. Use short headings and markdown tables for lists and comparisons. Keep it concise and professional - no emojis.
- Ground every number and name in tool output. When a tool returns a PDF link, a page link or download links, give them as markdown links. Embed chart image URLs with markdown image syntax.
- When "Relevant indexed context" from Managira's documentation is provided, answer from it confidently; without it, say you don't have that detail rather than guessing.`;

// A new chat's title is derived from the user's first question rather
// than left as "New chat" - no model call needed (works the same in mock
// mode), just a cleaned-up, truncated version of what they asked.
function deriveTitle(text) {
  const clean = stripAttachmentBlocks(text).replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  const truncated = clean.length > 48 ? clean.slice(0, 48).trim() + "…" : clean;
  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}

// User-authored custom instructions (Settings page) - kept in mind across
// every future response, same idea as Claude's own "Instructions for
// Claude". Best-effort: a lookup failure should never block a chat turn.
async function loadCustomInstructions(tenant) {
  try {
    await ensureMiraSchema(db);
    const result = await db.query(
      `SELECT custom_instructions FROM mira_user_preferences
       WHERE tenant_id = $1 AND viewer_type = $2 AND user_id = $3`,
      [tenant.organizationId, tenant.viewerType, tenant.userId]
    );
    return result.rows[0]?.custom_instructions?.trim() || null;
  } catch (error) {
    console.error("[mira/orchestrator] failed to load custom instructions, continuing without them:", error.message);
    return null;
  }
}

// The school's current school year and term, so "this term" always means
// the right one. Cached briefly per school; best-effort.
const SCHOOL_CONTEXT_TTL_MS = 5 * 60 * 1000;
const schoolContextCache = new Map();
async function loadSchoolCalendar(organizationId) {
  const cached = schoolContextCache.get(organizationId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value = null;
  try {
    const { terms } = await callInternalApi(`/internal/api/terms?organizationId=${encodeURIComponent(organizationId)}`);
    const list = Array.isArray(terms) ? terms : [];
    const current = list.find((term) => term.current || term.current_term) || null;
    value = current ? { termName: current.term_name, yearLabel: current.year_label, startDate: current.start_date, endDate: current.end_date } : null;
  } catch (error) {
    console.error("[mira/orchestrator] could not load the current term:", error.message);
  }
  schoolContextCache.set(organizationId, { value, expiresAt: Date.now() + SCHOOL_CONTEXT_TTL_MS });
  return value;
}

function formatDay(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
    : null;
}

async function getOrCreateChat({ tenant, chatId, firstMessage }) {
  await ensureMiraSchema(db);
  if (chatId) {
    const existing = await db.query(
      `SELECT * FROM mira_chats WHERE id = $1 AND tenant_id = $2 AND viewer_type = $3 AND user_id = $4`,
      [chatId, tenant.organizationId, tenant.viewerType, tenant.userId]
    );
    if (existing.rows[0]) return existing.rows[0];
  }
  const created = await db.query(
    `INSERT INTO mira_chats (tenant_id, user_id, viewer_type, title) VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenant.organizationId, tenant.userId, tenant.viewerType, deriveTitle(firstMessage)]
  );
  return created.rows[0];
}

// ---- Conversation history ----
// The newest messages are sent back to the model each turn. The most recent
// turns also carry the tool calls Mira made and their (compacted) results,
// in the real tool-calling format, so a follow-up like "yes" or "the
// second one" can act on exactly the records already found.
const HISTORY_MESSAGES = 20;
const TURNS_WITH_TOOL_DETAIL = 4;
const TOOL_RESULT_MAX_CHARS = 2500;
const TOOL_RESULTS_PER_TURN_MAX_CHARS = 7000;
const OLD_ATTACHMENT_MAX_CHARS = 1500;

const ATTACHMENT_BLOCK = /^\[Attached (file|image): ([^\]]+)\]/;

function stripAttachmentBlocks(text) {
  return String(text || "")
    .split("\n\n---\n\n")
    .filter((block) => !ATTACHMENT_BLOCK.test(block))
    .join("\n\n");
}

// Older attachments are shortened in the history (the latest stays whole)
// so a long file doesn't get re-sent in full on every later turn.
function shortenAttachments(text) {
  return String(text || "")
    .split("\n\n---\n\n")
    .map((block) => {
      if (!ATTACHMENT_BLOCK.test(block) || block.length <= OLD_ATTACHMENT_MAX_CHARS) return block;
      return `${block.slice(0, OLD_ATTACHMENT_MAX_CHARS)}\n[... rest of this earlier attachment omitted - ask the user to re-attach it if you need the full text ...]`;
    })
    .join("\n\n---\n\n");
}

function compactToolResult(result, maxChars) {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars)} ...[truncated]` : text;
}

async function loadHistory(chatId) {
  const result = await db.query(
    `SELECT id, role, content, tool_calls FROM mira_chat_messages WHERE chat_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${HISTORY_MESSAGES}`,
    [chatId]
  );
  const rows = result.rows.reverse();

  const latestAttachmentIndex = rows.reduce(
    (latest, row, index) => (row.role === "user" && ATTACHMENT_BLOCK.test(String(row.content || "").trimStart()) ? index : latest),
    -1
  );
  const assistantIndexes = rows.map((row, index) => (row.role === "assistant" ? index : -1)).filter((index) => index >= 0);
  const detailedAssistant = new Set(assistantIndexes.slice(-TURNS_WITH_TOOL_DETAIL));

  // forModel: provider-neutral messages for the prompt.
  // summary: role/content/tool names, used to pick this turn's tools.
  const forModel = [];
  const summary = [];
  rows.forEach((row, index) => {
    const toolCalls = Array.isArray(row.tool_calls) ? row.tool_calls : [];
    summary.push({ role: row.role, content: stripAttachmentBlocks(row.content), toolCalls: toolCalls.map((call) => ({ name: call.name })) });

    if (row.role === "user") {
      forModel.push({ role: "user", content: index === latestAttachmentIndex ? row.content : shortenAttachments(row.content) });
      return;
    }

    const replayable = detailedAssistant.has(index) ? toolCalls.filter((call) => call.name && call.result !== undefined) : [];
    if (replayable.length) {
      const calls = replayable.map((call, callIndex) => ({ id: `h${row.id}_${callIndex}`, name: call.name, args: call.args || {} }));
      forModel.push({ role: "assistant", content: null, toolCalls: calls });
      forModel.push({
        role: "tool_results",
        results: replayable.map((call, callIndex) => ({ toolCallId: `h${row.id}_${callIndex}`, content: String(call.result) })),
      });
    }
    forModel.push({ role: "assistant", content: row.content || "" });
  });

  return { forModel, summary };
}

async function saveMessage(chatId, role, content, toolCalls, classScope) {
  const result = await db.query(
    `INSERT INTO mira_chat_messages (chat_id, role, content, tool_calls, class_scope) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [chatId, role, content, toolCalls ? JSON.stringify(toolCalls) : null, classScope ? JSON.stringify(classScope) : null]
  );
  await db.query(`UPDATE mira_chats SET updated_at = now() WHERE id = $1`, [chatId]);
  return { id: result.rows[0].id, createdAt: result.rows[0].created_at };
}

async function logToolCall({ tenant, chatId, toolName, args, status, resultSummary }) {
  await db.query(
    `INSERT INTO mira_tool_call_log (tenant_id, user_id, chat_id, tool_name, arguments, result_summary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenant.organizationId, tenant.userId, chatId, toolName, JSON.stringify(args || {}), resultSummary, status]
  );
}

function summarizeToolResult(toolName, result) {
  if (toolName === "find_student") {
    const count = Array.isArray(result) ? result.length : 0;
    return count === 0 ? "No students found." : `Found ${count} student(s).`;
  }
  return typeof result === "string" ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200);
}

// Shown to the user when no AI provider can answer (outage, billing, key).
const PROVIDER_UNAVAILABLE_MESSAGE =
  "Mira's AI service isn't available right now, so I couldn't answer. Your message was saved - please try again in a few minutes. If this keeps happening, let your school administrator know.";

async function buildContextMessages({ tenant, userText, history, classScope }) {
  const calendar = await loadSchoolCalendar(tenant.organizationId);
  const today = formatDay(new Date());
  const calendarLine = calendar
    ? `The current school year is ${calendar.yearLabel} and the current term is ${calendar.termName}${calendar.startDate && calendar.endDate ? ` (${formatDay(calendar.startDate)} to ${formatDay(calendar.endDate)})` : ""}.`
    : "No current term is set for this school - if a request depends on the term, ask which one.";

  const messages = [
    {
      role: "system",
      content: `Today is ${today}. ${calendarLine} The user is ${tenant.displayName}${tenant.userEmail ? ` (${tenant.userEmail})` : ""}, role: ${tenant.roleLabel}, at ${tenant.organizationName}. Never ask who they are. Their permissions are checked by each tool; if asked about their own access, answer from this identity.`,
    },
  ];

  // Managira documentation relevant to this message. The previous user turn
  // is folded into the search so a short follow-up ("where's that from?")
  // still retrieves on-topic articles. Best-effort.
  try {
    const priorUserTurn = [...history].reverse().find((message) => message.role === "user");
    const query = stripAttachmentBlocks(userText);
    const retrievalQuery = priorUserTurn ? `${priorUserTurn.content}\n${query}` : query;
    const matches = await retrieveContext({ tenantId: tenant.organizationId, query: retrievalQuery, limit: 4 });
    if (matches.length) {
      messages.push({
        role: "system",
        content: `Relevant indexed context from Managira's official documentation (authoritative - answer from it directly):\n${matches.map((match) => `- ${match.content}`).join("\n")}`,
      });
    }
  } catch (error) {
    console.error("[mira/orchestrator] documentation search failed, continuing without it:", error.message);
  }

  if (classScope?.className) {
    messages.push({
      role: "system",
      content: `The user has selected the class "${classScope.className}" as the focus for this turn. Search and act within this class first for class-related requests. If they explicitly ask about another class, all classes, or the whole school, follow that instead.`,
    });
  }

  const customInstructions = await loadCustomInstructions(tenant);
  if (customInstructions) {
    messages.push({
      role: "system",
      content: `The user's standing instructions for every response (they never override staying on-topic or within this school): ${customInstructions}`,
    });
  }

  return messages;
}

// Images attached in a chat stay available to tools for a while, so a
// follow-up like "yes, publish it" can still use the photo sent earlier.
// Memory only (images are never stored), small and short-lived.
const RECENT_IMAGES_TTL_MS = 30 * 60 * 1000;
const RECENT_IMAGES_MAX_CHATS = 40;
const recentImagesByChat = new Map();

function imagesForTools(chatId, images) {
  const now = Date.now();
  if (images?.length) {
    recentImagesByChat.delete(chatId);
    recentImagesByChat.set(chatId, { images, at: now });
    while (recentImagesByChat.size > RECENT_IMAGES_MAX_CHATS) {
      recentImagesByChat.delete(recentImagesByChat.keys().next().value);
    }
    return images;
  }
  const cached = recentImagesByChat.get(chatId);
  if (cached && now - cached.at < RECENT_IMAGES_TTL_MS) return cached.images;
  recentImagesByChat.delete(chatId);
  return [];
}

// sse: { send(event, data) } - a thin wrapper the route layer provides so
// this module has no direct knowledge of Express's response object.
async function runTurn({ tenant, chatId, userText, sse, classScope, images }) {
  const budget = await checkBudget(tenant.organizationId);
  if (!budget.allowed) {
    sse.send("error", { message: budget.reason });
    return;
  }

  const chat = await getOrCreateChat({ tenant, chatId, firstMessage: userText });
  const history = await loadHistory(chat.id);
  const userMessage = await saveMessage(chat.id, "user", userText, undefined, classScope);
  const toolImages = imagesForTools(chat.id, images);

  sse.send("chat", { chatId: chat.id, title: chat.title, pinned: chat.pinned, userMessageCreatedAt: userMessage.createdAt });

  const contextMessages = await buildContextMessages({ tenant, userText, history: history.summary, classScope });

  // Only the current turn's message can carry images - history is always
  // plain text, since images are never persisted.
  const currentUserContent = images?.length
    ? [{ type: "text", text: userText }, ...images.map((image) => ({ type: "image", image }))]
    : userText;

  // Tools for this turn: core + the areas this conversation is about (see
  // toolSelector.js). load_tools adds areas mid-turn.
  const allSchemas = listToolSchemas();
  const areas = selectAreas({ userText, history: history.summary });

  // Multi-step tool loop: a request can need several tool calls, and one
  // round can contain several parallel calls - all are executed and answered
  // before the next round. Capped so a stuck model can't loop at the
  // school's expense; the final round has no tools so the turn always ends
  // in a reply.
  const MAX_TOOL_ROUNDS = 8;
  let workingMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...contextMessages, ...history.forModel, { role: "user", content: currentUserContent }];
  let assistantText = "";
  let turnFailed = false;
  const toolCallsThisTurn = [];
  let toolResultChars = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const toolCallsInfo = [];
    assistantText = "";
    const roundTools = round < MAX_TOOL_ROUNDS ? selectToolSchemas(allSchemas, areas) : [];

    let pass;
    try {
      pass = await streamCompletion({
        task: "default",
        messages: workingMessages,
        tools: roundTools,
        onToken: (text) => {
          assistantText += text;
          sse.send("token", { text });
        },
        onToolCall: (name, args, id) => {
          // Ids are kept to letters, digits, _ and - (some providers use
          // ids like "functions.get_term:0", which others reject).
          const safeId = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "_") || `call_${round}_${toolCallsInfo.length}`;
          toolCallsInfo.push({ name, args, id: safeId });
        },
      });
    } catch (error) {
      console.error("[mira/orchestrator] no AI provider could answer:", error.message);
      if (!assistantText.trim()) {
        turnFailed = true;
        sse.send("error", { message: PROVIDER_UNAVAILABLE_MESSAGE });
      }
      break;
    }

    await recordUsage({
      tenantId: tenant.organizationId,
      userId: tenant.userId,
      provider: pass.provider,
      model: pass.model,
      promptTokens: pass.usage?.promptTokens || pass.usage?.prompt_tokens || pass.usage?.input_tokens || 0,
      completionTokens: pass.usage?.completionTokens || pass.usage?.completion_tokens || pass.usage?.output_tokens || 0,
    }).catch((err) => console.error("[mira/orchestrator] usage recording failed:", err.message));

    if (!toolCallsInfo.length) break;

    const results = [];
    for (const toolCallInfo of toolCallsInfo) {
      // load_tools is handled here: it widens this turn's tool list.
      if (toolCallInfo.name === LOAD_TOOLS_NAME) {
        const requested = normalizeRequestedAreas(toolCallInfo.args);
        requested.forEach((area) => areas.add(area));
        const loaded = requested.length
          ? `Loaded: ${requested.join(", ")}. These tools are now available: ${[...toolNamesForAreas(new Set(requested))].join(", ")}.`
          : "No valid area given - choose from the areas listed in this tool's description.";
        results.push({ toolCallId: toolCallInfo.id, content: loaded });
        continue;
      }

      sse.send("tool_call", { name: toolCallInfo.name, args: toolCallInfo.args });
      // Images attached to this turn reach tools through `context`, never
      // as model-typed arguments (see tools/index.js runTool).
      const { status, result } = await runTool(toolCallInfo.name, toolCallInfo.args, tenant, { images: toolImages, classScope });
      const summary = summarizeToolResult(toolCallInfo.name, result);
      await logToolCall({ tenant, chatId: chat.id, toolName: toolCallInfo.name, args: toolCallInfo.args, status, resultSummary: summary });
      sse.send("tool_result", { name: toolCallInfo.name, status, result });

      // Kept with the reply so later turns can see what was found.
      const budgetLeft = TOOL_RESULTS_PER_TURN_MAX_CHARS - toolResultChars;
      const stored = compactToolResult(result, Math.max(400, Math.min(TOOL_RESULT_MAX_CHARS, budgetLeft)));
      toolResultChars += stored.length;
      toolCallsThisTurn.push({ name: toolCallInfo.name, args: toolCallInfo.args, status, result: stored });
      results.push({ toolCallId: toolCallInfo.id, content: JSON.stringify(result) });
    }

    // Real tool-calling protocol (see modelRouter.js toOpenAIMessages /
    // toAnthropicMessages) so parallel calls stay paired with their results.
    workingMessages = [
      ...workingMessages,
      { role: "assistant", content: null, toolCalls: toolCallsInfo.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })) },
      { role: "tool_results", results },
    ];
  }

  if (turnFailed) {
    // Keep what the tools already found so the next turn can continue.
    if (toolCallsThisTurn.length) await saveMessage(chat.id, "assistant", "", toolCallsThisTurn, classScope);
    return;
  }

  const assistantMessage = await saveMessage(chat.id, "assistant", assistantText, toolCallsThisTurn.length ? toolCallsThisTurn : undefined, classScope);

  sse.send("done", { chatId: chat.id, messageId: assistantMessage.id, createdAt: assistantMessage.createdAt, classScope: classScope || null });
}

module.exports = { runTurn, loadHistory, deriveTitle };
