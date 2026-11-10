'use strict';
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const ns = require('../utils/notificationService');
const {
  getNotifCountCachedOrFetch,
  invalidateNotifCountCache,
} = require('../middleware/fetchNotifCount');

let staffPopupSchemaReady = false;

async function ensureStaffPopupSchema() {
  if (staffPopupSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS staff_term_popup_views (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      term_id INTEGER NOT NULL REFERENCES terms(term_id) ON DELETE CASCADE,
      popup_type VARCHAR(50) NOT NULL,
      shown_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (organization_id, user_id, term_id, popup_type)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_staff_term_popup_views_lookup
      ON staff_term_popup_views (organization_id, user_id, term_id, popup_type)
  `);
  staffPopupSchemaReady = true;
}

function resolveStaffReaderId(session) {
  const directUserId = session.userId || (session.user && session.user.user_id) || null;
  if (directUserId) return Number(directUserId);

  const accountType = String(session.accountType || session.user?.account_type || '').trim().toLowerCase();
  const userRole = String(session.userRole || session.user?.role || '').trim().toLowerCase();
  if (accountType === 'organization' && userRole === 'manager') {
    return 0;
  }

  return null;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
function resolveReaderContext(req) {
  const session = req.session || {};
  const orgId = session.organizationId;
  if (session.userRole === 'Student' || session.accountType === 'Student') {
    const studentId = session.studentId || session.userId || null;
    if (!studentId || !orgId) return null;
    return { recipientType: 'student', recipientId: Number(studentId), orgId: Number(orgId), testingRoom: require('../controllers/studentController').canUseStudentTestingRoom(req) };
  }
  // Guardian portal
  if (session.userRole === 'Guardian' || session.accountType === 'Guardian') {
    const guardianId = session.guardianId || session.userId || null;
    if (!guardianId || !orgId) return null;
    return { recipientType: 'guardian', recipientId: Number(guardianId), orgId: Number(orgId) };
  }
  // Staff / org owner
  const userId = resolveStaffReaderId(session);
  if (userId === null || !orgId) return null;
  return { recipientType: 'staff', recipientId: Number(userId), orgId: Number(orgId), who: require('../utils/notificationAudience').staffWho(session) };
}

// People signed in to a hub get the hub's own feed (see utils/hubNotifications).
async function hubFeedFor(req) {
  const { loadHubActor } = require('../utils/hubAccess');
  const actor = await loadHubActor(db, req.session);
  return actor ? { actor, hubId: Number(req.session.hubId) } : null;
}
router.use(async (req, res, next) => {
  const session = req.session || {};
  if (!(session.hubId && session.accountType === 'Hub')) return next();
  try {
    const hubNotes = require('../utils/hubNotifications');
    const ctx = await hubFeedFor(req);
    if (!ctx) return res.status(401).json({ success: false, error: 'Unauthenticated' });
    const id = String((req.body && req.body.notifId) || '').trim();
    if (req.method === 'GET' && req.path === '/count') {
      const items = await hubNotes.buildFeed(db, ctx.hubId, ctx.actor);
      return res.json({ success: true, count: items.filter((i) => !i.is_read).length });
    }
    if (req.method === 'GET' && req.path === '/feed') {
      return res.json({ success: true, notifications: await hubNotes.buildFeed(db, ctx.hubId, ctx.actor) });
    }
    if (req.method === 'POST' && (req.path === '/mark-read' || req.path === '/dismiss')) {
      await hubNotes.mark(db, ctx.hubId, ctx.actor, [id], req.path === '/dismiss');
      return res.json({ success: true });
    }
    if (req.method === 'POST' && (req.path === '/mark-all-read' || req.path === '/dismiss-all')) {
      const items = await hubNotes.buildFeed(db, ctx.hubId, ctx.actor);
      await hubNotes.mark(db, ctx.hubId, ctx.actor, items.map((i) => i.id), req.path === '/dismiss-all');
      return res.json({ success: true });
    }
    // Popups and other school-only extras: nothing for hubs.
    return res.json({ success: true, notifications: [], count: 0, show: false });
  } catch (err) {
    console.error('[notifications:hub]', err.message);
    return res.json({ success: true, notifications: [], count: 0 });
  }
});

function requireAuth(req, res, next) {
  const ctx = resolveReaderContext(req);
  if (!ctx) return res.status(401).json({ success: false, error: 'Unauthenticated' });
  req._notifCtx = { ...ctx, timeZone: require('../utils/localDate').timeZoneOf(req) };
  next();
}

function startOfDay(dateLike) {
  const d = new Date(dateLike);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function diffDays(from, to) {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.ceil(ms / 86400000);
}

function getStudentNotifState(req) {
  const session = req.session;
  if (!session.studentNotifState || typeof session.studentNotifState !== 'object') {
    session.studentNotifState = { readIds: [], dismissedIds: [], birthdayPopupShownAt: '' };
  }
  const readIds = new Set(Array.isArray(session.studentNotifState.readIds) ? session.studentNotifState.readIds : []);
  const dismissedIds = new Set(Array.isArray(session.studentNotifState.dismissedIds) ? session.studentNotifState.dismissedIds : []);
  return { state: session.studentNotifState, readIds, dismissedIds };
}

function persistStudentNotifState(req, readIds, dismissedIds, birthdayPopupShownAt) {
  req.session.studentNotifState = {
    readIds: Array.from(readIds).slice(-500),
    dismissedIds: Array.from(dismissedIds).slice(-500),
    birthdayPopupShownAt: birthdayPopupShownAt || req.session.studentNotifState?.birthdayPopupShownAt || '',
  };
}

function isManagerOrSupervisorSession(req) {
  const session = req.session || {};
  const accountType = String(session.accountType || session.user?.account_type || '').trim().toLowerCase();
  const userRole = String(session.userRole || session.user?.role || '').trim().toLowerCase();
  return ['manager', 'supervisor'].includes(accountType)
    || ['manager', 'supervisor'].includes(userRole)
    || (accountType === 'organization' && userRole === 'manager');
}

// A student's bell, built when asked: their birthday, the term starting or ending soon, online
// tests they can take now or that open within two weeks (when their school has the Testing Room),
// and grades their teacher posted and shared with them. Gradebook-only assessments, closed tests
// and anything for staff never show.
async function buildStudentNotifications(db, { orgId, studentId, testingRoom = false }) {
  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  const items = [];

  const [studentResult, termResult] = await Promise.all([
    db.query(
      `SELECT student_id, first_name, last_name, date_of_birth, class_id
       FROM students
       WHERE organization_id = $1 AND student_id = $2
       LIMIT 1`,
      [orgId, studentId]
    ),
    db.query(
      `SELECT t.term_id, t.term_name, t.start_date, t.end_date, sy.year_label
       FROM terms t
       JOIN school_years sy ON sy.id = t.school_year_id
       WHERE t.organization_id = $1 AND t.current = TRUE
       ORDER BY t.start_date DESC, t.term_id DESC
       LIMIT 1`,
      [orgId]
    ),
  ]);

  const student = studentResult.rows[0];
  const term = termResult.rows[0];
  if (!student) return [];

  // The term: two weeks before it starts, its last week, and the week after it ends.
  if (term) {
    const start = new Date(term.start_date);
    const end = new Date(term.end_date);
    const startIn = diffDays(now, start);
    const endIn = diffDays(now, end);
    if (startIn > 0 && startIn <= 14) {
      items.push({
        id: `student-term-start-${term.term_id}`,
        type: 'term_changed',
        title: `${term.term_name} starts soon`,
        body: `${startIn} day${startIn === 1 ? '' : 's'} to go (${formatDateLabel(term.start_date)}).`,
        link: '/student/dashboard',
        created_at: new Date(start.getTime() - 14 * DAY).toISOString(),
      });
    } else if (startIn <= 0 && endIn >= 0 && endIn <= 7) {
      items.push({
        id: `student-term-end-${term.term_id}`,
        type: 'term_changed',
        title: `${term.term_name} ends soon`,
        body: `Last day ${formatDateLabel(term.end_date)}.`,
        link: '/student/dashboard',
        created_at: new Date(end.getTime() - 7 * DAY).toISOString(),
      });
    } else if (endIn < 0 && endIn >= -7) {
      items.push({
        id: `student-term-ended-${term.term_id}`,
        type: 'term_changed',
        title: `${term.term_name} has ended`,
        body: `It ended ${formatDateLabel(term.end_date)}.`,
        link: '/student/dashboard',
        created_at: end.toISOString(),
      });
    }
  }

  if (student.date_of_birth) {
    const dob = new Date(student.date_of_birth);
    if (dob.getMonth() === now.getMonth() && dob.getDate() === now.getDate()) {
      const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ').trim() || 'Student';
      items.push({
        id: `student-birthday-${student.student_id}-${now.getFullYear()}`,
        type: 'birthday_student',
        title: `Happy Birthday, ${studentName}!`,
        body: 'Wishing you joy, growth, and a wonderful school year ahead.',
        link: '/student/dashboard',
        created_at: now.toISOString(),
      });
    }
  }

  if (!term) return items;
  const { resolveCurrentStudentTermContext, getOpenAssessments } = require('../controllers/studentController');
  const context = await resolveCurrentStudentTermContext(db, orgId, studentId).catch(() => ({}));
  const classId = context.enrolledClassId || student.class_id;

  if (testingRoom && classId) {
    // Tests ready to take now: approved questions, open, attempts left, not locked.
    const open = await getOpenAssessments(db, orgId, studentId, classId, term.term_id).catch(() => []);
    open.forEach((row) => {
      const closes = row.edit_window_end ? new Date(row.edit_window_end) : null;
      items.push({
        id: `student-test-ready-${row.assessment_id}`,
        type: 'assessment_unlocked',
        title: `Ready to take: ${row.title}`,
        body: `${row.subject_name || 'Online test'}${closes ? ` · closes ${formatDateLabel(closes)}` : ''}`,
        link: '/student/testing-room',
        created_at: new Date(row.latest_question_update || now).toISOString(),
      });
    });
    // Tests opening within two weeks.
    const soon = await db.query(
      `SELECT a.assessment_id, a.title, a.edit_window_start, s.subject_name
         FROM assessments a
         JOIN subjects s ON s.subject_id = a.subject_id AND s.organization_id = a.organization_id
        WHERE a.organization_id = $1 AND a.class_id = $2 AND a.term_id = $3
          AND COALESCE(a.is_active, TRUE) = TRUE
          AND a.edit_window_start > NOW() AND a.edit_window_start <= NOW() + INTERVAL '14 days'
          AND EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.organization_id = $1 AND ss.student_id = $4 AND ss.subject_id = a.subject_id)
          AND EXISTS (SELECT 1 FROM assessment_question_sets qs
                       WHERE qs.organization_id = $1 AND qs.assessment_id = a.assessment_id
                         AND LOWER(COALESCE(qs.review_status, 'pending')) = 'approved' AND COALESCE(qs.is_active, TRUE)
                         AND (qs.retake_student_id IS NULL OR qs.retake_student_id = $4))
        ORDER BY a.edit_window_start
        LIMIT 10`,
      [orgId, classId, term.term_id, studentId]
    ).catch(() => ({ rows: [] }));
    soon.rows.forEach((row) => {
      const opens = new Date(row.edit_window_start);
      const days = Math.max(1, diffDays(now, opens));
      items.push({
        id: `student-test-soon-${row.assessment_id}`,
        type: 'assessment_created',
        title: `Opens soon: ${row.title}`,
        body: `${row.subject_name || 'Online test'} · in ${days} day${days === 1 ? '' : 's'} (${formatDateLabel(opens)})`,
        link: '/student/testing-room',
        created_at: new Date(opens.getTime() - 14 * DAY).toISOString(),
      });
    });
  }

  // Grades the teacher posted and shared (the assessments flow).
  if (require('../utils/assessmentApproval').flowOn(orgId)) {
    const shared = await require('../utils/testResults').sharedResults(db, orgId, Number(studentId), { classId, termId: term.term_id }).catch(() => []);
    shared.slice(0, 10).forEach((row) => {
      const grade = row.choice || (row.score != null ? `${Number(row.score.toFixed(2))} / ${row.maxScore}` : '');
      items.push({
        id: `student-grade-${row.attemptId}`,
        type: 'grade_posted',
        title: `Grade posted: ${row.title}`,
        body: [row.subject, grade].filter(Boolean).join(' · '),
        link: row.full ? `/student/testing-room/result/${row.attemptId}` : '/student/testing-room',
        created_at: new Date(row.submittedAt || now).toISOString(),
      });
    });
  }

  return items
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 30);
}

// ── GET /notifications/count ──────────────────────────────────────────────────
router.get('/count', requireAuth, async (req, res) => {
  try {
    if (req._notifCtx.recipientType === 'student') {
      const { readIds, dismissedIds } = getStudentNotifState(req);
      const items = await buildStudentNotifications(db, { ...req._notifCtx, studentId: req._notifCtx.recipientId });
      const count = items.filter((item) => !readIds.has(item.id) && !dismissedIds.has(item.id)).length;
      return res.json({ success: true, count });
    }
    const count = await getNotifCountCachedOrFetch(db, req._notifCtx);
    res.json({ success: true, count });
  } catch (err) {
    res.json({ success: true, count: 0 });
  }
});

// ── GET /notifications/feed ───────────────────────────────────────────────────
router.get('/feed', requireAuth, async (req, res) => {
  try {
    if (req._notifCtx.recipientType === 'student') {
      const { readIds, dismissedIds } = getStudentNotifState(req);
      const items = await buildStudentNotifications(db, { ...req._notifCtx, studentId: req._notifCtx.recipientId });
      const notifications = items
        .filter((item) => !dismissedIds.has(item.id))
        .map((item) => ({ ...item, is_read: readIds.has(item.id) }));
      return res.json({ success: true, notifications });
    }
    const items = await ns.getFeed(db, { ...req._notifCtx, limit: 30 });
    res.json({ success: true, notifications: items });
  } catch (err) {
    res.json({ success: true, notifications: [] });
  }
});

// ── POST /notifications/mark-read ─────────────────────────────────────────────
router.post('/mark-read', requireAuth, express.json(), async (req, res) => {
  try {
    const rawNotifId = String(req.body.notifId || '').trim();
    if (!rawNotifId) {
      return res.status(400).json({ success: false, error: 'Invalid notifId' });
    }
    if (req._notifCtx.recipientType === 'student') {
      const { state, readIds, dismissedIds } = getStudentNotifState(req);
      readIds.add(rawNotifId);
      persistStudentNotifState(req, readIds, dismissedIds, state.birthdayPopupShownAt);
      return res.json({ success: true });
    }

    if (rawNotifId.startsWith('birthday:')) {
      await ns.markRead(db, {
        notifId: rawNotifId,
        readerId: req._notifCtx.recipientId,
        recipientType: req._notifCtx.recipientType,
        orgId: req._notifCtx.orgId,
      });
      invalidateNotifCountCache(req._notifCtx.recipientType, req._notifCtx.recipientId, req._notifCtx.orgId);
      return res.json({ success: true });
    }
    const notifId = Number.parseInt(rawNotifId, 10);
    if (!Number.isInteger(notifId) || notifId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid notifId' });
    }
    // Verify the notification belongs to this org before marking read
    const check = await db.query(
      `SELECT id FROM notifications WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [notifId, req._notifCtx.orgId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Not found' });
    }
    await ns.markRead(db, { notifId, readerId: req._notifCtx.recipientId });
    invalidateNotifCountCache(req._notifCtx.recipientType, req._notifCtx.recipientId, req._notifCtx.orgId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ── POST /notifications/mark-all-read ────────────────────────────────────────
router.post('/mark-all-read', requireAuth, async (req, res) => {
  try {
    if (req._notifCtx.recipientType === 'student') {
      const { state, readIds, dismissedIds } = getStudentNotifState(req);
      const items = await buildStudentNotifications(db, { ...req._notifCtx, studentId: req._notifCtx.recipientId });
      items.forEach((item) => {
        if (!dismissedIds.has(item.id)) readIds.add(item.id);
      });
      persistStudentNotifState(req, readIds, dismissedIds, state.birthdayPopupShownAt);
      return res.json({ success: true });
    }
    await ns.markAllRead(db, req._notifCtx);
    invalidateNotifCountCache(req._notifCtx.recipientType, req._notifCtx.recipientId, req._notifCtx.orgId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ── POST /notifications/dismiss ───────────────────────────────────────────────
router.post('/dismiss', requireAuth, express.json(), async (req, res) => {
  try {
    const rawNotifId = String(req.body.notifId || '').trim();
    if (!rawNotifId) {
      return res.status(400).json({ success: false, error: 'Invalid notifId' });
    }
    if (req._notifCtx.recipientType === 'student') {
      const { state, readIds, dismissedIds } = getStudentNotifState(req);
      dismissedIds.add(rawNotifId);
      persistStudentNotifState(req, readIds, dismissedIds, state.birthdayPopupShownAt);
      return res.json({ success: true });
    }

    if (rawNotifId.startsWith('birthday:')) {
      await ns.dismissNotification(db, {
        notifId: rawNotifId,
        dismisserId: req._notifCtx.recipientId,
        recipientType: req._notifCtx.recipientType,
        orgId: req._notifCtx.orgId,
      });
      invalidateNotifCountCache(req._notifCtx.recipientType, req._notifCtx.recipientId, req._notifCtx.orgId);
      return res.json({ success: true });
    }
    const notifId = Number.parseInt(rawNotifId, 10);
    if (!Number.isInteger(notifId) || notifId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid notifId' });
    }
    // Verify the notification belongs to this org
    const check = await db.query(
      `SELECT id FROM notifications WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [notifId, req._notifCtx.orgId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Not found' });
    }
    await ns.dismissNotification(db, { notifId, dismisserId: req._notifCtx.recipientId });
    invalidateNotifCountCache(req._notifCtx.recipientType, req._notifCtx.recipientId, req._notifCtx.orgId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ── POST /notifications/dismiss-all ──────────────────────────────────────────
router.post('/dismiss-all', requireAuth, async (req, res) => {
  try {
    if (req._notifCtx.recipientType === 'student') {
      const { state, readIds, dismissedIds } = getStudentNotifState(req);
      const items = await buildStudentNotifications(db, { ...req._notifCtx, studentId: req._notifCtx.recipientId });
      items.forEach((item) => dismissedIds.add(item.id));
      persistStudentNotifState(req, readIds, dismissedIds, state.birthdayPopupShownAt);
      return res.json({ success: true });
    }
    await ns.dismissAll(db, req._notifCtx);
    invalidateNotifCountCache(req._notifCtx.recipientType, req._notifCtx.recipientId, req._notifCtx.orgId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.get('/student-birthday-popup', requireAuth, async (req, res) => {
  try {
    if (req._notifCtx.recipientType !== 'student') {
      return res.json({ success: true, shouldShow: false });
    }

    const todayKey = startOfDay(new Date()).toISOString().slice(0, 10);
    const { state, readIds, dismissedIds } = getStudentNotifState(req);

    const studentResult = await db.query(
      `SELECT student_id, first_name, last_name, date_of_birth
       FROM students
       WHERE organization_id = $1 AND student_id = $2
       LIMIT 1`,
      [req._notifCtx.orgId, req._notifCtx.recipientId]
    );

    const student = studentResult.rows[0];
    if (!student || !student.date_of_birth) {
      return res.json({ success: true, shouldShow: false });
    }

    const dob = new Date(student.date_of_birth);
    const now = new Date();
    const isBirthdayToday = dob.getMonth() === now.getMonth() && dob.getDate() === now.getDate();
    const notifId = `student-birthday-${student.student_id}-${now.getFullYear()}`;

    if (!isBirthdayToday || state.birthdayPopupShownAt === todayKey || dismissedIds.has(notifId) || readIds.has(notifId)) {
      return res.json({ success: true, shouldShow: false });
    }

    const studentName = [student.first_name, student.last_name].filter(Boolean).join(' ').trim() || 'Student';
    state.birthdayPopupShownAt = todayKey;
    readIds.add(notifId);
    persistStudentNotifState(req, readIds, dismissedIds, state.birthdayPopupShownAt);

    return res.json({
      success: true,
      shouldShow: true,
      title: `Happy Birthday, ${studentName}!`,
      message: 'Wishing you a joyful day and a great term ahead.',
    });
  } catch (_err) {
    return res.json({ success: true, shouldShow: false });
  }
});

router.get('/new-term-popup', requireAuth, async (req, res) => {
  try {
    if (req._notifCtx.recipientType !== 'staff' || !isManagerOrSupervisorSession(req)) {
      return res.json({ success: true, shouldShow: false });
    }

    await ensureStaffPopupSchema();

    const currentTermResult = await db.query(
      `SELECT t.term_id, t.term_name, sy.year_label
       FROM terms t
       JOIN school_years sy ON sy.id = t.school_year_id
       WHERE t.organization_id = $1
         AND t.current = TRUE
       ORDER BY t.term_id DESC
       LIMIT 1`,
      [req._notifCtx.orgId]
    );

    const currentTerm = currentTermResult.rows[0];
    if (!currentTerm) {
      return res.json({ success: true, shouldShow: false });
    }

    const popupType = 'new_term_welcome';
    const alreadyShownResult = await db.query(
      `SELECT 1
       FROM staff_term_popup_views
       WHERE organization_id = $1
         AND user_id = $2
         AND term_id = $3
         AND popup_type = $4
       LIMIT 1`,
      [req._notifCtx.orgId, req._notifCtx.recipientId, Number(currentTerm.term_id), popupType]
    );

    if (alreadyShownResult.rows.length > 0) {
      return res.json({ success: true, shouldShow: false });
    }

    await db.query(
      `INSERT INTO staff_term_popup_views (organization_id, user_id, term_id, popup_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id, term_id, popup_type) DO NOTHING`,
      [req._notifCtx.orgId, req._notifCtx.recipientId, Number(currentTerm.term_id), popupType]
    );

    return res.json({
      success: true,
      shouldShow: true,
      title: `Welcome to ${currentTerm.term_name}`,
      message: `Welcome to ${currentTerm.term_name} in ${currentTerm.year_label}. May this new term bring fresh energy, smooth progress, meaningful achievements, and many beautiful moments for you and your school community. We wish you a joyful, successful, and rewarding term ahead.`,
    });
  } catch (_err) {
    return res.json({ success: true, shouldShow: false });
  }
});

module.exports = router;
