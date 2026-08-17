'use strict';
/**
 * Seed one test broadcast announcement targeted at teachers in org 63
 * (Managira Int. School).
 * Run: node scripts/seed_test_announcement.js
 */
const db = require('../config/db');
const { ensureAnnouncementSchema } = require('../utils/announcementSystem');

const ORG_ID = 63; // Managira Int. School

async function main() {
  await ensureAnnouncementSchema(db);

  const result = await db.query(
    `INSERT INTO broadcast_announcements
      (tenant_id, title, body, display_type, variant, cta_links, dismissible, frequency, max_views, is_active)
     VALUES ($1, $2, $3, 'modal', 'info', $4, TRUE, 'n_times', 3, TRUE)
     RETURNING id`,
    [
      ORG_ID,
      'Welcome to the new Announcements system',
      "This is a sample announcement seeded for testing. It's targeted at teachers in Managira Int. School and will show up to 3 times before it stops appearing.",
      JSON.stringify([{ label: 'Learn more', url: '/common/dashboard', style: 'primary', ack_required: false }]),
    ]
  );
  const id = result.rows[0].id;

  await db.query(
    `INSERT INTO broadcast_announcement_targets (announcement_id, target_type, target_value) VALUES ($1, 'role', 'teacher')`,
    [id]
  );

  console.log(`Seeded broadcast_announcements#${id} for org ${ORG_ID}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
