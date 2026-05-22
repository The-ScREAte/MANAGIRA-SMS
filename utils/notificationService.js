'use strict';
/**
 * notificationService.js
 *
 * Central service for the Managira in-app notification bell.
 *
 * Recipient model
 * ───────────────
 *  recipient_type = 'staff'     → recipient_id = users.user_id
 *  recipient_type = 'guardian'  → recipient_id = guardian_profiles.guardian_id
 *  recipient_type = 'broadcast' → recipient_id = 0  (all staff in the org see it)
 *
 * Notification types (matches controllers)
 * ─────────────────────────────────────────
 *  Conversations : guardian_report_new | guardian_reply | staff_reply | staff_report_filed
 *  Assessments   : assessment_created | assessment_modified | assessment_locked | assessment_unlocked
 *  Attendance    : absence_alert
 *  Email         : email_delivery_failed
 *  Documents     : document_shared_user | document_shared_class | document_permission_changed | document_deleted
 *  Employment    : employee_on_hold | employee_resumed | class_reassigned
 *  Admissions    : admission_pending | admission_approved | admission_rejected
 *  School events : event_created | announcement_created
 *  Term          : term_changed
 *  Enrollment    : enrollment_added
 */

let _schemaReady = false;

/**
 * Ensure the two notification tables exist.
 * Runs once per process lifetime.
 */
async function ensureSchema(db) {
  if (_schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id               SERIAL PRIMARY KEY,
      organization_id  INTEGER      NOT NULL,
      recipient_type   VARCHAR(20)  NOT NULL
                         CHECK (recipient_type IN ('staff','guardian','broadcast')),
      recipient_id     INTEGER      NOT NULL DEFAULT 0,
      type             VARCHAR(60)  NOT NULL,
      title            VARCHAR(255) NOT NULL,
      body             TEXT,
      link             VARCHAR(500),
      ref_id           INTEGER,
      created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      id               SERIAL PRIMARY KEY,
      notification_id  INTEGER   NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      reader_id        INTEGER   NOT NULL,
      read_at          TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (notification_id, reader_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS notification_dismissals (
      id               SERIAL PRIMARY KEY,
      notification_id  INTEGER   NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      dismisser_id     INTEGER   NOT NULL,
      dismissed_at     TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (notification_id, dismisser_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notif_dismissals_dismisser
    ON notification_dismissals (dismisser_id, notification_id)`);
  // Indexes (safe to run multiple times)
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notif_org_recip
    ON notifications (organization_id, recipient_type, recipient_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notif_broadcast
    ON notifications (organization_id, recipient_type, created_at DESC)
    WHERE recipient_type = 'broadcast'`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notif_reads_reader
    ON notification_reads (reader_id, notification_id)`);
  _schemaReady = true;
}

/**
 * Create one notification row.
 *
 * @param {object} db   – pg pool
 * @param {object} opts
 *   orgId         {number}  required
 *   recipientType {'staff'|'guardian'|'broadcast'}  required
 *   recipientId   {number}  required (use 0 for broadcast)
 *   type          {string}  required
 *   title         {string}  required
 *   body          {string}  optional
 *   link          {string}  optional – URL to navigate to on click
 *   refId         {number}  optional – e.g. report_id, assessment group_id
 */
async function createNotification(db, opts) {
  try {
    const { orgId, recipientType, recipientId = 0, type, title, body = null, link = null, refId = null } = opts;
    if (!orgId || !recipientType || !type || !title) return;
    await ensureSchema(db);
    await db.query(
      `INSERT INTO notifications
         (organization_id, recipient_type, recipient_id, type, title, body, link, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orgId, recipientType, recipientId, type, title, body, link, refId]
    );
  } catch (err) {
    // Never crash the calling controller
    console.error('[NotificationService] createNotification failed:', err.message);
  }
}

/**
 * Bulk-create one notification per recipient in an array.
 * Skips duplicates silently. More efficient than looping createNotification
 * when many recipients share the same event (e.g. class teachers).
 *
 * @param {object}   db
 * @param {object[]} list  – array of opts objects (same shape as createNotification)
 */
async function createNotifications(db, list) {
  if (!list || list.length === 0) return;
  try {
    await ensureSchema(db);
    // Build a single multi-row INSERT for performance
    const values = [];
    const params = [];
    let idx = 1;
    for (const opts of list) {
      const { orgId, recipientType, recipientId = 0, type, title, body = null, link = null, refId = null } = opts;
      if (!orgId || !recipientType || !type || !title) continue;
      values.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7})`);
      params.push(orgId, recipientType, recipientId, type, title, body, link, refId);
      idx += 8;
    }
    if (values.length === 0) return;
    await db.query(
      `INSERT INTO notifications
         (organization_id, recipient_type, recipient_id, type, title, body, link, ref_id)
       VALUES ${values.join(',')}`,
      params
    );
  } catch (err) {
    console.error('[NotificationService] createNotifications failed:', err.message);
  }
}

/**
 * Get the count of unread notifications for a user.
 *
 * For staff (recipient_type 'staff' OR 'broadcast'):
 *   recipientType = 'staff', recipientId = userId
 * For guardians:
 *   recipientType = 'guardian', recipientId = guardianId
 */
async function getUnreadCount(db, { recipientType, recipientId, orgId }) {
  try {
    await ensureSchema(db);
    if (recipientType === 'staff') {
      const result = await db.query(
        `SELECT COUNT(*)::int AS cnt
         FROM notifications n
         WHERE n.organization_id = $1
           AND (
             (n.recipient_type = 'staff'     AND n.recipient_id = $2)
             OR n.recipient_type = 'broadcast'
           )
           AND NOT EXISTS (
             SELECT 1 FROM notification_reads nr
             WHERE nr.notification_id = n.id AND nr.reader_id = $2
           )
           AND NOT EXISTS (
             SELECT 1 FROM notification_dismissals nd
             WHERE nd.notification_id = n.id AND nd.dismisser_id = $2
           )`,
        [orgId, recipientId]
      );
      return result.rows[0]?.cnt ?? 0;
    }
    if (recipientType === 'guardian') {
      const result = await db.query(
        `SELECT COUNT(*)::int AS cnt
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.recipient_type = 'guardian'
           AND n.recipient_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM notification_reads nr
             WHERE nr.notification_id = n.id AND nr.reader_id = $2
           )
           AND NOT EXISTS (
             SELECT 1 FROM notification_dismissals nd
             WHERE nd.notification_id = n.id AND nd.dismisser_id = $2
           )`,
        [orgId, recipientId]
      );
      return result.rows[0]?.cnt ?? 0;
    }
    return 0;
  } catch (err) {
    console.error('[NotificationService] getUnreadCount failed:', err.message);
    return 0;
  }
}

/**
 * Return the latest `limit` notifications for a user, with read status.
 */
async function getFeed(db, { recipientType, recipientId, orgId, limit = 20 }) {
  try {
    await ensureSchema(db);
    const safeLimit = Math.min(Number.parseInt(limit, 10) || 20, 50);

    if (recipientType === 'staff') {
      const result = await db.query(
        `SELECT n.*,
                (nr.reader_id IS NOT NULL) AS is_read
         FROM notifications n
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id AND nr.reader_id = $2
         WHERE n.organization_id = $1
           AND (
             (n.recipient_type = 'staff'     AND n.recipient_id = $2)
             OR n.recipient_type = 'broadcast'
           )
           AND NOT EXISTS (
             SELECT 1 FROM notification_dismissals nd
             WHERE nd.notification_id = n.id AND nd.dismisser_id = $2
           )
         ORDER BY n.created_at DESC
         LIMIT $3`,
        [orgId, recipientId, safeLimit]
      );
      return result.rows;
    }
    if (recipientType === 'guardian') {
      const result = await db.query(
        `SELECT n.*,
                (nr.reader_id IS NOT NULL) AS is_read
         FROM notifications n
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id AND nr.reader_id = $2
         WHERE n.organization_id = $1
           AND n.recipient_type = 'guardian'
           AND n.recipient_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM notification_dismissals nd
             WHERE nd.notification_id = n.id AND nd.dismisser_id = $2
           )
         ORDER BY n.created_at DESC
         LIMIT $3`,
        [orgId, recipientId, safeLimit]
      );
      return result.rows;
    }
    return [];
  } catch (err) {
    console.error('[NotificationService] getFeed failed:', err.message);
    return [];
  }
}

/**
 * Dismiss (hide) a single notification for this user only.
 * Does not delete the row — other users still see it.
 */
async function dismissNotification(db, { notifId, dismisserId }) {
  try {
    await ensureSchema(db);
    await db.query(
      `INSERT INTO notification_dismissals (notification_id, dismisser_id)
       VALUES ($1, $2)
       ON CONFLICT (notification_id, dismisser_id) DO NOTHING`,
      [notifId, dismisserId]
    );
  } catch (err) {
    console.error('[NotificationService] dismissNotification failed:', err.message);
  }
}

/**
 * Dismiss ALL visible notifications for a user.
 */
async function dismissAll(db, { recipientType, recipientId, orgId }) {
  try {
    await ensureSchema(db);
    if (recipientType === 'staff') {
      await db.query(
        `INSERT INTO notification_dismissals (notification_id, dismisser_id)
         SELECT n.id, $2
         FROM notifications n
         WHERE n.organization_id = $1
           AND (
             (n.recipient_type = 'staff' AND n.recipient_id = $2)
             OR n.recipient_type = 'broadcast'
           )
         ON CONFLICT (notification_id, dismisser_id) DO NOTHING`,
        [orgId, recipientId]
      );
    } else if (recipientType === 'guardian') {
      await db.query(
        `INSERT INTO notification_dismissals (notification_id, dismisser_id)
         SELECT n.id, $2
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.recipient_type = 'guardian'
           AND n.recipient_id = $2
         ON CONFLICT (notification_id, dismisser_id) DO NOTHING`,
        [orgId, recipientId]
      );
    }
  } catch (err) {
    console.error('[NotificationService] dismissAll failed:', err.message);
  }
}

/**
 * Mark a single notification as read for a user.
 */
async function markRead(db, { notifId, readerId }) {
  try {
    await ensureSchema(db);
    await db.query(
      `INSERT INTO notification_reads (notification_id, reader_id)
       VALUES ($1, $2)
       ON CONFLICT (notification_id, reader_id) DO NOTHING`,
      [notifId, readerId]
    );
  } catch (err) {
    console.error('[NotificationService] markRead failed:', err.message);
  }
}

/**
 * Mark ALL notifications for a user as read.
 */
async function markAllRead(db, { recipientType, recipientId, orgId }) {
  try {
    await ensureSchema(db);
    if (recipientType === 'staff') {
      await db.query(
        `INSERT INTO notification_reads (notification_id, reader_id)
         SELECT n.id, $2
         FROM notifications n
         WHERE n.organization_id = $1
           AND (
             (n.recipient_type = 'staff'     AND n.recipient_id = $2)
             OR n.recipient_type = 'broadcast'
           )
         ON CONFLICT (notification_id, reader_id) DO NOTHING`,
        [orgId, recipientId]
      );
    } else if (recipientType === 'guardian') {
      await db.query(
        `INSERT INTO notification_reads (notification_id, reader_id)
         SELECT n.id, $2
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.recipient_type = 'guardian'
           AND n.recipient_id = $2
         ON CONFLICT (notification_id, reader_id) DO NOTHING`,
        [orgId, recipientId]
      );
    }
  } catch (err) {
    console.error('[NotificationService] markAllRead failed:', err.message);
  }
}

// ── Convenience helpers used by controller hooks ────────────────────────────

/**
 * Notify all teachers of a class (via class_employees).
 * Used for assessment events and enrollment changes.
 */
async function notifyClassTeachers(db, { orgId, classId, type, title, body, link, refId }) {
  try {
    const result = await db.query(
      `SELECT DISTINCT user_id FROM class_employees
       WHERE class_id = $1`,
      [classId]
    );
    const list = result.rows.map((r) => ({
      orgId,
      recipientType: 'staff',
      recipientId: r.user_id,
      type, title, body, link, refId,
    }));
    await createNotifications(db, list);
  } catch (err) {
    console.error('[NotificationService] notifyClassTeachers failed:', err.message);
  }
}

/**
 * Notify teachers of multiple classes at once (same link for all).
 */
async function notifyMultipleClassTeachers(db, { orgId, classIds, type, title, body, link, refId }) {
  try {
    if (!classIds || classIds.length === 0) return;
    const result = await db.query(
      `SELECT DISTINCT user_id FROM class_employees
       WHERE class_id = ANY($1::int[])`,
      [classIds]
    );
    const list = result.rows.map((r) => ({
      orgId,
      recipientType: 'staff',
      recipientId: r.user_id,
      type, title, body, link, refId,
    }));
    await createNotifications(db, list);
  } catch (err) {
    console.error('[NotificationService] notifyMultipleClassTeachers failed:', err.message);
  }
}

/**
 * Notify teachers per-class with a class-specific link.
 * linkTemplate: string with {classId} placeholder, e.g. '/common/classDashboard/{classId}/docs'
 * Each teacher gets one notification per class they belong to in classIds.
 */
async function notifyPerClassTeachers(db, { orgId, classIds, type, title, body, linkTemplate, refId }) {
  try {
    if (!classIds || classIds.length === 0) return;
    for (const classId of classIds) {
      const result = await db.query(
        `SELECT DISTINCT user_id FROM class_employees WHERE class_id = $1`,
        [classId]
      );
      if (!result.rows.length) continue;
      const link = linkTemplate ? linkTemplate.replace('{classId}', classId) : null;
      const list = result.rows.map((r) => ({
        orgId,
        recipientType: 'staff',
        recipientId: r.user_id,
        type, title, body, link, refId,
      }));
      await createNotifications(db, list);
    }
  } catch (err) {
    console.error('[NotificationService] notifyPerClassTeachers failed:', err.message);
  }
}

/**
 * Notify all staff that have a given permission.
 * Used for F1 (admission_pending) → APPROVE_ADMISSIONS holders.
 */
async function notifyByPermission(db, { orgId, permission, type, title, body, link, refId }) {
  try {
    // Find users with the permission explicitly granted, plus org owners (Organization account type)
    const result = await db.query(
      `SELECT DISTINCT u.user_id
       FROM users u
       WHERE u.organization_id = $1
         AND u.on_hold IS NOT TRUE
         AND (
           u.account_type = 'Organization'
           OR EXISTS (
             SELECT 1 FROM user_permissions up
             WHERE up.user_id = u.user_id
               AND up.permission = $2
               AND up.granted = TRUE
           )
         )`,
      [orgId, permission]
    );
    const list = result.rows.map((r) => ({
      orgId,
      recipientType: 'staff',
      recipientId: r.user_id,
      type, title, body, link, refId,
    }));
    await createNotifications(db, list);
  } catch (err) {
    console.error('[NotificationService] notifyByPermission failed:', err.message);
  }
}

/**
 * Notify all staff recipients of a guardian report.
 * Primary source: guardian_report_recipients (explicit CC choices).
 * Fallback: Managers, Supervisors, and the student's class teacher — same
 * logic the email digest uses — so the bell always fires even when no CC
 * recipients were selected.
 * Used for A1 (guardian_report_new) and A2 (guardian_reply).
 */
async function notifyReportRecipients(db, { orgId, reportId, type, title, body, link, refId }) {
  try {
    const explicit = await db.query(
      `SELECT DISTINCT user_id FROM guardian_report_recipients WHERE report_id = $1`,
      [reportId]
    );

    let userIds = explicit.rows.map(r => r.user_id);

    // Fallback: if no explicit CC recipients were chosen, notify all Managers +
    // Supervisors in the org, plus the class teacher(s) assigned to the student.
    if (!userIds.length) {
      const fallback = await db.query(
        `SELECT DISTINCT u.user_id
         FROM users u
         WHERE u.organization_id = $1
           AND COALESCE(u.on_hold, FALSE) = FALSE
           AND (
             u.account_type IN ('Manager', 'Supervisor', 'Organization')
             OR (
               u.account_type = 'Teacher'
               AND EXISTS (
                 SELECT 1
                 FROM user_classes uc
                 JOIN students s ON s.class_id = uc.class_id
                 JOIN guardian_reports r ON r.student_id = s.student_id
                 WHERE uc.user_id = u.user_id
                   AND r.report_id = $2
               )
             )
           )`,
        [orgId, reportId]
      );
      userIds = fallback.rows.map(r => r.user_id);
    }

    // Resolve the classId from the report's student so the link goes straight
    // to /common/classDashboard?classId=X&reportId=Y
    let resolvedLink = link;
    try {
      const classRow = await db.query(
        `SELECT s.class_id
         FROM guardian_reports r
         JOIN students s ON s.student_id = r.student_id
         WHERE r.report_id = $1
         LIMIT 1`,
        [reportId]
      );
      if (classRow.rows.length && classRow.rows[0].class_id) {
        resolvedLink = `/common/classDashboard/${classRow.rows[0].class_id}/reports`;
      }
    } catch { /* use original link as fallback */ }

    const list = userIds.map(userId => ({
      orgId,
      recipientType: 'staff',
      recipientId: userId,
      type, title, body, link: resolvedLink, refId,
    }));
    if (list.length) await createNotifications(db, list);
  } catch (err) {
    console.error('[NotificationService] notifyReportRecipients failed:', err.message);
  }
}

module.exports = {
  ensureSchema,
  createNotification,
  createNotifications,
  getUnreadCount,
  getFeed,
  markRead,
  markAllRead,
  dismissNotification,
  dismissAll,
  notifyClassTeachers,
  notifyMultipleClassTeachers,
  notifyPerClassTeachers,
  notifyByPermission,
  notifyReportRecipients,
};
