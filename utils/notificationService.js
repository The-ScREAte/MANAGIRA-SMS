'use strict';

const { renderCleanEmail, sendEmailInBackground, escapeHtml } = require('./emailHelper');

let schemaReady = false;
let birthdaySchemaReady = false;
const birthdaySyncCache = new Map();
const birthdayReadState = new Map();
const birthdayDismissState = new Map();
const birthdayEmailState = new Map();
const organizationNameCache = new Map();

function startOfUtcDay(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getUpcomingBirthdayInfo(dateValue, referenceDate = new Date()) {
  if (!dateValue) return null;
  const birthDate = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = startOfUtcDay(referenceDate);
  let nextBirthday = new Date(Date.UTC(
    today.getUTCFullYear(),
    birthDate.getUTCMonth(),
    birthDate.getUTCDate()
  ));

  if (nextBirthday < today) {
    nextBirthday = new Date(Date.UTC(
      today.getUTCFullYear() + 1,
      birthDate.getUTCMonth(),
      birthDate.getUTCDate()
    ));
  }

  const daysUntil = Math.round((nextBirthday.getTime() - today.getTime()) / 86400000);
  const turningAge = nextBirthday.getUTCFullYear() - birthDate.getUTCFullYear();
  const displayDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(nextBirthday);

  return {
    nextBirthday,
    daysUntil,
    turningAge: Number.isFinite(turningAge) ? turningAge : null,
    displayDate,
    birthdayYear: nextBirthday.getUTCFullYear(),
  };
}

function getBirthdayMessagePool(kind) {
  if (kind === 'student') {
    return [
      'Thank you for having your beautiful child be part of our school family. We appreciate your child\'s contribution and we celebrate with you.',
      'Your child is a valued part of our community. Thank you for your support and partnership as we celebrate this special day together.',
      'We are grateful for your child and the joy they bring to our school. Thank you for trusting us to be part of their journey.',
      'As your child celebrates today, we want to say thank you for being a wonderful parent and partner in learning.',
    ];
  }
  if (kind === 'guardian') {
    return [
      'Thank you for the care and love you give. We appreciate your child\'s contribution and we are grateful for your family.',
      'We celebrate you today with gratitude. Thank you for trusting us and for being an important part of our school community.',
      'Best regards from your school family. We appreciate you, and we send love to you and your child.',
      'Your support means so much to us. May your birthday be sweet, peaceful, and full of joy.',
    ];
  }
  return [
    'We wish you a joyful birthday filled with peace, progress, laughter, and memorable moments.',
    'May this new year of life bring fresh strength, bright opportunities, and deep personal fulfillment.',
    'Wishing you a birthday marked by joy today and success in the journey ahead.',
    'May your day feel special, your work feel meaningful, and your year unfold beautifully.',
  ];
}

function chooseBirthdayMessage(kind, seedValue) {
  const pool = getBirthdayMessagePool(kind);
  const seed = String(seedValue || '0');
  let total = 0;
  for (let index = 0; index < seed.length; index += 1) total += seed.charCodeAt(index);
  return pool[total % pool.length];
}

function buildBirthdayEmailHtml({ greetingName, celebrantName, subtitle, kind, seedValue, organizationName }) {
  const schoolName = String(organizationName || 'Your School').trim() || 'Your School';
  return renderCleanEmail({
    title: `Happy Birthday from ${schoolName}`,
    greeting: `Dear ${escapeHtml(greetingName || celebrantName || 'Friend')},`,
    paragraphs: [
      `Happy Birthday from ${escapeHtml(schoolName)}. Today we are celebrating ${escapeHtml(celebrantName || greetingName || 'you')}, and we are sending this note with love.`,
      chooseBirthdayMessage(kind, seedValue),
      'We wish your family joy, good health, peace, and beautiful moments in the year ahead.',
      escapeHtml(subtitle || `We love you both. Best regards from ${schoolName}.`),
    ],
    note: `Best regards from ${schoolName}.`,
    noReply: true,
  });
}

async function getOrganizationName(db, orgId) {
  const numericOrgId = Number(orgId || 0);
  if (!numericOrgId) return 'Your School';
  if (organizationNameCache.has(numericOrgId)) return organizationNameCache.get(numericOrgId);
  try {
    const result = await db.query(
      `SELECT organization_name FROM organizations WHERE organization_id = $1 LIMIT 1`,
      [numericOrgId]
    );
    const orgName = String(result.rows[0]?.organization_name || 'Your School').trim() || 'Your School';
    organizationNameCache.set(numericOrgId, orgName);
    return orgName;
  } catch (_error) {
    return 'Your School';
  }
}

function shouldSyncBirthdays(orgId) {
  const numericOrgId = Number(orgId || 0);
  if (!numericOrgId) return false;
  const entry = birthdaySyncCache.get(numericOrgId);
  const now = Date.now();
  if (entry && now - entry < 5 * 60 * 1000) return false;
  birthdaySyncCache.set(numericOrgId, now);
  return true;
}

function getRecipientStateSet(map, { recipientType, recipientId, orgId }) {
  const key = `${recipientType}:${recipientId}:${orgId}`;
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
}

function isBirthdayItemRead(context, itemId) {
  return getRecipientStateSet(birthdayReadState, context).has(itemId);
}

function isBirthdayItemDismissed(context, itemId) {
  return getRecipientStateSet(birthdayDismissState, context).has(itemId);
}

function markBirthdayItemRead(context, itemId) {
  getRecipientStateSet(birthdayReadState, context).add(itemId);
}

function dismissBirthdayItem(context, itemId) {
  getRecipientStateSet(birthdayDismissState, context).add(itemId);
}

function buildBirthdayItemId(parts) {
  return `birthday:${parts.join(':')}`;
}

function buildBirthdayEmailStateKey(orgId, entityType, entityId, recipientEmail, birthdayYear, emailKind) {
  return [orgId, entityType, entityId, String(recipientEmail || '').trim().toLowerCase(), birthdayYear, emailKind].join(':');
}

async function ensureBirthdaySchema(db) {
  if (birthdaySchemaReady) return;
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
  await db.query(`ALTER TABLE guardians ADD COLUMN IF NOT EXISTS date_of_birth DATE`).catch(() => {});
  await db.query(`ALTER TABLE guardian_profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE`).catch(() => {});
  birthdaySchemaReady = true;
}

async function ensureSchema(db) {
  if (schemaReady) return;
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
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notif_org_recip
    ON notifications (organization_id, recipient_type, recipient_id, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notif_broadcast
    ON notifications (organization_id, recipient_type, created_at DESC)
    WHERE recipient_type = 'broadcast'`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notif_reads_reader
    ON notification_reads (reader_id, notification_id)`);
  await ensureBirthdaySchema(db);
  schemaReady = true;
}

async function createNotification(db, opts) {
  try {
    const { orgId, recipientType, recipientId = 0, type, title, body = null, link = null, refId = null } = opts;
    if (!orgId || !recipientType || !type || !title) return null;
    await ensureSchema(db);
    const result = await db.query(
      `INSERT INTO notifications
         (organization_id, recipient_type, recipient_id, type, title, body, link, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, created_at`,
      [orgId, recipientType, recipientId, type, title, body, link, refId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('[NotificationService] createNotification failed:', err.message);
    return null;
  }
}

async function createNotifications(db, list) {
  if (!list || list.length === 0) return;
  try {
    await ensureSchema(db);
    const values = [];
    const params = [];
    let idx = 1;
    for (const opts of list) {
      const { orgId, recipientType, recipientId = 0, type, title, body = null, link = null, refId = null } = opts;
      if (!orgId || !recipientType || !type || !title) continue;
      values.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7})`);
      params.push(orgId, recipientType, recipientId, type, title, body, link, refId);
      idx += 8;
    }
    if (!values.length) return;
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

async function queueBirthdayEmailIfNeeded(opts) {
  const { orgId, entityType, entityId, recipientEmail, birthdayYear, emailKind, subject, html } = opts;
  // Safety gate: birthday emails are parent/guardian-only.
  if (!['student', 'guardian'].includes(String(entityType || '').trim().toLowerCase())) return;
  const normalizedEmail = String(recipientEmail || '').trim().toLowerCase();
  if (!normalizedEmail || !subject || !html) return;
  const key = buildBirthdayEmailStateKey(orgId, entityType, entityId, normalizedEmail, birthdayYear, emailKind);
  if (birthdayEmailState.has(key)) return;
  birthdayEmailState.set(key, Date.now());
  sendEmailInBackground({ to: normalizedEmail, subject, html }, `Birthday:${emailKind}`);
}

async function getStaffBirthdayContext(db, { recipientId, orgId }) {
  const numericRecipientId = Number(recipientId || 0);
  if (numericRecipientId === 0) {
    return { isElevated: true, assignedClassIds: null };
  }

  const [roleResult, classResult] = await Promise.all([
    db.query(
      `SELECT account_type
       FROM users
       WHERE user_id = $1 AND organization_id = $2
       LIMIT 1`,
      [numericRecipientId, orgId]
    ),
    db.query(
      `SELECT class_id
       FROM user_classes
       WHERE user_id = $1`,
      [numericRecipientId]
    ),
  ]);

  const role = String(roleResult.rows[0]?.account_type || '').trim().toLowerCase();
  return {
    isElevated: ['manager', 'supervisor', 'admin', 'mini admin', 'organization'].includes(role),
    assignedClassIds: classResult.rows.map((row) => Number(row.class_id || 0)).filter(Boolean),
  };
}

async function getDynamicBirthdayItems(db, context) {
  const { recipientType, recipientId, orgId } = context;
  if (recipientType !== 'staff') return [];
  await ensureBirthdaySchema(db);

  const roleContext = await getStaffBirthdayContext(db, { recipientId, orgId });
  const [studentsResult, staffResult, guardianResult] = await Promise.all([
    db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.class_id, c.class_name
       FROM students s
       JOIN classes c ON c.class_id = s.class_id
       WHERE s.organization_id = $1
         AND s.class_id IS NOT NULL
         AND s.date_of_birth IS NOT NULL
       ORDER BY c.class_name, s.last_name, s.first_name`,
      [orgId]
    ),
    db.query(
      `SELECT user_id, first_name, last_name, email, date_of_birth, account_type
       FROM users
       WHERE organization_id = $1
         AND COALESCE(on_hold, FALSE) = FALSE
         AND date_of_birth IS NOT NULL
       ORDER BY first_name, last_name`,
      [orgId]
    ),
    db.query(
      `SELECT gp.guardian_id,
              gp.first_name,
              gp.last_name,
              gp.email,
              gp.date_of_birth,
              s.student_id,
              s.first_name AS student_first_name,
              s.last_name AS student_last_name,
              c.class_id,
              c.class_name
       FROM guardian_profiles gp
       JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
       JOIN students s ON s.student_id = gs.student_id
       LEFT JOIN classes c ON c.class_id = s.class_id
       WHERE gp.organization_id = $1
         AND gp.date_of_birth IS NOT NULL
       ORDER BY gp.first_name, gp.last_name, s.first_name, s.last_name`,
      [orgId]
    ).catch(async () => {
      return db.query(
        `SELECT g.guardian_id,
                g.first_name,
                g.last_name,
                g.email,
                g.date_of_birth,
                s.student_id,
                s.first_name AS student_first_name,
                s.last_name AS student_last_name,
                c.class_id,
                c.class_name
         FROM guardians g
         JOIN students s ON s.student_id = g.student_id
         LEFT JOIN classes c ON c.class_id = s.class_id
         WHERE g.organization_id = $1
           AND g.date_of_birth IS NOT NULL
         ORDER BY g.first_name, g.last_name, s.first_name, s.last_name`,
        [orgId]
      );
    }),
  ]);

  const items = [];
  const visibleClasses = new Set(roleContext.assignedClassIds || []);
  const nowIso = new Date().toISOString();
  const organizationName = await getOrganizationName(db, orgId);

  for (const student of studentsResult.rows) {
    const info = getUpcomingBirthdayInfo(student.date_of_birth);
    if (!info || info.daysUntil !== 0) continue;
    const classId = Number(student.class_id || 0);
    if (!roleContext.isElevated && !visibleClasses.has(classId)) continue;

    const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ').trim();
    const itemId = buildBirthdayItemId(['student', student.student_id, recipientId || 0]);
    if (!isBirthdayItemDismissed(context, itemId)) {
      items.push({
        id: itemId,
        type: 'birthday_student',
        title: `Birthday today: ${studentName}`,
        body: `${student.class_name || 'Class student'} · ${chooseBirthdayMessage('student', `${student.student_id}:${recipientId || 0}`)}`,
        link: '/common/birthdays',
        created_at: nowIso,
        is_read: isBirthdayItemRead(context, itemId),
      });
    }

    const studentGuardians = await db.query(
      `SELECT DISTINCT email
       FROM (
         SELECT gp.email
         FROM guardian_profiles gp
         JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
         WHERE gs.student_id = $1 AND gp.organization_id = $2
         UNION
         SELECT g.email
         FROM guardians g
         WHERE g.student_id = $1 AND g.organization_id = $2
       ) guardian_emails
       WHERE email IS NOT NULL AND TRIM(email) <> ''`,
      [student.student_id, orgId]
    ).catch(() => ({ rows: [] }));

    for (const row of studentGuardians.rows) {
      await queueBirthdayEmailIfNeeded({
        orgId,
        entityType: 'student',
        entityId: Number(student.student_id),
        recipientEmail: row.email,
        birthdayYear: info.birthdayYear,
        emailKind: 'student_birthday',
        subject: `Happy Birthday to ${studentName} from ${organizationName}`,
        html: buildBirthdayEmailHtml({
          greetingName: 'Parent/Guardian',
          celebrantName: studentName,
          subtitle: `Thank you for having your beautiful child be part of us. We appreciate your child's contribution, and we love you both. Best regards from ${organizationName}.`,
          kind: 'student',
          seedValue: `${student.student_id}`,
          organizationName,
        }),
      });
    }
  }

  for (const staff of staffResult.rows) {
    const info = getUpcomingBirthdayInfo(staff.date_of_birth);
    if (!info || info.daysUntil !== 0) continue;
    const staffName = [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim();
    const itemId = buildBirthdayItemId(['staff', staff.user_id, recipientId || 0]);
    if (!isBirthdayItemDismissed(context, itemId)) {
      items.push({
        id: itemId,
        type: 'birthday_staff',
        title: `Birthday today: ${staffName}`,
        body: `${staff.account_type || 'Staff'} · ${chooseBirthdayMessage('staff', `${staff.user_id}:${recipientId || 0}`)}`,
        link: '/common/orgDashboard',
        created_at: nowIso,
        is_read: isBirthdayItemRead(context, itemId),
      });
    }
    // Intentionally do not send birthday emails to staff/teachers.
  }

  if (roleContext.isElevated) {
    const guardianMap = new Map();
    for (const row of guardianResult.rows) {
      const guardianId = Number(row.guardian_id || 0);
      if (!guardianId) continue;
      const info = getUpcomingBirthdayInfo(row.date_of_birth);
      if (!info || info.daysUntil !== 0) continue;
      if (!guardianMap.has(guardianId)) {
        guardianMap.set(guardianId, {
          guardian_id: guardianId,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          birthdayInfo: info,
          students: [],
        });
      }
      guardianMap.get(guardianId).students.push({
        name: [row.student_first_name, row.student_last_name].filter(Boolean).join(' ').trim(),
        class_id: row.class_id,
      });
    }

    for (const guardian of guardianMap.values()) {
      const guardianName = [guardian.first_name, guardian.last_name].filter(Boolean).join(' ').trim();
      if (guardian.email) {
        await queueBirthdayEmailIfNeeded({
          orgId,
          entityType: 'guardian',
          entityId: guardian.guardian_id,
          recipientEmail: guardian.email,
          birthdayYear: guardian.birthdayInfo.birthdayYear,
          emailKind: 'guardian_birthday',
          subject: `Happy Birthday from ${organizationName}`,
          html: buildBirthdayEmailHtml({
            greetingName: guardian.first_name || guardianName,
            celebrantName: guardianName,
            subtitle: `Thank you for having your beautiful child be part of us. We appreciate your child's contribution, and we love you both. Best regards from ${organizationName}.`,
            kind: 'guardian',
            seedValue: `${guardian.guardian_id}`,
            organizationName,
          }),
        });
      }
    }
  }

  return items.sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}

async function syncBirthdayNotifications(db, { orgId }) {
  try {
    await ensureBirthdaySchema(db);
    if (!shouldSyncBirthdays(orgId)) return;
    await getDynamicBirthdayItems(db, { recipientType: 'staff', recipientId: 0, orgId });
  } catch (err) {
    console.error('[NotificationService] syncBirthdayNotifications failed:', err.message);
  }
}

async function getUnreadCount(db, context) {
  const { recipientType, recipientId, orgId } = context;
  try {
    await ensureSchema(db);

    let baseCount = 0;
    if (recipientType === 'staff') {
      const result = await db.query(
        `SELECT COUNT(*)::int AS cnt
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.type NOT IN ('birthday_student', 'birthday_staff', 'birthday_guardian')
           AND (
             (n.recipient_type = 'staff' AND n.recipient_id = $2)
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
      baseCount = result.rows[0]?.cnt ?? 0;
      const birthdayItems = await getDynamicBirthdayItems(db, context);
      return baseCount + birthdayItems.filter((item) => !item.is_read).length;
    }

    if (recipientType === 'guardian') {
      const result = await db.query(
        `SELECT COUNT(*)::int AS cnt
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.type NOT IN ('birthday_student', 'birthday_staff', 'birthday_guardian')
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

async function getFeed(db, context) {
  const { recipientType, recipientId, orgId, limit = 20 } = context;
  try {
    await ensureSchema(db);
    const safeLimit = Math.min(Number.parseInt(limit, 10) || 20, 50);

    if (recipientType === 'staff') {
      const result = await db.query(
        `SELECT n.*, (nr.reader_id IS NOT NULL) AS is_read
         FROM notifications n
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id AND nr.reader_id = $2
         WHERE n.organization_id = $1
           AND n.type NOT IN ('birthday_student', 'birthday_staff', 'birthday_guardian')
           AND (
             (n.recipient_type = 'staff' AND n.recipient_id = $2)
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
      const birthdayItems = await getDynamicBirthdayItems(db, context);
      return [...birthdayItems, ...result.rows]
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .slice(0, safeLimit);
    }

    if (recipientType === 'guardian') {
      const result = await db.query(
        `SELECT n.*, (nr.reader_id IS NOT NULL) AS is_read
         FROM notifications n
         LEFT JOIN notification_reads nr
           ON nr.notification_id = n.id AND nr.reader_id = $2
         WHERE n.organization_id = $1
           AND n.type NOT IN ('birthday_student', 'birthday_staff', 'birthday_guardian')
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

async function dismissNotification(db, { notifId, dismisserId, recipientType = 'staff', orgId = null }) {
  try {
    if (String(notifId).startsWith('birthday:')) {
      dismissBirthdayItem({ recipientType, recipientId: dismisserId, orgId }, String(notifId));
      return;
    }
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

async function dismissAll(db, context) {
  const { recipientType, recipientId, orgId } = context;
  try {
    await ensureSchema(db);
    if (recipientType === 'staff') {
      await db.query(
        `INSERT INTO notification_dismissals (notification_id, dismisser_id)
         SELECT n.id, $2
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.type NOT IN ('birthday_student', 'birthday_staff', 'birthday_guardian')
           AND (
             (n.recipient_type = 'staff' AND n.recipient_id = $2)
             OR n.recipient_type = 'broadcast'
           )
         ON CONFLICT (notification_id, dismisser_id) DO NOTHING`,
        [orgId, recipientId]
      );
      const birthdayItems = await getDynamicBirthdayItems(db, context);
      getRecipientStateSet(birthdayDismissState, context);
      birthdayItems.forEach((item) => dismissBirthdayItem(context, item.id));
    } else if (recipientType === 'guardian') {
      await db.query(
        `INSERT INTO notification_dismissals (notification_id, dismisser_id)
         SELECT n.id, $2
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.type NOT IN ('birthday_student', 'birthday_staff', 'birthday_guardian')
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

async function markRead(db, { notifId, readerId, recipientType = 'staff', orgId = null }) {
  try {
    if (String(notifId).startsWith('birthday:')) {
      markBirthdayItemRead({ recipientType, recipientId: readerId, orgId }, String(notifId));
      return;
    }
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

async function markAllRead(db, context) {
  const { recipientType, recipientId, orgId } = context;
  try {
    await ensureSchema(db);
    if (recipientType === 'staff') {
      await db.query(
        `INSERT INTO notification_reads (notification_id, reader_id)
         SELECT n.id, $2
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.type NOT IN ('birthday_student', 'birthday_staff', 'birthday_guardian')
           AND (
             (n.recipient_type = 'staff' AND n.recipient_id = $2)
             OR n.recipient_type = 'broadcast'
           )
         ON CONFLICT (notification_id, reader_id) DO NOTHING`,
        [orgId, recipientId]
      );
      const birthdayItems = await getDynamicBirthdayItems(db, context);
      birthdayItems.forEach((item) => markBirthdayItemRead(context, item.id));
    } else if (recipientType === 'guardian') {
      await db.query(
        `INSERT INTO notification_reads (notification_id, reader_id)
         SELECT n.id, $2
         FROM notifications n
         WHERE n.organization_id = $1
           AND n.type NOT IN ('birthday_student', 'birthday_staff', 'birthday_guardian')
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

async function notifyClassTeachers(db, { orgId, classId, type, title, body, link, refId }) {
  try {
    const result = await db.query(
      `SELECT DISTINCT user_id FROM user_classes
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

async function notifyMultipleClassTeachers(db, { orgId, classIds, type, title, body, link, refId }) {
  try {
    if (!classIds || classIds.length === 0) return;
    const result = await db.query(
      `SELECT DISTINCT user_id FROM user_classes
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

async function notifyPerClassTeachers(db, { orgId, classIds, type, title, body, linkTemplate, refId }) {
  try {
    if (!classIds || classIds.length === 0) return;
    for (const classId of classIds) {
      const result = await db.query(
        `SELECT DISTINCT user_id FROM user_classes WHERE class_id = $1`,
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

async function notifyByPermission(db, { orgId, permission, type, title, body, link, refId }) {
  try {
    const result = await db.query(
      `SELECT DISTINCT u.user_id
       FROM users u
       WHERE u.organization_id = $1
         AND u.on_hold IS NOT TRUE
         AND (
           u.account_type::text = 'Manager'
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

async function notifyReportRecipients(db, { orgId, reportId, type, title, body, link, refId }) {
  try {
    const explicit = await db.query(
      `SELECT DISTINCT user_id FROM guardian_report_recipients WHERE report_id = $1`,
      [reportId]
    );

    let userIds = explicit.rows.map((r) => r.user_id);

    if (!userIds.length) {
      const fallback = await db.query(
        `SELECT DISTINCT u.user_id
         FROM users u
         WHERE u.organization_id = $1
           AND COALESCE(u.on_hold, FALSE) = FALSE
           AND (
             u.account_type::text IN ('Manager', 'Supervisor', 'Organization')
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
      userIds = fallback.rows.map((r) => r.user_id);
    }

    // Callers pass the conversation link (/common/parent-messages/:id), which
    // routes each person to their class page or Mail Room. Without one, fall
    // back to the student's class page.
    let resolvedLink = link;
    if (!resolvedLink) try {
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
    } catch {
      // Use original link.
    }

    const list = userIds.map((userId) => ({
      orgId,
      recipientType: 'staff',
      recipientId: userId,
      type,
      title,
      body,
      link: resolvedLink,
      refId: refId || reportId,
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
  syncBirthdayNotifications,
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
