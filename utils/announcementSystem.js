// Table names are prefixed `broadcast_` deliberately: a table literally named
// `announcements` already exists (the org-level "Events & Announcements"
// feature, controllers/commonController.js) with a completely different
// schema (announcement_id, message, organization_id, school_year_id,
// term_id, visibility). Reusing that name here would make CREATE TABLE IF
// NOT EXISTS silently no-op against the wrong table.
let announcementSchemaReady = false;

async function ensureAnnouncementSchema(dbClient) {
  if (announcementSchemaReady) return;

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS broadcast_announcements (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      title           VARCHAR(255) NOT NULL,
      body            TEXT NOT NULL,
      image_url       TEXT NULL,
      display_type    VARCHAR(10) NOT NULL DEFAULT 'modal'  CHECK (display_type IN ('modal','banner')),
      variant         VARCHAR(10) NOT NULL DEFAULT 'info'    CHECK (variant IN ('info','success','warning','new')),
      cta_links       JSONB NOT NULL DEFAULT '[]'::jsonb,
      dismissible     BOOLEAN NOT NULL DEFAULT TRUE,
      frequency       VARCHAR(20) NOT NULL DEFAULT 'once'
                        CHECK (frequency IN ('once','once_per_session','every_login','daily','n_times','until_dismissed','until_date')),
      max_views       INTEGER NULL,
      starts_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      ends_at         TIMESTAMPTZ NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_by      INTEGER NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Added after the table already existed in some environments - where a
  // pop-up (display_type='modal') shows: center (classic, blocking dialog)
  // or a non-blocking corner card, bottom-right/bottom-left. Banners always
  // sit at the top, so position is ignored for those.
  await dbClient.query(`
    ALTER TABLE broadcast_announcements
      ADD COLUMN IF NOT EXISTS position VARCHAR(12) NOT NULL DEFAULT 'center'
  `);
  await dbClient.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_announcements_position_check'
      ) THEN
        ALTER TABLE broadcast_announcements
          ADD CONSTRAINT broadcast_announcements_position_check
          CHECK (position IN ('center','bottom-right','bottom-left'));
      END IF;
    END $$;
  `);
  // 'dashboard' (a notice inside the school / admin dashboard) was added when
  // the older admin_announcements "dashboard notices" were folded in here.
  await dbClient.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'broadcast_announcements_display_type_check'
           AND pg_get_constraintdef(oid) LIKE '%dashboard%'
      ) THEN
        ALTER TABLE broadcast_announcements DROP CONSTRAINT IF EXISTS broadcast_announcements_display_type_check;
        ALTER TABLE broadcast_announcements
          ADD CONSTRAINT broadcast_announcements_display_type_check
          CHECK (display_type IN ('modal','banner','dashboard'));
      END IF;
    END $$;
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS broadcast_announcements_tenant_active_idx ON broadcast_announcements(tenant_id, is_active)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS broadcast_announcements_window_idx ON broadcast_announcements(starts_at, ends_at)
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS broadcast_announcement_targets (
      id               SERIAL PRIMARY KEY,
      announcement_id  INTEGER NOT NULL REFERENCES broadcast_announcements(id) ON DELETE CASCADE,
      target_type      VARCHAR(10) NOT NULL CHECK (target_type IN ('role','org','user')),
      target_value     VARCHAR(255) NOT NULL
    )
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS broadcast_announcement_targets_lookup_idx ON broadcast_announcement_targets(announcement_id, target_type, target_value)
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS broadcast_announcement_receipts (
      id               SERIAL PRIMARY KEY,
      announcement_id  INTEGER NOT NULL REFERENCES broadcast_announcements(id) ON DELETE CASCADE,
      user_id          INTEGER NOT NULL,
      viewer_type      VARCHAR(10) NOT NULL DEFAULT 'staff' CHECK (viewer_type IN ('staff','guardian','student')),
      tenant_id        INTEGER NULL,
      view_count       INTEGER NOT NULL DEFAULT 0,
      first_seen_at    TIMESTAMPTZ NULL,
      last_seen_at     TIMESTAMPTZ NULL,
      dismissed_at     TIMESTAMPTZ NULL,
      acknowledged_at  TIMESTAMPTZ NULL,
      UNIQUE (announcement_id, viewer_type, user_id)
    )
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS broadcast_announcement_receipts_user_idx ON broadcast_announcement_receipts(viewer_type, user_id, announcement_id)
  `);
  await dbClient.query(`
    CREATE INDEX IF NOT EXISTS broadcast_announcement_receipts_tenant_idx ON broadcast_announcement_receipts(tenant_id)
  `);

  announcementSchemaReady = true;

  try {
    await migrateLegacyDashboardNotices(dbClient);
  } catch (error) {
    console.error("[announcements] legacy dashboard notice migration failed:", error.message);
  }
}

// School staff who use the school dashboard (where dashboard notices show).
const SCHOOL_STAFF_ROLES = ["manager", "org_admin", "supervisor", "teacher", "student_teacher"];

function cleanLegacyText(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Copies the older admin_announcements "dashboard notices" into this system as
// display_type 'dashboard'. Additive and idempotent: each legacy row is marked
// with the id it became, and the legacy table is otherwise left untouched.
// Matches the old behavior: school notices showed once per person; notices for
// the Managira team stayed on the admin dashboard until marked seen.
async function migrateLegacyDashboardNotices(pool) {
  const exists = await pool.query(`SELECT to_regclass('public.admin_announcements') IS NOT NULL AS ok`);
  if (!exists.rows[0].ok) return;
  await pool.query(`ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS migrated_announcement_id INTEGER`);
  const pending = await pool.query(`SELECT 1 FROM admin_announcements WHERE migrated_announcement_id IS NULL LIMIT 1`);
  if (!pending.rows.length) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('managira_legacy_notice_migration'))`);
    const { rows } = await client.query(
      `SELECT * FROM admin_announcements WHERE migrated_announcement_id IS NULL ORDER BY id FOR UPDATE`
    );
    for (const row of rows) {
      const forTeam = row.show_for_admins === true;
      const inserted = await client.query(
        `INSERT INTO broadcast_announcements
           (tenant_id, title, body, display_type, variant, position, frequency, dismissible, is_active, starts_at, ends_at, created_at)
         VALUES ($1, $2, $3, 'dashboard', 'info', 'center', $4, TRUE, $5, COALESCE($6, now()), $7, COALESCE($6, now()))
         RETURNING id`,
        [
          row.organization_id || null,
          String(row.title || "Notice").slice(0, 255),
          cleanLegacyText(row.description) || String(row.title || ""),
          forTeam ? "until_dismissed" : "once",
          row.is_active !== false,
          row.created_at || null,
          row.expiry_date || null,
        ]
      );
      const newId = inserted.rows[0].id;
      for (const role of forTeam ? ["super_admin"] : SCHOOL_STAFF_ROLES) {
        await client.query(
          `INSERT INTO broadcast_announcement_targets (announcement_id, target_type, target_value) VALUES ($1, 'role', $2)`,
          [newId, role]
        );
      }
      // Whoever already saw it keeps not seeing it.
      await client.query(
        `INSERT INTO broadcast_announcement_receipts
           (announcement_id, user_id, viewer_type, tenant_id, view_count, first_seen_at, last_seen_at, dismissed_at)
         SELECT $1, v.user_id, 'staff', $2, 1, MIN(v.last_viewed), MAX(v.last_viewed), ${forTeam ? "MAX(v.last_viewed)" : "NULL"}
           FROM announcement_views v
          WHERE v.announcement_id = $3 AND v.user_id IS NOT NULL
          GROUP BY v.user_id
         ON CONFLICT (announcement_id, viewer_type, user_id) DO NOTHING`,
        [newId, row.organization_id || null, row.id]
      );
      await client.query(`UPDATE admin_announcements SET migrated_announcement_id = $1 WHERE id = $2`, [newId, row.id]);
    }
    await client.query("COMMIT");
    if (rows.length) console.log(`[announcements] moved ${rows.length} dashboard notice(s) into announcements`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensureAnnouncementSchema, migrateLegacyDashboardNotices, SCHOOL_STAFF_ROLES };
