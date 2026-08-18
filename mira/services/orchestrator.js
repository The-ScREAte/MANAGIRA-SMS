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

const SYSTEM_PROMPT = `You are Mira, Managira's AI assistant for school staff. You help find student and school records, draft communications, and summarize data. You only ever act within the current user's own school - never suggest or imply access to another school's data. Be concise and warm.`;

async function getOrCreateChat({ tenant, chatId }) {
  await ensureMiraSchema(db);
  if (chatId) {
    const existing = await db.query(
      `SELECT * FROM mira_chats WHERE id = $1 AND tenant_id = $2 AND viewer_type = $3 AND user_id = $4`,
      [chatId, tenant.organizationId, tenant.viewerType, tenant.userId]
    );
    if (existing.rows[0]) return existing.rows[0];
  }
  const created = await db.query(
    `INSERT INTO mira_chats (tenant_id, user_id, viewer_type) VALUES ($1, $2, $3) RETURNING *`,
    [tenant.organizationId, tenant.userId, tenant.viewerType]
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
    `INSERT INTO mira_chat_messages (chat_id, role, content, tool_calls) VALUES ($1, $2, $3, $4) RETURNING id`,
    [chatId, role, content, toolCalls ? JSON.stringify(toolCalls) : null]
  );
  await db.query(`UPDATE mira_chats SET updated_at = now() WHERE id = $1`, [chatId]);
  return result.rows[0].id;
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
async function runTurn({ tenant, chatId, userText, sse, classScope }) {
  const budget = await checkBudget(tenant.organizationId);
  if (!budget.allowed) {
    sse.send("error", { message: budget.reason });
    return;
  }

  const chat = await getOrCreateChat({ tenant, chatId });
  const history = await loadHistory(chat.id);
  await saveMessage(chat.id, "user", userText);

  sse.send("chat", { chatId: chat.id });

  // RAG: pull in any previously-indexed content relevant to this message
  // (scoped to the caller's own tenant - vectorStore.search() enforces
  // this in SQL, not just in application code). Best-effort: indexing
  // failures should never block a chat turn.
  let contextMessages = [];
  try {
    const matches = await retrieveContext({ tenantId: tenant.organizationId, query: userText, limit: 4 });
    if (matches.length) {
      const contextText = matches.map((m) => `- (${m.source_type}) ${m.content}`).join("\n");
      contextMessages = [{ role: "system", content: `Relevant indexed context:\n${contextText}` }];
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

  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...contextMessages, ...history, { role: "user", content: userText }];
  const tools = listToolSchemas();

  let assistantText = "";
  let toolCallInfo = null;
  let assistantMessageId = null;

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

    assistantMessageId = await saveMessage(chat.id, "assistant", assistantText, [{ name: toolCallInfo.name, args: toolCallInfo.args, status }]);
  } else {
    assistantMessageId = await saveMessage(chat.id, "assistant", assistantText);
  }

  sse.send("done", { chatId: chat.id, messageId: assistantMessageId });
}

module.exports = { runTurn };
