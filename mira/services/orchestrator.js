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

  // Only the current turn's message can carry images - history loaded
  // from the DB is always plain text, since images are never persisted
  // (kept out of mira_chat_messages to avoid storing base64 blobs there).
  const currentUserContent = images?.length
    ? [{ type: "text", text: userText }, ...images.map((image) => ({ type: "image", image }))]
    : userText;
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...contextMessages, ...history, { role: "user", content: currentUserContent }];
  const tools = listToolSchemas();

  let assistantText = "";
  let toolCallInfo = null;
  let assistantMessage = null;

  const firstPass = await streamCompletion({
    task: "default",
    messages,
    tools,
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
    provider: firstPass.provider,
    model: firstPass.model,
    promptTokens: firstPass.usage?.promptTokens || firstPass.usage?.prompt_tokens || 0,
    completionTokens: firstPass.usage?.completionTokens || firstPass.usage?.completion_tokens || 0,
  }).catch((err) => console.error("[mira/orchestrator] usage recording failed:", err.message));

  if (toolCallInfo) {
    sse.send("tool_call", { name: toolCallInfo.name, args: toolCallInfo.args });
    const { status, result } = await runTool(toolCallInfo.name, toolCallInfo.args, tenant);
    const summary = summarizeToolResult(toolCallInfo.name, result);
    await logToolCall({ tenant, chatId: chat.id, toolName: toolCallInfo.name, args: toolCallInfo.args, status, resultSummary: summary });
    sse.send("tool_result", { name: toolCallInfo.name, status, result });

    // Second pass: give the model the tool result so it can phrase a
    // natural-language answer, instead of the raw tool output.
    const followUpMessages = [
      ...messages,
      { role: "assistant", content: `[Called ${toolCallInfo.name} with ${JSON.stringify(toolCallInfo.args)}]` },
      { role: "user", content: `Tool result: ${JSON.stringify(result)}. Reply to the user based on this.` },
    ];
    assistantText = "";
    const secondPass = await streamCompletion({
      task: "default",
      messages: followUpMessages,
      tools: [],
      onToken: (text) => {
        assistantText += text;
        sse.send("token", { text });
      },
      onToolCall: () => {},
    });
    await recordUsage({
      tenantId: tenant.organizationId,
      userId: tenant.userId,
      provider: secondPass.provider,
      model: secondPass.model,
      promptTokens: secondPass.usage?.promptTokens || secondPass.usage?.prompt_tokens || 0,
      completionTokens: secondPass.usage?.completionTokens || secondPass.usage?.completion_tokens || 0,
    }).catch((err) => console.error("[mira/orchestrator] usage recording failed:", err.message));

    assistantMessage = await saveMessage(chat.id, "assistant", assistantText, [{ name: toolCallInfo.name, args: toolCallInfo.args, status }]);
  } else {
    assistantMessage = await saveMessage(chat.id, "assistant", assistantText);
  }

  sse.send("done", { chatId: chat.id, messageId: assistantMessage.id, createdAt: assistantMessage.createdAt });
}

module.exports = { runTurn };
