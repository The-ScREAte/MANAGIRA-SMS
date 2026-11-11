// Per-turn orchestration: persist the user's message, run the model+tools
// loop, stream the reply over SSE, persist the assistant's reply + any
// tool calls to the audit log.
const db = require("../config/db");
const { ensureMiraSchema } = require("../db/schema");
const { streamCompletion } = require("./modelRouter");
const { listToolSchemas, runTool, REGISTRY } = require("../tools");
const REGISTRY_NAMES = new Set(Object.keys(REGISTRY));
const { retrieveContext } = require("./ragService");
const { checkBudget, recordUsage } = require("./usageLedger");
const { callInternalApi } = require("../internalApiClient");
const { loadAccess, checkTool, describeAccess } = require("./access");
const { unsupportedFigures, wrongWeekdays, unsupportedDates } = require("./grounding");
const { needsPlan, planTurn, planForModel, toolStepLabel } = require("./planner");
const {
  LOAD_TOOLS_NAME,
  selectAreas,
  selectToolSchemas,
  normalizeRequestedAreas,
  toolNamesForAreas,
  isDestructiveTool,
  destructiveAllowed,
  blockedIntents,
} = require("./toolSelector");

const SYSTEM_PROMPT = `You are Mira, Managira's AI assistant for school staff: you find records, explain data, draft communications and make changes through your tools. Only ever act within the current user's own school. Be warm, clear and professional.

## Scope
- Unless the user names another term or school year, everything is about the CURRENT school year and term (given below). Say which term a figure is for when it matters.
- Stay on Managira and school-administration topics; decline anything else in one short sentence.
- You can work on Admissions & Students, Guardians, Attendance, Assessments & Grading, Report Cards & Merit Sheets, Statistics, Enrollment & Promotion, Employees, Transportation, Events & Announcements, Class Activities, the Calendar, School Years/Terms/Classes/Subjects, the public School Website, Docs & Sheets and school settings. You only see the tools for the current topic; if you need another area, call load_tools - never tell the user you can't do something before checking. You report integration status (Google Classroom, WhatsApp, SMS, Student Portal, Transportation) but don't connect or configure them.

## Conversation
- This is one continuous conversation. Earlier messages, your earlier tool calls and their results are all above - use them. In a long chat the oldest messages are given in shortened form under "Earlier in this conversation"; they still count.
- Keep track of what was settled: the class, term, students, records and choices already found or agreed stay in force for later messages ("them", "those families", "the same class") until the person changes them.
- A short reply ("yes", "no", "ok", "go ahead", "the first one", "both", "do it", a bare name or number) answers YOUR most recent question. Resolve it from that question and carry out the plan you proposed with the exact same details (student, class, term, file) - never make the user repeat themselves, and never ask the same thing twice.
- "No, I meant X" means your last answer missed - fix it, don't repeat it.
- Only ask when something is genuinely missing or ambiguous, or before a destructive action. Ask one clear question that restates what you already know. Never ask permission for a lookup - just do it, and chain every tool call a request needs in the same turn.
- For a compound request, work out the whole plan first and present it once; a clear yes confirms the whole plan.

## Actions
- Never guess a required value. Creating/renaming/adding is not destructive: once every value is known, do it.
- Never fill in details the person didn't give (a location, a description, a time, an amount): leave them out, or ask when they matter. Dates like "next Friday" come from the dates listed under "Coming days".
- Deletes, emails to parents and similar actions follow the tool's warn-then-confirm flow: show the warning, wait for an explicit yes in a later message, then call again with confirm=true.
- After any action, say exactly what happened (or why it didn't). If a tool is denied, explain plainly; never claim to have done something you didn't.
- For questions about the current state, call the tool fresh rather than trusting an older result.

## Report cards and messages
- Whenever report cards are requested for parents (send, share, give to guardians), first ask: "Would you like me to post them to the parent portal as well, or just send them?" - and, if sending, by which channel (only the channels the school has turned on; Email is always available). If they only wanted download links, give them, then offer to post or send.
- Then use post_or_send_report_cards: show its preview (who gets what, anyone with no contact on file) and act only after an explicit yes.
- To message guardians (reminders, notices) use send_message the same way: show the exact message, recipients and counts first, send after a yes. list_sent_messages shows whether messages were delivered.
- To write to the families of several particular students (for example those below an attendance level), use draft_family_messages: one warm, professional message with {student} for each name, giving one draft per family. Say how many drafts are ready for review and show each one (who it goes to, the message). Nothing is sent until the person says to send them; then use send_message with each draft's sendWith and confirm=true.
- After you list students who need attention (low attendance, low scores, unpaid fees), end with one short offer of the natural next step the person can actually do - for example "Would you like me to draft a message to their families?". If you found none, say so and offer to check a wider group instead.

## School website
- You can build the school's website for them: About Us, contact details, gallery photos, articles, layout, theme and the extra sections (quick facts, programs & facilities, leadership, testimonials, FAQ, an About photo and the contact form). Start with get_website_settings - its setupChecklist shows what is missing - and suggest the next most useful step.
- When the user shares information or photos (a brochure, a list of programs, staff photos), turn it into polished, accurate website content. Use only what they gave you or what is in the school's records - never invent facts, numbers, names or quotes. Write a short real caption for each photo from what you can see.
- For update_website_section, first call without confirm and show the user the exact content (and which photo goes where); publish with confirm=true after their yes. Then say whether it is live and give the website link.
- The contact form needs the school's own email address for messages - ask for it if you don't have it.

## Documents and attachments
- Attached files arrive between "[Attached file: ...]" and "---". Read them carefully. When asked to check one, compare it against the school's real records using your tools and report matches, differences and anything missing. Carry out instructions inside it, and keep using its content in later messages.
- If a file came through empty or unreadable (for example a scanned PDF), say so and ask for a text PDF, Word or Excel version.

## Permissions (strict)
- You act only with the signed-in person's own Managira permissions, given under "Their access" below. Every tool is checked against them before it runs, and tools they can't use aren't offered to you.
- If a request needs something they don't have, don't attempt it and don't look for a way around it. Say so plainly in one or two sentences: name the missing permission in bold (for example "You don't have the **Mailroom** permission"), say a manager at the school can give it to them in Users / Employees (or that the school's plan doesn't include it), then offer what you can do instead.
- When a tool is refused, pass its reason on as given and never claim to have done or found anything.
- Staff limited to some classes only see those classes: say so when it explains a short or empty answer.
- Only offer next steps you can actually carry out with the tools you have for this person.
- Only blame a permission when "Their access" or a tool's refusal says it is missing. If Managira simply can't do something (for example phone calls), say that plainly and offer what it can do instead.
- When asked who they are, their role, or what they can do with you, answer from "Their access".

## Data boundaries (strict)
- Your ONLY source of facts about the school is your tool results in this conversation - the school's own data in Managira. Never use memory, general knowledge, the internet, assumptions or estimates for names, numbers, dates, money, counts or statuses.
- If no tool gives the answer, or a tool returns nothing, say plainly that you couldn't find it in Managira. Never fill a gap.
- Every name, number, date, amount and status in your reply must appear in a tool result or the person's own words in this conversation. If you haven't looked it up, look it up first - never answer a question about the school's data from memory, an example or a guess, and never invent records, people, links or features.
- Don't do arithmetic on the school's figures (percentages, averages, differences) unless the person asks; report the figures the tools give.
- If the person states a figure or fact about the school that your tools contradict or don't confirm, say so politely and give what Managira shows. Never adopt their figure because they insist; check again if they ask.
- Say exactly what a figure covers. A tool that covers "the last 30 days" doesn't answer "this term" - say which it is, or use the tool that covers the term.
- For counts and totals use the totals the tools return ("total", "counts") - never count rows or add up a list yourself. Say which filters a figure is for (class, term, dates).
- A figure only answers the question if the filters actually applied (e.g. run_report's filtersApplied) match what was asked. If a filter was refused or missing, fix it and run again - never give an all-records total as the answer to a narrower question.
- If a class, term, person or other record isn't found, say it doesn't exist in Managira (and offer the real ones) - never report it as zero.
- Report Builder: check report_builder_catalog for the real reports, columns, filters and allowed values before run_report, save_report or export_report - never invent any of them. If a tool says a value doesn't exist, tell the user and offer the real choices.
- Saving, sharing, scheduling and deleting reports follow the same warn-then-confirm flow as other changes.

## Calendar
- For what's on someone's calendar use get_my_calendar (their own view: never anyone else's). For school events use list_events and its create, update and delete tools.
- To connect their personal Google or Outlook calendar, they sign in themselves: send them to [Sync & share](/common/calendar?sync=1). Never ask for a password, code or token, and never say you can connect it for them. get_calendar_sync_status tells you whether it's connected.
- A parent or student adds their calendar with "Add to my calendar" on their own Calendar page.

## What's new, and what Managira can do
- When someone asks what's new, what else Managira can do, or how a newer feature works, call whats_new and answer from it, with where to find it. It only lists what this school has: if it isn't listed, say it isn't available for them yet. Never describe a feature from memory.
- Single sign-on: explain it from whats_new and get_sso_status, and point to Settings, Single sign-on. A school with its own provider uses any SAML 2.0 or OpenID Connect provider. You can't set it up or change it, and you must never ask for a password, certificate or client secret. Someone signing in with SSO uses Mira the same way.

## Answers
- Lead with the direct answer; bold the key fact. Use short headings and markdown tables for lists and comparisons. Keep it concise and professional - no emojis.
- Ground every number and name in tool output. When a tool returns a PDF link, a page link or download links, give them as markdown links. Embed chart image URLs with markdown image syntax.
- When "Relevant indexed context" from Managira's documentation or a help guide is provided, answer from it confidently, in your own words, and give the guide's link as a markdown link; without it, say you don't have that detail rather than guessing. Never describe menus, buttons or steps that aren't in a guide or a tool result.`;

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
  if (schoolContextCache.size >= 1000) schoolContextCache.delete(schoolContextCache.keys().next().value);
  schoolContextCache.set(organizationId, { value, expiresAt: Date.now() + SCHOOL_CONTEXT_TTL_MS });
  return value;
}

// The next two weeks, each with its weekday, so "next Friday" is never worked out by hand.
function comingDays(from = new Date()) {
  const days = [];
  for (let offset = 1; offset <= 14; offset++) {
    const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset));
    days.push(`${day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} = ${day.toISOString().slice(0, 10)}`);
  }
  return days.join("; ");
}

// Managira's help guides, the same ones the help center and its chat answer from (read from
// code, once). A how-to question gets the part of the guide that answers it.
const HOW_TO = /^\s*(how|where|what (is|are|does)|what's|whats|why (can't|cant|doesn't|does|is|isn't)|can (i|we|you|parents|teachers|students|staff)|is (it|there) (possible|a way)|explain|steps to|help me (to )?(set|add|find|change|turn|connect|use))\b|\bhow (do|can|to|does)\b/i;
let helpGuides = null;
function helpGuideFor(userText) {
  const question = stripAttachmentBlocks(userText).trim();
  if (!question || question.length > 300 || !HOW_TO.test(question)) return null;
  try {
    if (!helpGuides) helpGuides = require("../../utils/docs/catalog").syncRows();
    const result = require("../../utils/docs/askDocs").ask(question, helpGuides);
    if (result.type !== "answer" || !["sure", "likely"].includes(result.confidence)) return null;
    if (!String(result.source.url || "").startsWith("/legal/user-documentation/")) return null;
    return result;
  } catch (error) {
    console.error("[mira/orchestrator] help guides unavailable, continuing without them:", error.message);
    return null;
  }
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
const HISTORY_MESSAGES = 24;
// Older messages, up to this many more, are kept as a short digest so a
// long chat still remembers what was settled early on.
const DIGEST_MESSAGES = 60;
const DIGEST_LINE_MAX_CHARS = 220;
const DIGEST_MAX_CHARS = 6000;
const TURNS_WITH_TOOL_DETAIL = 5;
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

// The oldest messages of a long chat, one short line each: enough for Mira
// to keep the names, classes and decisions settled early on.
function buildDigest(olderRows) {
  const lines = olderRows.map((row) => {
    const text = stripAttachmentBlocks(row.content).replace(/\s+/g, " ").trim();
    const short = text.length > DIGEST_LINE_MAX_CHARS ? `${text.slice(0, DIGEST_LINE_MAX_CHARS)}...` : text;
    const tools = (Array.isArray(row.tool_calls) ? row.tool_calls : []).map((call) => call.name).filter(Boolean);
    const used = tools.length ? ` [looked up with: ${[...new Set(tools)].join(", ")}]` : "";
    return `${row.role === "user" ? "Person" : "Mira"}: ${short || "(no text)"}${used}`;
  });
  let digest = lines.join("\n");
  // Keep the newest part of the digest if it is still too long.
  if (digest.length > DIGEST_MAX_CHARS) digest = `...\n${digest.slice(digest.length - DIGEST_MAX_CHARS)}`;
  return digest;
}

async function loadHistory(chatId) {
  const result = await db.query(
    `SELECT id, role, content, tool_calls FROM mira_chat_messages WHERE chat_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${HISTORY_MESSAGES + DIGEST_MESSAGES}`,
    [chatId]
  );
  const all = result.rows.reverse();
  const rows = all.slice(-HISTORY_MESSAGES);
  const digest = all.length > HISTORY_MESSAGES ? buildDigest(all.slice(0, all.length - HISTORY_MESSAGES)) : "";

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

  return { forModel, summary, digest };
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

// The documentation search is a help, not a requirement: a slow one is skipped, not waited for.
const DOCS_SEARCH_LIMIT_MS = 900;
function searchDocs({ tenant, userText, history }) {
  const priorUserTurn = [...history].reverse().find((message) => message.role === "user");
  const query = stripAttachmentBlocks(userText);
  // The previous user turn is folded in so a short follow-up ("where's that from?") stays on topic.
  const retrievalQuery = priorUserTurn ? `${priorUserTurn.content}\n${query}` : query;
  let timer;
  const tooSlow = new Promise((resolve) => { timer = setTimeout(() => resolve([]), DOCS_SEARCH_LIMIT_MS); });
  const search = retrieveContext({ tenantId: tenant.organizationId, query: retrievalQuery, limit: 4 }).catch((error) => {
    console.error("[mira/orchestrator] documentation search failed, continuing without it:", error.message);
    return [];
  });
  return Promise.race([search, tooSlow]).finally(() => clearTimeout(timer));
}

async function buildContextMessages({ tenant, userText, history, classScope, access, digest }) {
  // All at once: each is a round trip, and the person is waiting.
  const [calendar, matches, customInstructions] = await Promise.all([
    loadSchoolCalendar(tenant.organizationId),
    searchDocs({ tenant, userText, history }),
    loadCustomInstructions(tenant),
  ]);
  const today = formatDay(new Date());
  const calendarLine = calendar
    ? `The current school year is ${calendar.yearLabel} and the current term is ${calendar.termName}${calendar.startDate && calendar.endDate ? ` (${formatDay(calendar.startDate)} to ${formatDay(calendar.endDate)})` : ""}.`
    : "No current term is set for this school - if a request depends on the term, ask which one.";

  const messages = [
    {
      role: "system",
      content: `Today is ${today}. Coming days: ${comingDays()}. ${calendarLine} The user is ${tenant.displayName}${tenant.userEmail ? ` (${tenant.userEmail})` : ""}, role: ${tenant.roleLabel}, at ${tenant.organizationName}. Never ask who they are.\n\nTheir access: ${describeAccess(tenant, access)}`,
    },
  ];

  if (digest) {
    messages.push({ role: "system", content: `Earlier in this conversation (older messages, shortened - they still count):\n${digest}` });
  }

  const guide = helpGuideFor(userText);
  if (guide) {
    const where = guide.source.section ? `${guide.source.title} › ${guide.source.section}` : guide.source.title;
    const steps = guide.answer.mode === "steps" ? guide.answer.lines.map((line, index) => `${index + 1}. ${line}`).join(" ") : guide.answer.lines.join(" ");
    messages.push({
      role: "system",
      content: `Relevant indexed context from Managira's help guide "${where}": ${guide.answer.title && guide.answer.title !== guide.source.section ? `${guide.answer.title}: ` : ""}${steps} If it answers the question, answer from it and end with this link on its own line: [Read the guide: ${guide.source.title}](${guide.source.url})`,
    });
  }

  if (matches.length) {
    messages.push({
      role: "system",
      content: `Relevant indexed context from Managira's official documentation (authoritative - answer from it directly):\n${matches.map((match) => `- ${match.content}`).join("\n")}`,
    });
  }

  if (classScope?.className) {
    messages.push({
      role: "system",
      content: `The user has selected the class "${classScope.className}" as the focus for this turn. Search and act within this class first for class-related requests. If they explicitly ask about another class, all classes, or the whole school, follow that instead.`,
    });
  }

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

function usageOf(tenant, pass) {
  if (!pass) return Promise.resolve();
  return recordUsage({
    tenantId: tenant.organizationId,
    userId: tenant.userId,
    provider: pass.provider,
    model: pass.model,
    promptTokens: pass.usage?.promptTokens || pass.usage?.prompt_tokens || pass.usage?.input_tokens || 0,
    completionTokens: pass.usage?.completionTokens || pass.usage?.completion_tokens || pass.usage?.output_tokens || 0,
  }).catch((err) => console.error("[mira/orchestrator] usage recording failed:", err.message));
}

// At most about a second, in up to 40 pieces cut at spaces.
const RELEASE_PIECES = 40;
const RELEASE_GAP_MS = 22;
async function releaseAnswer(sse, text) {
  const words = String(text || "").split(/(?<=\s)/);
  if (!words.length || !text) return;
  const per = Math.max(1, Math.ceil(words.length / RELEASE_PIECES));
  for (let index = 0; index < words.length; index += per) {
    if (sse.closed && sse.closed()) return;
    sse.send("token", { text: words.slice(index, index + per).join("") });
    if (index + per < words.length) await new Promise((resolve) => setTimeout(resolve, RELEASE_GAP_MS));
  }
}

// sse: { send(event, data) } - a thin wrapper the route layer provides so
// this module has no direct knowledge of Express's response object.
async function runTurn({ tenant, chatId, userText, sse, classScope, images }) {
  const budget = await checkBudget(tenant.organizationId);
  if (!budget.allowed) {
    sse.send("error", { message: budget.reason });
    return;
  }

  // Their own permissions decide which tools exist for them this turn.
  const accessPromise = loadAccess(tenant);
  const chat = await getOrCreateChat({ tenant, chatId, firstMessage: userText });
  // History is read first: it must not include the message being saved now.
  const history = await loadHistory(chat.id);
  const userMessage = await saveMessage(chat.id, "user", userText, undefined, classScope);
  const toolImages = imagesForTools(chat.id, images);

  sse.send("chat", { chatId: chat.id, title: chat.title, pinned: chat.pinned, userMessageCreatedAt: userMessage.createdAt });

  const access = await accessPromise;
  // Steps (feature mira_steps): Mira understands and plans the message first, shows each step
  // as it works, and the answer appears only once it has been checked.
  const showSteps = Boolean(access.features && access.features.mira_steps);
  const step = (id, label, status, detail) => {
    if (showSteps) sse.send("step", detail ? { id, label, status, detail } : { id, label, status });
  };
  const planning = showSteps && needsPlan(userText);
  if (planning) step("understand", "Understanding your request", "active");
  const [contextMessages, plan] = await Promise.all([
    buildContextMessages({ tenant, userText, history: history.summary, classScope, access, digest: history.digest }),
    planning ? planTurn({ userText, history: history.summary, tenant, classScope, onUsage: (pass) => usageOf(tenant, pass) }) : null,
  ]);
  if (planning) {
    if (plan) {
      step("understand", "Understood your request", "done", plan.understanding);
      if (plan.steps.length) sse.send("plan", { steps: plan.steps });
      contextMessages.push({ role: "system", content: planForModel(plan) });
    } else {
      step("understand", "Understood your request", "done");
    }
  }
  // A tool is offered when the person may use it, and - for one that
  // deletes, removes or undoes - only when they asked for that.
  const mayDestroy = destructiveAllowed(userText, history.summary);
  const allowed = (name) => checkTool(name, tenant, access).allowed && (!isDestructiveTool(name) || mayDestroy);
  // A request that needs a permission they don't have: Mira says so first.
  blockedIntents(userText, (name) => checkTool(name, tenant, access).allowed).forEach((intent) => {
    contextMessages.push({
      role: "system",
      content: `This message is about ${intent.what}, which this person can't do: ${checkTool(intent.tools[0], tenant, access).reason} Say that plainly in your first sentence. Don't draft it, don't ask for details and don't offer to do it; offer something they can do instead.`,
    });
  });

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
  const MAX_TOOL_CALLS_PER_TURN = 12;
  let workingMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...contextMessages, ...history.forModel, { role: "user", content: currentUserContent }];
  let assistantText = "";
  let turnFailed = false;
  const toolCallsThisTurn = [];
  let toolResultChars = 0;
  // Everything a reply may rest on: this turn's tool results, the history
  // (with its replayed results), the context and the person's own words.
  const evidence = [userText, ...contextMessages.map((m) => String(m.content || "")), JSON.stringify(history.forModel)];
  let revised = false;
  const callsThisTurn = new Set();

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const toolCallsInfo = [];
    assistantText = "";
    const roundTools = round < MAX_TOOL_ROUNDS ? selectToolSchemas(allSchemas, areas, allowed) : [];
    let writing = false;

    let pass;
    try {
      pass = await streamCompletion({
        task: "default",
        messages: workingMessages,
        tools: roundTools,
        onToken: (text) => {
          assistantText += text;
          if (!showSteps) sse.send("token", { text });
          else if (!writing) {
            writing = true;
            step(`write-${round}`, "Writing the answer", "active");
          }
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

    await usageOf(tenant, pass);

    if (!toolCallsInfo.length) {
      // Grounding check: a figure that appears in no tool result and no
      // message is sent back once for correction before the reply stands.
      const checking = !revised && round < MAX_TOOL_ROUNDS;
      const unsupported = checking ? unsupportedFigures(assistantText, evidence) : [];
      const wrongDays = checking ? wrongWeekdays(assistantText) : [];
      const unsupportedDays = checking ? unsupportedDates(assistantText, evidence) : [];
      if (writing) step(`write-${round}`, revised ? "Rewrote the answer using only your school's records" : "Wrote the answer", "done");
      if (!unsupported.length && !wrongDays.length && !unsupportedDays.length) {
        if (checking) step("check", "Checked the answer against your school's records", "done");
        break;
      }
      revised = true;
      console.warn(`[mira/orchestrator] reply needs a correction: ${[...unsupported, ...unsupportedDays, ...wrongDays].join(", ")}`);
      if (showSteps) step("check", unsupported.length ? "Found a figure that isn't in your school's records" : unsupportedDays.length ? "Found a date that isn't in your school's records" : "Found a date with the wrong weekday", "failed");
      else sse.send("revise", {});
      const problems = [
        unsupported.length ? `these figures in your reply don't appear in any tool result or message in this conversation: ${unsupported.join(", ")}. Either call the tool that gives them, or leave them out and say plainly what you couldn't find in Managira.` : "",
        unsupportedDays.length ? `these dates in your reply don't appear in any tool result or message: ${unsupportedDays.join(", ")}. Read each date again from the tool results (a date of birth like 2011-05-09 is May 9), or leave it out.` : "",
        wrongDays.length ? `these weekdays don't match their dates: ${wrongDays.join("; ")}. Use the right weekday (see "Coming days") or leave the weekday out.` : "",
      ].filter(Boolean).join(" Also, ");
      workingMessages = [
        ...workingMessages,
        { role: "assistant", content: assistantText },
        {
          role: "system",
          content: `Check before this reaches the person: ${problems} Write the reply again. Keep everything that is correct. Give only the corrected reply - don't mention this check.`,
        },
      ];
      continue;
    }

    if (writing) {
      const thought = assistantText.replace(/\s+/g, " ").trim();
      step(`write-${round}`, "Thought it through", "done", thought.length > 240 ? `${thought.slice(0, 240)}...` : thought);
    }

    const results = [];
    for (const toolCallInfo of toolCallsInfo) {
      // The same call twice in one message is answered from the first, and
      // a message has a ceiling on tool calls: Mira never keeps trying.
      const callKey = `${toolCallInfo.name}:${JSON.stringify(toolCallInfo.args || {})}`;
      if (callsThisTurn.has(callKey)) {
        results.push({ toolCallId: toolCallInfo.id, content: `You already called ${toolCallInfo.name} with exactly these details in this message - use that result and don't call it again.` });
        continue;
      }
      callsThisTurn.add(callKey);
      if (toolCallInfo.name !== LOAD_TOOLS_NAME && callsThisTurn.size > MAX_TOOL_CALLS_PER_TURN) {
        results.push({ toolCallId: toolCallInfo.id, content: "That's enough lookups for one message. Answer now with what you have, and say what you couldn't check." });
        continue;
      }
      if (toolCallInfo.name !== LOAD_TOOLS_NAME && REGISTRY_NAMES.has(toolCallInfo.name) && !allowed(toolCallInfo.name)) {
        const gate = checkTool(toolCallInfo.name, tenant, access);
        results.push({ toolCallId: toolCallInfo.id, content: gate.allowed ? `${toolCallInfo.name} wasn't offered because the person didn't ask to delete, remove or undo anything. Don't call it.` : gate.reason });
        continue;
      }
      // load_tools is handled here: it widens this turn's tool list.
      if (toolCallInfo.name === LOAD_TOOLS_NAME) {
        const requested = normalizeRequestedAreas(toolCallInfo.args);
        requested.forEach((area) => areas.add(area));
        const names = [...toolNamesForAreas(new Set(requested))];
        const usable = names.filter(allowed);
        const refused = names.filter((name) => !allowed(name)).map((name) => `${name} (${checkTool(name, tenant, access).reason})`);
        const loaded = requested.length
          ? `Loaded: ${requested.join(", ")}. These tools are now available: ${usable.join(", ") || "none"}.${refused.length ? ` Not available to this person: ${refused.join("; ")}` : ""}`
          : "No valid area given - choose from the areas listed in this tool's description.";
        results.push({ toolCallId: toolCallInfo.id, content: loaded });
        continue;
      }

      const label = toolStepLabel(toolCallInfo.name, toolCallInfo.args);
      sse.send("tool_call", { name: toolCallInfo.name, args: toolCallInfo.args, label });
      // Images attached to this turn reach tools through `context`, never
      // as model-typed arguments (see tools/index.js runTool).
      const { status, result } = await runTool(toolCallInfo.name, toolCallInfo.args, tenant, { images: toolImages, classScope, access });
      const summary = summarizeToolResult(toolCallInfo.name, result);
      await logToolCall({ tenant, chatId: chat.id, toolName: toolCallInfo.name, args: toolCallInfo.args, status, resultSummary: summary });
      sse.send("tool_result", { name: toolCallInfo.name, status, result });

      // Kept with the reply so later turns can see what was found.
      const budgetLeft = TOOL_RESULTS_PER_TURN_MAX_CHARS - toolResultChars;
      const stored = compactToolResult(result, Math.max(400, Math.min(TOOL_RESULT_MAX_CHARS, budgetLeft)));
      toolResultChars += stored.length;
      toolCallsThisTurn.push({ name: toolCallInfo.name, args: toolCallInfo.args, status, result: stored, label });
      const content = compactToolResult(result, 24000);
      evidence.push(content);
      results.push({ toolCallId: toolCallInfo.id, content });
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

  // The checked answer is given in quick pieces, so it still reads as it arrives.
  if (showSteps) await releaseAnswer(sse, assistantText);

  const assistantMessage = await saveMessage(chat.id, "assistant", assistantText, toolCallsThisTurn.length ? toolCallsThisTurn : undefined, classScope);

  sse.send("done", { chatId: chat.id, messageId: assistantMessage.id, createdAt: assistantMessage.createdAt, classScope: classScope || null });
}

module.exports = { runTurn, loadHistory, deriveTitle, buildDigest, helpGuideFor, comingDays };
