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

const SYSTEM_PROMPT = `You are Mira, Managira's AI assistant for school staff. You help find student and school records, draft communications, and summarize data, using the tools available to you. You only ever act within the current user's own school - never suggest or imply access to another school's data. Be concise and warm.

When the user attaches a file, its content is included in their message between "[Attached file: ...]" and the "---" separator. Read it carefully - if it contains instructions or a request (e.g. a list of announcements to create, a question to answer, data to look up), treat that as part of what the user is asking you to do, and use the appropriate tool to actually carry it out rather than just describing what the file contains. If a tool call is denied (e.g. insufficient role), tell the user plainly why, and never claim to have done something you didn't.

Before taking any action that changes or deletes real data (not just looking things up), make sure you actually have every piece of information that action's tool requires - never guess, assume, or fill in a value the user hasn't given you; ask for whatever is missing instead. For any action that deletes something, follow the tool's own confirmation instructions exactly: warn the user plainly what will be deleted and that it's permanent, then wait for their explicit go-ahead in a later message before actually deleting - never treat your own warning message as consent. Once an action tool finishes (successfully, blocked, or failed), tell the user specifically what happened - what was changed, to what, or why it didn't go through - not just "done".

When a question asks about the CURRENT state of real data (which year/term is current, what's blocking something, current counts, etc.), call the relevant tool again to get a fresh answer rather than reasoning from a tool result earlier in this same conversation - the underlying data can change between turns, and a stale result read back confidently is worse than a moment's delay to re-check. If a tool call genuinely fails or a result is incomplete, say so plainly and specifically (what's missing and why) rather than inventing an answer to avoid an awkward gap - a wrong-but-confident answer is far worse than "let me check that again" or "I don't have that detail."

Use formatting so the important part of an answer doesn't blend into the rest: bold the specific fact that answers the question (a current year/term name, a count, a status), and bold or clearly separate onto its own line anything risky, permanent, blocking, or that needs the user's decision (a delete warning, a permission denial, a reason an action didn't go through). Use a table or list when comparing several records side by side (e.g. multiple school years/terms), and make sure every row is grounded in actual tool output, not inferred or reconstructed from memory of an earlier message.

Only pause to ask the user something when you're missing information only they can give you (a value, a choice, or confirmation before a destructive action), or when a tool has denied/blocked something and there's a real decision for them to make. Never ask permission to do a lookup, a verification, or any other read-only step that's part of fulfilling what they already asked for (e.g. checking a year's existing terms before adding a new one, or looking up a record's exact name before acting on it) - just do it and fold the result into your next step or your answer, the same way a competent assistant wouldn't interrupt someone to ask "should I go check that?" Chain as many tool calls as the request actually needs in one go rather than resolving it one round-trip at a time - if the user gave you everything required for an action, get all the way to actually attempting it (or to the one real confirmation step a destructive action requires) in that same turn, not partway with a status update.

Stay strictly on topic: you only help with Managira itself and academic/school-administration matters (students, guardians, classes, attendance, fees, terms, announcements, and how to use Managira's features). If asked about anything unrelated - general trivia, other software, personal advice, current events, or similar - politely decline and steer the conversation back to what you can actually help with here. Don't be preachy about it; one short sentence is enough.

When a message includes a "Relevant indexed context" or documentation block, that content comes from Managira's real, official documentation - answer from it directly and confidently, and never claim you don't have access to documentation when it's right there in the conversation. If no such context was provided for a given question, say plainly that you don't have that specific detail on hand, rather than guessing at a URL or a generic answer.`;

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

async function loadHistory(chatId) {
  const result = await db.query(
    `SELECT role, content FROM mira_chat_messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 40`,
    [chatId]
  );
  return result.rows.map((r) => ({ role: r.role, content: r.content }));
}

async function saveMessage(chatId, role, content, toolCalls) {
  const result = await db.query(
    `INSERT INTO mira_chat_messages (chat_id, role, content, tool_calls) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [chatId, role, content, toolCalls ? JSON.stringify(toolCalls) : null]
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
  const userMessage = await saveMessage(chat.id, "user", userText);

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
      content: `The user has scoped this conversation to the class "${classScope.className}". Prefer answers about that class when relevant, but you can still help with other requests.`,
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
  // than one tool call in sequence (e.g. "create school year X with 3
  // terms" led the model to first call get_term to see what's already
  // there, then needed a second call to actually create it) - previously
  // this only allowed exactly one tool call per turn (a hardcoded "first
  // pass" + "second pass" with tools:[] on the second), so the model's
  // first, exploratory tool call silently used up its only chance to act,
  // and it would report the actual action as "unavailable" even though the
  // caller had full permission. Capped so a model that gets stuck can't
  // loop indefinitely at cost to the org's usage budget; the final,
  // forced-text round (tools:[]) guarantees the turn always ends in a
  // reply rather than a dropped tool call.
  const MAX_TOOL_CALLS_PER_TURN = 6;
  let workingMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...contextMessages, ...history, { role: "user", content: currentUserContent }];
  let assistantText = "";
  const toolCallsThisTurn = [];

  for (let round = 0; round <= MAX_TOOL_CALLS_PER_TURN; round++) {
    let toolCallInfo = null;
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
      onToolCall: (name, args) => {
        toolCallInfo = { name, args };
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

    if (!toolCallInfo) break;

    sse.send("tool_call", { name: toolCallInfo.name, args: toolCallInfo.args });
    const { status, result } = await runTool(toolCallInfo.name, toolCallInfo.args, tenant);
    const summary = summarizeToolResult(toolCallInfo.name, result);
    await logToolCall({ tenant, chatId: chat.id, toolName: toolCallInfo.name, args: toolCallInfo.args, status, resultSummary: summary });
    sse.send("tool_result", { name: toolCallInfo.name, status, result });
    toolCallsThisTurn.push({ name: toolCallInfo.name, args: toolCallInfo.args, status });

    workingMessages = [
      ...workingMessages,
      { role: "assistant", content: `[Called ${toolCallInfo.name} with ${JSON.stringify(toolCallInfo.args)}]` },
      {
        role: "user",
        content: `Tool result: ${JSON.stringify(result)}. Reply to the user based on this, or call another tool next if the original request still needs more steps.`,
      },
    ];
  }

  const assistantMessage = await saveMessage(chat.id, "assistant", assistantText, toolCallsThisTurn.length ? toolCallsThisTurn : undefined);

  sse.send("done", { chatId: chat.id, messageId: assistantMessage.id, createdAt: assistantMessage.createdAt });
}

module.exports = { runTurn };
