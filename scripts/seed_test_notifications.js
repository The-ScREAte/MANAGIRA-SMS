'use strict';
/**
 * Seed one test notification per type for user 93 (Managira Scraete)
 * in org 63 (Managira Int. School).
 * Run: node scripts/seed_test_notifications.js
 */
const db = require('../config/db');

const ORG_ID = 63;
const USER_ID = 93;

const notifications = [
  // ─── Conversations ────────────────────────────────────────────────────────
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'guardian_report_new',
    title: 'New report: Homework concern',
    body: 'Parent: child not receiving homework clearly.',
    link: '/common/classDashboard/46/reports',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'guardian_reply',
    title: 'Guardian replied to report',
    body: 'Will try the suggested study schedule.',
    link: '/common/classDashboard/46/reports',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'staff_reply',
    title: 'Staff replied to report',
    body: 'Re: Homework concern — John Doe',
    link: '/guardian/reports',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'staff_report_filed',
    title: 'Report filed by school',
    body: 'Behaviour report for Aisha Mensah',
    link: '/guardian/reports',
  },
  // ─── Assessments ──────────────────────────────────────────────────────────
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'assessment_created',
    title: '➕ Mid-Term Test',
    body: 'Added · Term 1',
    link: '/common/classDashboard/46/subject',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'assessment_modified',
    title: '✏️ Mid-Term Test',
    body: 'Updated · Term 1',
    link: '/common/classDashboard/46/subject',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'assessment_locked',
    title: '🔒 End-of-Term Exam',
    body: 'Score entry closed.',
    link: '/common/classDashboard/46/subject',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'assessment_unlocked',
    title: '🔓 End-of-Term Exam',
    body: 'Score entry open.',
    link: '/common/classDashboard/46/subject',
  },
  // ─── Attendance ───────────────────────────────────────────────────────────
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'absence_alert',
    title: 'Absence alert: Kofi Asante',
    body: 'Absent 3 times this week.',
    link: null,
  },
  // ─── Documents ────────────────────────────────────────────────────────────
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'document_shared_user',
    title: 'Doc shared with you',
    body: 'Science Notes Q3 — edit access',
    link: '/documents',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'document_shared_class',
    title: 'Doc shared with your class',
    body: 'Class 9 Reading List',
    link: '/common/classDashboard/46/docs',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'document_permission_changed',
    title: 'Doc access changed',
    body: 'Term 2 Timetable — view only',
    link: '/documents',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'document_deleted',
    title: 'Doc deleted',
    body: 'Draft Report Card was removed.',
    link: null,
  },
  // ─── Employment ───────────────────────────────────────────────────────────
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'employee_on_hold',
    title: 'Account put on hold',
    body: 'Contact your administrator.',
    link: null,
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'employee_resumed',
    title: 'Account hold removed',
    body: 'Your access has been restored.',
    link: null,
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'class_reassigned',
    title: 'Class assignments changed',
    body: 'Added: Class 9A · Removed: Class 8B',
    link: null,
  },
  // ─── Admissions ───────────────────────────────────────────────────────────
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'admission_pending',
    title: 'New admission pending',
    body: 'Jane Osei submitted an application.',
    link: '/common/admissionPending',
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'admission_approved',
    title: 'Admission approved',
    body: 'Jane Osei has been admitted.',
    link: null,
  },
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'admission_rejected',
    title: 'Admission not approved',
    body: "James Owusu's application was rejected.",
    link: null,
  },
  // ─── School events ────────────────────────────────────────────────────────
  {
    recipientType: 'broadcast',
    recipientId: 0,
    type: 'event_created',
    title: 'Event: Sports Day 2026',
    body: 'May 30th — students & parents welcome.',
    link: '/common/orgDashboard',
  },
  {
    recipientType: 'broadcast',
    recipientId: 0,
    type: 'announcement_created',
    title: 'School closed Mon 19th May',
    body: 'Public holiday — no classes.',
    link: '/common/orgDashboard',
  },
  // ─── Term ─────────────────────────────────────────────────────────────────
  {
    recipientType: 'broadcast',
    recipientId: 0,
    type: 'term_changed',
    title: 'Term settings updated',
    body: 'School year / term has changed.',
    link: null,
  },
  // ─── Enrollment ───────────────────────────────────────────────────────────
  {
    recipientType: 'staff',
    recipientId: USER_ID,
    type: 'enrollment_added',
    title: 'Students enrolled in your class',
    body: 'New students have been added.',
    link: '/common/classDashboard?classId=46',
  },
];

(async () => {
  // Delete any previous test notifications for this user to keep the list clean
  await db.query(
    `DELETE FROM notifications WHERE organization_id = $1
      AND (recipient_id = $2 OR recipient_type IN ('broadcast','guardian'))`,
    [ORG_ID, USER_ID]
  );
  // Also clear any leftover dismissals so all re-seeded notifications are visible
  await db.query(
    `DELETE FROM notification_dismissals WHERE dismisser_id = $1`,
    [USER_ID]
  ).catch(() => { /* table may not exist yet — safe to ignore */ });
  console.log('Cleared old test notifications.');

  for (const n of notifications) {
    await db.query(
      `INSERT INTO notifications (organization_id, recipient_type, recipient_id, type, title, body, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ORG_ID, n.recipientType, n.recipientId, n.type, n.title, n.body || null, n.link || null]
    );
    console.log(`  ✓ ${n.type}`);
  }

  console.log(`\nDone — ${notifications.length} test notifications inserted.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
