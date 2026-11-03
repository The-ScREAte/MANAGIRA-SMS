"use strict";

// Small per-person screen preferences (e.g. the order of the Class Tools
// menu), saved to the account so they follow the person to any device.
const db = require("../config/db");

let schemaPromise = null;
function ensureSchema(database = db) {
  if (!schemaPromise) {
    schemaPromise = database.query(`
      CREATE TABLE IF NOT EXISTS user_ui_preferences (
        organization_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        pref_key VARCHAR(60) NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (organization_id, user_id, pref_key)
      )`).catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

// The signed-in staff member (a school's own login counts as user 0).
function ownerOf(session = {}) {
  const organizationId = Number(session.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) return null;
  const userId = Number(session.userId || (session.user && session.user.user_id) || 0);
  return { organizationId, userId: Number.isInteger(userId) && userId > 0 ? userId : 0 };
}

async function getPreference(session, key, database = db) {
  const owner = ownerOf(session);
  if (!owner) return null;
  await ensureSchema(database);
  const row = (await database.query(
    "SELECT value FROM user_ui_preferences WHERE organization_id = $1 AND user_id = $2 AND pref_key = $3",
    [owner.organizationId, owner.userId, key]
  )).rows[0];
  return row ? row.value : null;
}

async function setPreference(session, key, value, database = db) {
  const owner = ownerOf(session);
  if (!owner) throw Object.assign(new Error("Please sign in again."), { status: 401 });
  await ensureSchema(database);
  if (value === null) {
    await database.query("DELETE FROM user_ui_preferences WHERE organization_id = $1 AND user_id = $2 AND pref_key = $3", [owner.organizationId, owner.userId, key]);
    return;
  }
  await database.query(
    `INSERT INTO user_ui_preferences (organization_id, user_id, pref_key, value, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (organization_id, user_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [owner.organizationId, owner.userId, key, JSON.stringify(value)]
  );
}

module.exports = { getPreference, setPreference, ensureSchema };
