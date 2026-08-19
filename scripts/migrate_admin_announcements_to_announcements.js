// One-time data migration: copies existing admin_announcements rows into the
// new broadcast_announcements/broadcast_announcement_targets/
// broadcast_announcement_receipts tables, so the new engine can eventually
// become the single source of truth for this content.
//
// This is a standalone, manually-run tool - it does NOT repoint the live
// admin_announcements UI or the orgDashboard rendering (controllers/
// commonController.js) to read from the new tables. Doing that would touch
// live dashboard render paths used by every org on every page load, which is
// a much higher-risk change than this migration itself; it's deliberately
// left for a deliberate follow-up rather than being silently bundled here.
//
// Usage: node scripts/migrate_admin_announcements_to_announcements.js
const db = require("../config/db");
const { ensureAnnouncementSchema } = require("../utils/announcementSystem");

// Every role tag the org portal currently renders admin_announcements to
// (orgDashboard/orgDashboardRestricted show it to any logged-in org user
// regardless of role) - enumerated explicitly since the new schema has no
// wildcard target.
const ORG_ROLE_TAGS = ["teacher", "student_teacher", "student", "parent", "guardian", "driver", "org_admin"];

async function main() {
  await ensureAnnouncementSchema(db);

  const { rows: legacyRows } = await db.query(`SELECT * FROM admin_announcements ORDER BY id ASC`);
  console.log(`Found ${legacyRows.length} legacy admin_announcements row(s).`);

  let migrated = 0;
  for (const row of legacyRows) {
    const existing = await db.query(
      `SELECT id FROM broadcast_announcements WHERE title = $1 AND body = $2 AND tenant_id IS NOT DISTINCT FROM $3`,
      [row.title, row.description, row.organization_id]
    );
    if (existing.rows.length) {
      console.log(`Skipping admin_announcements#${row.id} - already migrated (broadcast_announcements#${existing.rows[0].id}).`);
      continue;
    }

    const insertResult = await db.query(
      `INSERT INTO broadcast_announcements
        (tenant_id, title, body, display_type, variant, frequency, is_active, starts_at, ends_at, created_at)
       VALUES ($1, $2, $3, 'banner', 'info', 'until_dismissed', $4, $5, $6, $5)
       RETURNING id`,
      [row.organization_id || null, row.title, row.description, row.is_active, row.created_at, row.expiry_date || null]
    );
    const newId = insertResult.rows[0].id;

    const targetRoles = row.show_for_admins ? [...ORG_ROLE_TAGS, "super_admin"] : ORG_ROLE_TAGS;
    for (const role of targetRoles) {
      await db.query(
        `INSERT INTO broadcast_announcement_targets (announcement_id, target_type, target_value) VALUES ($1, 'role', $2)`,
        [newId, role]
      );
    }

    const { rows: viewRows } = await db.query(
      `SELECT user_id FROM announcement_views WHERE announcement_id = $1 AND user_id IS NOT NULL`,
      [row.id]
    );
    for (const view of viewRows) {
      // The legacy table conflated "seen" and "dismissed" (a single
      // last_viewed timestamp, no separate dismiss action). Setting
      // dismissed_at too - not left null - is the safer default: leaving it
      // null would make a previously-acknowledged announcement reappear
      // under the migrated row's until_dismissed frequency.
      await db.query(
        `INSERT INTO broadcast_announcement_receipts
          (announcement_id, user_id, viewer_type, tenant_id, view_count, first_seen_at, last_seen_at, dismissed_at)
         VALUES ($1, $2, 'staff', $3, 1, now(), now(), now())
         ON CONFLICT (announcement_id, viewer_type, user_id) DO NOTHING`,
        [newId, view.user_id, row.organization_id || null]
      );
    }

    migrated += 1;
    console.log(`Migrated admin_announcements#${row.id} -> broadcast_announcements#${newId} (${viewRows.length} receipt(s)).`);
  }

  console.log(`Done. Migrated ${migrated} of ${legacyRows.length} row(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
