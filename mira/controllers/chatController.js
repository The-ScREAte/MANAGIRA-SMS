const { runTurn } = require("../services/orchestrator");
const db = require("../config/db");
const { ensureMiraSchema } = require("../db/schema");

// POST /api/chat - streams the turn over Server-Sent Events. Chosen over
// raw fetch-stream parsing because it cleanly interleaves distinct event
// types (token / tool_call / tool_result / done) rather than one opaque
// text stream the client has to parse itself.
async function postChat(req, res) {
  const userText = String(req.body?.message || "").trim();
  const chatId = req.body?.chatId ? parseInt(req.body.chatId, 10) : null;

  if (!userText) {
    return res.status(400).json({ error: "message is required." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sse = {
    send(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };

  req.on("close", () => res.end());

  try {
    await runTurn({ tenant: req.tenant, chatId, userText, sse });
  } catch (error) {
    console.error("[mira/chatController]", error);
    sse.send("error", { message: "Something went wrong generating a response." });
  } finally {
    res.end();
  }
}

// GET /api/chat/history - sidebar chat list.
async function getHistory(req, res) {
  try {
    await ensureMiraSchema(db);
    const result = await db.query(
      `SELECT id, title, updated_at FROM mira_chats
       WHERE tenant_id = $1 AND viewer_type = $2 AND user_id = $3
       ORDER BY updated_at DESC LIMIT 50`,
      [req.tenant.organizationId, req.tenant.viewerType, req.tenant.userId]
    );
    return res.json({ chats: result.rows });
  } catch (error) {
    console.error("[mira/chatController/getHistory]", error);
    return res.status(500).json({ error: "Unable to load chat history." });
  }
}

// GET /api/chat/:id - full message thread for one chat.
async function getChat(req, res) {
  try {
    await ensureMiraSchema(db);
    const chatId = parseInt(req.params.id, 10);
    const chat = await db.query(
      `SELECT * FROM mira_chats WHERE id = $1 AND tenant_id = $2 AND viewer_type = $3 AND user_id = $4`,
      [chatId, req.tenant.organizationId, req.tenant.viewerType, req.tenant.userId]
    );
    if (!chat.rows[0]) return res.status(404).json({ error: "Chat not found." });

    const messages = await db.query(
      `SELECT role, content, tool_calls, created_at FROM mira_chat_messages WHERE chat_id = $1 ORDER BY created_at ASC`,
      [chatId]
    );
    return res.json({ chat: chat.rows[0], messages: messages.rows });
  } catch (error) {
    console.error("[mira/chatController/getChat]", error);
    return res.status(500).json({ error: "Unable to load chat." });
  }
}

module.exports = { postChat, getHistory, getChat };
