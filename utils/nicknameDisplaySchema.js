// utils/nicknameDisplaySchema.js
// ============================================================================
// Idempotent migration that adds `organizations.nickname_display` and
// backfills it from the existing slug column for legacy rows. Safe to call
// multiple times; runs the SQL once per process lifetime.
//
// We DO NOT touch the existing `nickname` column type, uniqueness, or any
// foreign keys — it remains the subdomain slug used by the host-based routing
// middleware (server.js). Only behaviour added here:
//   1. Add nickname_display VARCHAR(80)
//   2. Backfill display = nickname where display is NULL
//   3. Index display column for case-insensitive lookups (not strictly
//      required today, but cheap insurance for future search features).
// ============================================================================

let schemaReady = false;
let schemaPromise = null;

async function ensureNicknameDisplaySchema(db) {
  if (schemaReady) return;
  if (schemaPromise) {
    await schemaPromise;
    return;
  }

  schemaPromise = (async () => {
    await db.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS nickname_display VARCHAR(80)
    `);

    // Backfill: for any row missing a display value, default to the slug.
    // This guarantees views can always render a label without null checks.
    await db.query(`
      UPDATE organizations
         SET nickname_display = nickname
       WHERE nickname_display IS NULL
         AND nickname IS NOT NULL
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_nickname_display
        ON organizations(LOWER(nickname_display))
    `).catch(() => {});

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } finally {
    schemaPromise = null;
  }
}

module.exports = { ensureNicknameDisplaySchema };
