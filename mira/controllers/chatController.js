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
  // Class scope is client-supplied for UX convenience only. Tenant-scoped
  // tools still enforce data access independently; this is also stored so
  // each response can show the scope that was active for that message.
  const classId = req.body?.classId ? parseInt(req.body.classId, 10) : null;
  const className = req.body?.className ? String(req.body.className).slice(0, 120) : null;

  if (!userText) {
    return res.status(400).json({ error: "message is required." });
  }

  // Images come from prior POST /api/upload calls (routes/uploadRoute.js),
  // which already validated type/size - here we just check shape before
  // trusting them as vision input for this turn. Never persisted; see
  // orchestrator.runTurn. Capped independently of the upload endpoint's
  // own per-request limit, since a message could combine attachments from
  // more than one upload call.
  const MAX_IMAGES_PER_MESSAGE = 5;
  const rawImages = Array.isArray(req.body?.images) ? req.body.images : [];
  const images = rawImages
    .filter((img) => img && typeof img.dataUrl === "string" && img.dataUrl.startsWith("data:image/"))
    .slice(0, MAX_IMAGES_PER_MESSAGE)
    .map((img) => ({ dataUrl: img.dataUrl, mimeType: typeof img.mimeType === "string" ? img.mimeType : null }));

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
    await runTurn({ tenant: req.tenant, chatId, userText, sse, classScope: className ? { classId, className } : null, images });
  } catch (error) {
    console.error("[mira/chatController]", error);
    // TEMP DIAGNOSTIC - surfacing the real error to authenticated callers
    // to debug a prod-only failure without Render dashboard log access.
    // Revert to the generic message once root-caused.
    sse.send("error", { message: "Something went wrong generating a response.", debug: error.message, stack: error.stack });
  } finally {
    res.end();
  }
}

// GET /api/chat/history - sidebar chat list.
async function getHistory(req, res) {
  try {
    await ensureMiraSchema(db);
    const result = await db.query(
      `SELECT id, title, updated_at, pinned FROM mira_chats
       WHERE tenant_id = $1 AND viewer_type = $2 AND user_id = $3
       ORDER BY pinned DESC, updated_at DESC LIMIT 50`,
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
      `SELECT id, role, content, tool_calls, class_scope, feedback, created_at FROM mira_chat_messages WHERE chat_id = $1 ORDER BY created_at ASC`,
      [chatId]
    );
    return res.json({ chat: chat.rows[0], messages: messages.rows });
  } catch (error) {
    console.error("[mira/chatController/getChat]", error);
    return res.status(500).json({ error: "Unable to load chat." });
  }
}

// PATCH /api/chat/:id  { title?, pinned? } - user-driven rename and/or
// pin toggle, tenant/user scoped. Either field, or both, may be present.
async function updateChat(req, res) {
  try {
    await ensureMiraSchema(db);
    const chatId = parseInt(req.params.id, 10);
    const hasTitle = typeof req.body?.title === "string";
    const hasPinned = typeof req.body?.pinned === "boolean";
    if (!hasTitle && !hasPinned) {
      return res.status(400).json({ error: "title or pinned is required." });
    }

    const setClauses = [];
    const values = [];
    let idx = 1;
    if (hasTitle) {
      const title = req.body.title.trim().slice(0, 120);
      if (!title) return res.status(400).json({ error: "title cannot be empty." });
      values.push(title);
      setClauses.push(`title = $${idx++}`);
    }
    if (hasPinned) {
      values.push(req.body.pinned);
      setClauses.push(`pinned = $${idx++}`);
    }
    values.push(chatId, req.tenant.organizationId, req.tenant.viewerType, req.tenant.userId);
    const chatIdx = idx++, tenantIdx = idx++, viewerIdx = idx++, userIdx = idx++;

    const result = await db.query(
      `UPDATE mira_chats SET ${setClauses.join(", ")}
       WHERE id = $${chatIdx} AND tenant_id = $${tenantIdx} AND viewer_type = $${viewerIdx} AND user_id = $${userIdx}
       RETURNING id, title, pinned`,
      values
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Chat not found." });
    return res.json({ chat: result.rows[0] });
  } catch (error) {
    console.error("[mira/chatController/updateChat]", error);
    return res.status(500).json({ error: "Unable to update chat." });
  }
}

// DELETE /api/chat/:id - tenant/user scoped, cascades to messages via FK.
async function deleteChat(req, res) {
  try {
    await ensureMiraSchema(db);
    const chatId = parseInt(req.params.id, 10);
    const result = await db.query(
      `DELETE FROM mira_chats WHERE id = $1 AND tenant_id = $2 AND viewer_type = $3 AND user_id = $4`,
      [chatId, req.tenant.organizationId, req.tenant.viewerType, req.tenant.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Chat not found." });
    return res.json({ success: true });
  } catch (error) {
    console.error("[mira/chatController/deleteChat]", error);
    return res.status(500).json({ error: "Unable to delete chat." });
  }
}

// POST /api/chat/bulk-delete  { ids: number[] } | { all: true } - tenant/user
// scoped, cascades to messages via FK. `all` deletes every chat the caller
// owns (still scoped by the same WHERE clause, so it can never cross tenants).
async function bulkDeleteChats(req, res) {
  try {
    await ensureMiraSchema(db);
    const deleteAll = req.body?.all === true;
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map((id) => parseInt(id, 10)).filter((id) => Number.isInteger(id)))]
      : [];

    if (!deleteAll && !ids.length) {
      return res.status(400).json({ error: "ids (non-empty array) or all:true is required." });
    }

    const params = [req.tenant.organizationId, req.tenant.viewerType, req.tenant.userId];
    let idClause = "";
    if (!deleteAll) {
      params.push(ids);
      idClause = `AND id = ANY($${params.length})`;
    }

    const result = await db.query(
      `DELETE FROM mira_chats WHERE tenant_id = $1 AND viewer_type = $2 AND user_id = $3 ${idClause}`,
      params
    );
    return res.json({ success: true, deletedCount: result.rowCount });
  } catch (error) {
    console.error("[mira/chatController/bulkDeleteChats]", error);
    return res.status(500).json({ error: "Unable to delete chats." });
  }
}

// POST /api/chat/messages/:messageId/feedback  { feedback: 'like' | 'dislike' | null }
// Scoped by joining through mira_chats so a message can only be rated by
// the tenant/user who owns the chat it belongs to.
async function setMessageFeedback(req, res) {
  try {
    await ensureMiraSchema(db);
    const messageId = parseInt(req.params.messageId, 10);
    const feedback = req.body?.feedback;
    if (feedback !== "like" && feedback !== "dislike" && feedback !== null) {
      return res.status(400).json({ error: "feedback must be 'like', 'dislike', or null." });
    }

    const result = await db.query(
      `UPDATE mira_chat_messages m
       SET feedback = $1
       FROM mira_chats c
       WHERE m.id = $2 AND m.chat_id = c.id
         AND c.tenant_id = $3 AND c.viewer_type = $4 AND c.user_id = $5
       RETURNING m.id`,
      [feedback, messageId, req.tenant.organizationId, req.tenant.viewerType, req.tenant.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Message not found." });
    return res.json({ success: true });
  } catch (error) {
    console.error("[mira/chatController/setMessageFeedback]", error);
    return res.status(500).json({ error: "Unable to record feedback." });
  }
}

module.exports = { postChat, getHistory, getChat, updateChat, deleteChat, bulkDeleteChats, setMessageFeedback };
