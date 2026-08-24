// Per-turn orchestration: persist the user's message, run the model+tools
// loop, stream the reply over SSE, persist the assistant's reply + any
// tool calls to the audit log. RAG retrieval (phase 5) slots in right
// before the modelRouter call, once ragService exists; rate limiting and
// usage-cap checks (phase 5c) slot in right before that.
const db = require("../config/db");
const { ensureMiraSchema } = require("../db/schema");
const { streamCompletion } = require("./modelRouter");
const { listToolSchemas, runTool } = require("../tools");
const { retrieveContext } = require("./ragService");
const { checkBudget, recordUsage } = require("./usageLedger");

const SYSTEM_PROMPT = `You are Mira, Managira's AI assistant for school staff - finding records, drafting communications, summarizing data, and taking action via your tools. Only ever act within the current user's own school. Be concise and warm.

Your real capability span, so you never undersell yourself when asked "what can you do": Admissions & Students, Guardians, Attendance, Assessments & Grading, Report Cards & Merit Sheets, Enrollment, Promotion, Employees, Transportation, Announcements, School Years & Terms, Classes/Subjects/Graduation Year Groups, the public School Website, and Docs/Sheets - both looking things up and making real changes, via the full tool list available to you this turn. If asked what you can do, answer from that actual span and your live tool list, not a guess at a narrower scope. You do not activate/connect/configure integrations (Google Classroom, WhatsApp, SMS, Student Portal, Transportation) - only report their status.

Attached files arrive between "[Attached file: ...]" and "---" - read them and actually carry out any request/instruction inside, don't just describe the contents. If a tool call is denied, say why plainly; never claim to have done something you didn't.

Actions that change/delete data: never guess a required value - ask for what's missing. Deletes follow the tool's own warn-then-confirm flow exactly (your warning is not the user's consent - wait for their explicit go-ahead in a LATER message); creating/renaming/adding is not destructive, so once every value is known, just call the tool - no extra "please confirm" round. After any action, say specifically what happened (or why it didn't), not just "done."

For questions about CURRENT state (what's current, what's blocking, counts), call the tool fresh rather than trusting an earlier result in this conversation. Before saying you can't help, actually check each candidate tool's full description (not just its name) - many cover more than their name suggests via an optional parameter. A user saying "no, I mean X not Y" means your last answer missed the mark, not that they were unclear; don't repeat it. Never send someone to click through the UI for something a tool can already check or do.

Bold the specific fact that answers a question, and bold/isolate anything risky, permanent, or blocking. Use a table for side-by-side comparisons. Ground every claim in actual tool output, never invent or reconstruct from memory.

Only interrupt the user for information only they can give, or a destructive-action confirmation, or a tool-blocked decision - never to ask permission for a lookup that's part of fulfilling their request; just do it. Chain every tool call a request needs in one turn rather than one round-trip at a time.

Compound requests (several things in one message): work out the full plan and dependency order first, then lay it ALL out at once as a labeled list - never ask about one piece, get an answer, then discover you need another. If something is genuinely ambiguous, ask exactly one crisp labeled question, restating what's already understood so the user isn't repeating themselves. Once they give any clear affirmative, that confirms the WHOLE plan you just proposed - move to executing it (or the one remaining genuinely-missing piece); repeating a confirmation after a clear yes is a bug.

Stay on Managira and school-administration topics; decline anything else in one short, non-preachy sentence.

A "Relevant indexed context" block is real official Managira documentation - answer from it directly and confidently. Without one, say plainly you don't have that detail rather than guessing.`;

// A new chat's title is derived from the user's first question rather
// than left as "New chat" - no model call needed (works the same in mock
// mode), just a cleaned-up, truncated version of what they asked.
function deriveTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
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

// `ORDER BY created_at ASC LIMIT N` (the previous query) takes the OLDEST N
// messages - for any chat that ever grew past that cap, the model was
// permanently stuck seeing only the very first exchanges, never the actual
// recent conversation. Pulling the newest N (DESC) then re-reversing to
// chronological order for the prompt fixes that; the smaller cap also
// meaningfully cuts prompt-token cost per turn.
async function loadHistory(chatId) {
  const result = await db.query(
    `SELECT role, content FROM mira_chat_messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [chatId]
  );
  return result.rows.reverse().map((r) => ({ role: r.role, content: r.content }));
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

  sse.send("chat", { chatId: chat.id, title: chat.title, pinned: chat.pinned, userMessageCreatedAt: userMessage.createdAt });

  // RAG: pull in any previously-indexed content relevant to this message
  // (scoped to the caller's own tenant - vectorStore.search() enforces
  // this in SQL, not just in application code). Best-effort: indexing
  // failures should never block a chat turn.
  //
  // The retrieval query folds in the last user turn too, not just the
  // current message - a short follow-up like "where's that from?" or
  // "are you sure?" carries no topic keywords of its own, so search on
  // it alone. Including the prior turn keeps retrieval on-topic across
  // that kind of natural follow-up.
  let contextMessages = [];
  try {
    const priorUserTurn = [...history].reverse().find((m) => m.role === "user");
    const retrievalQuery = priorUserTurn ? `${priorUserTurn.content}\n${userText}` : userText;
    const matches = await retrieveContext({ tenantId: tenant.organizationId, query: retrievalQuery, limit: 4 });
    if (matches.length) {
      const contextText = matches.map((m) => `- ${m.content}`).join("\n");
      contextMessages = [{
        role: "system",
        content: `The following is pulled directly from Managira's own official documentation (FAQ / knowledge base). Treat it as authoritative and answer confidently from it - don't say you lack access to documentation when it's provided right here:\n${contextText}`,
      }];
    }
  } catch (error) {
    console.error("[mira/orchestrator] RAG retrieval failed, continuing without it:", error.message);
  }

  if (classScope?.className) {
    contextMessages.push({
      role: "system",
      content: `The user has selected the class "${classScope.className}" as the default focus for this turn. Search and act within this class first for class-related requests. If the user explicitly asks about another class, all classes, or an organization-wide topic, follow that broader request instead.`,
    });
  }

  const customInstructions = await loadCustomInstructions(tenant);
  if (customInstructions) {
    contextMessages.push({
      role: "system",
      content: `The user has set these standing instructions for you to follow in every response, in addition to everything above (they do not override staying on-topic or tenant-scoped): ${customInstructions}`,
    });
  }

  // Only the current turn's message can carry images - history loaded
  // from the DB is always plain text, since images are never persisted
  // (kept out of mira_chat_messages to avoid storing base64 blobs there).
  const currentUserContent = images?.length
    ? [{ type: "text", text: userText }, ...images.map((image) => ({ type: "image", image }))]
    : userText;
  const tools = listToolSchemas();

  // Multi-step tool loop: a single user request can legitimately need more
  // than one tool call (e.g. "create school year X with 3 terms" led the
  // model to first call get_term to see what's already there, then needed
  // a second call to actually create it) - previously this only allowed
  // exactly one tool call per turn (a hardcoded "first pass" + "second
  // pass" with tools:[] on the second), so the model's first, exploratory
  // tool call silently used up its only chance to act. A round can also
  // contain SEVERAL tool calls at once - models routinely call multiple
  // tools in parallel for a compound request ("create this class, this
  // subject, and these two grad year groups" naturally becomes 4 parallel
  // calls) - all of them are executed and answered before the next round.
  // Capped so a model that gets stuck can't loop indefinitely at cost to
  // the org's usage budget; the final, forced-text round (tools:[])
  // guarantees the turn always ends in a reply rather than a dropped call.
  const MAX_TOOL_CALLS_PER_TURN = 6;
  let workingMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...contextMessages, ...history, { role: "user", content: currentUserContent }];
  let assistantText = "";
  const toolCallsThisTurn = [];

  for (let round = 0; round <= MAX_TOOL_CALLS_PER_TURN; round++) {
    const toolCallsInfo = [];
    assistantText = "";
    const roundTools = round < MAX_TOOL_CALLS_PER_TURN ? tools : [];

    const pass = await streamCompletion({
      task: "default",
      messages: workingMessages,
      tools: roundTools,
      onToken: (text) => {
        assistantText += text;
        sse.send("token", { text });
      },
      onToolCall: (name, args, id) => {
        toolCallsInfo.push({ name, args, id });
      },
    });
    await recordUsage({
      tenantId: tenant.organizationId,
      userId: tenant.userId,
      provider: pass.provider,
      model: pass.model,
      promptTokens: pass.usage?.promptTokens || pass.usage?.prompt_tokens || 0,
      completionTokens: pass.usage?.completionTokens || pass.usage?.completion_tokens || 0,
    }).catch((err) => console.error("[mira/orchestrator] usage recording failed:", err.message));

    if (!toolCallsInfo.length) break;

    const results = [];
    for (const toolCallInfo of toolCallsInfo) {
      sse.send("tool_call", { name: toolCallInfo.name, args: toolCallInfo.args });
      // Images the user attached to this turn are passed via `context`, not
      // as tool args - the model never has to (and can't practically)
      // retype base64 image bytes as a tool-call parameter; a tool that
      // needs the actual pixels (e.g. upload_website_image) reads
      // context.images directly. See mira/tools/index.js's runTool header.
      const { status, result } = await runTool(toolCallInfo.name, toolCallInfo.args, tenant, { images, classScope });
      const summary = summarizeToolResult(toolCallInfo.name, result);
      await logToolCall({ tenant, chatId: chat.id, toolName: toolCallInfo.name, args: toolCallInfo.args, status, resultSummary: summary });
      sse.send("tool_result", { name: toolCallInfo.name, status, result });
      toolCallsThisTurn.push({ name: toolCallInfo.name, args: toolCallInfo.args, status });
      results.push({ toolCallId: toolCallInfo.id, content: JSON.stringify(result) });
    }

    // Real tool-calling protocol (not faked as plain text - see
    // modelRouter.js's toOpenAIMessages/toAnthropicMessages) so the model
    // has an unambiguous, structured signal that it's mid-tool-loop rather
    // than having to reinterpret prose each round, and so parallel calls
    // stay correctly paired with their own result instead of being
    // collapsed into one.
    workingMessages = [
      ...workingMessages,
      { role: "assistant", content: null, toolCalls: toolCallsInfo.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })) },
      { role: "tool_results", results },
    ];
  }

  const assistantMessage = await saveMessage(chat.id, "assistant", assistantText, toolCallsThisTurn.length ? toolCallsThisTurn : undefined, classScope);

  sse.send("done", { chatId: chat.id, messageId: assistantMessage.id, createdAt: assistantMessage.createdAt, classScope: classScope || null });
}

module.exports = { runTurn };
