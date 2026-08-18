const db = require("../config/db");
const { ensureMiraSchema } = require("../db/schema");

const MAX_INSTRUCTIONS_LENGTH = 2000;
const ALLOWED_FONTS = ["default", "serif", "mono", "rounded"];

// GET /api/preferences - current user's saved custom instructions + chat
// font. Absent row simply means defaults (empty instructions, default font).
async function getPreferences(req, res) {
  try {
    await ensureMiraSchema(db);
    const result = await db.query(
      `SELECT custom_instructions, chat_font FROM mira_user_preferences
       WHERE tenant_id = $1 AND viewer_type = $2 AND user_id = $3`,
      [req.tenant.organizationId, req.tenant.viewerType, req.tenant.userId]
    );
    const row = result.rows[0];
    return res.json({
      customInstructions: row?.custom_instructions || "",
      chatFont: row?.chat_font || "default",
    });
  } catch (error) {
    console.error("[mira/preferencesController/getPreferences]", error);
    return res.status(500).json({ error: "Unable to load preferences." });
  }
}

// PUT /api/preferences  { customInstructions?, chatFont? } - upserts
// whichever fields are present, tenant/user scoped like every other
// mira_* row.
async function updatePreferences(req, res) {
  try {
    await ensureMiraSchema(db);
    const hasInstructions = typeof req.body?.customInstructions === "string";
    const hasFont = typeof req.body?.chatFont === "string";
    if (!hasInstructions && !hasFont) {
      return res.status(400).json({ error: "customInstructions or chatFont is required." });
    }

    const customInstructions = hasInstructions ? req.body.customInstructions.trim().slice(0, MAX_INSTRUCTIONS_LENGTH) : null;
    if (hasFont && !ALLOWED_FONTS.includes(req.body.chatFont)) {
      return res.status(400).json({ error: "Invalid chatFont value." });
    }
    const chatFont = hasFont ? req.body.chatFont : null;

    const result = await db.query(
      `INSERT INTO mira_user_preferences (tenant_id, viewer_type, user_id, custom_instructions, chat_font, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_id, viewer_type, user_id) DO UPDATE SET
         custom_instructions = COALESCE($4, mira_user_preferences.custom_instructions),
         chat_font = COALESCE($5, mira_user_preferences.chat_font),
         updated_at = now()
       RETURNING custom_instructions, chat_font`,
      [req.tenant.organizationId, req.tenant.viewerType, req.tenant.userId, customInstructions, chatFont]
    );
    const row = result.rows[0];
    return res.json({
      customInstructions: row.custom_instructions || "",
      chatFont: row.chat_font || "default",
    });
  } catch (error) {
    console.error("[mira/preferencesController/updatePreferences]", error);
    return res.status(500).json({ error: "Unable to save preferences." });
  }
}

module.exports = { getPreferences, updatePreferences };
