const SCHEMA_READY = { value: false };

/**
 * Ensures the admin announcement table has the columns we now rely on:
 *   - show_for_admins  (BOOLEAN, default FALSE) — display on the admin dashboard
 *
 * The announcement_views table already exists in the base schema and is reused
 * to record which admin-side users have dismissed which announcements.
 */
async function ensureAdminAnnouncementSchema(db) {
  if (SCHEMA_READY.value) return;
  await db.query(`
    ALTER TABLE admin_announcements
      ADD COLUMN IF NOT EXISTS show_for_admins BOOLEAN NOT NULL DEFAULT FALSE
  `);
  // Defensive: announcement_views is created in the base schema, but make sure
  // it exists in environments that might be missing it.
  await db.query(`
    CREATE TABLE IF NOT EXISTS announcement_views (
      view_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      announcement_id INTEGER NOT NULL,
      last_viewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS announcement_views_user_announcement_uidx
      ON announcement_views(user_id, announcement_id)
  `);
  SCHEMA_READY.value = true;
}

module.exports = { ensureAdminAnnouncementSchema };
