'use strict';
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const ns = require('../utils/notificationService');

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
    return { recipientType: 'student', recipientId: Number(studentId), orgId: Number(orgId) };
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
  return { recipientType: 'staff', recipientId: Number(userId), orgId: Number(orgId) };
}

function requireAuth(req, res, next) {
  const ctx = resolveReaderContext(req);
  if (!ctx) return res.status(401).json({ success: false, error: 'Unauthenticated' });
  req._notifCtx = ctx;
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

async function buildStudentNotifications(db, { orgId, studentId }) {
  const now = new Date();
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

  if (term) {
    const start = new Date(term.start_date);
    const end = new Date(term.end_date);
    const startIn = diffDays(now, start);
    const endIn = diffDays(now, end);

    if (startIn > 0) {
      items.push({
        id: `student-term-start-${term.term_id}`,
        type: 'term_changed',
        title: `${term.term_name} starts soon`,
        body: `${startIn} day${startIn === 1 ? '' : 's'} to go (${formatDateLabel(term.start_date)}).`,
        link: '/student/dashboard',
        created_at: term.start_date,
      });
    } else if (endIn >= 0) {
      items.push({
        id: `student-term-end-${term.term_id}`,
        type: 'term_changed',
        title: `${term.term_name} is ongoing`,
        body: `Ends in ${endIn} day${endIn === 1 ? '' : 's'} (${formatDateLabel(term.end_date)}).`,
        link: '/student/dashboard',
        created_at: term.end_date,
      });
    } else {
      items.push({
        id: `student-term-ended-${term.term_id}`,
        type: 'term_changed',
        title: `${term.term_name} has ended`,
        body: `Ended ${Math.abs(endIn)} day${Math.abs(endIn) === 1 ? '' : 's'} ago.`,
        link: '/student/dashboard',
        created_at: term.end_date,
      });
    }
  }

  if (student.date_of_birth) {
    const dob = new Date(student.date_of_birth);
    const isBirthdayToday = dob.getMonth() === now.getMonth() && dob.getDate() === now.getDate();
    if (isBirthdayToday) {
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

  if (term) {
    const classResult = await db.query(
      `SELECT es.class_id
       FROM enrollments e
       JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id
       WHERE e.organization_id = $1
         AND e.term_id = $2
         AND es.student_id = $3
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [orgId, term.term_id, studentId]
    );

    const effectiveClassId = classResult.rows[0]?.class_id || student.class_id;
    if (effectiveClassId) {
      const assessmentResult = await db.query(
        `SELECT a.assessment_id, a.title, a.created_at, a.edit_window_start, a.edit_window_end, s.subject_name
         FROM assessments a
         JOIN subjects s ON s.subject_id = a.subject_id AND s.organization_id = a.organization_id
         WHERE a.organization_id = $1
           AND a.class_id = $2
           AND a.term_id = $3
           AND COALESCE(a.is_active, TRUE) = TRUE
           AND EXISTS (
             SELECT 1
             FROM student_subjects ss
             WHERE ss.organization_id = $1
               AND ss.student_id = $4
               AND ss.subject_id = a.subject_id
           )
         ORDER BY COALESCE(a.edit_window_start, a.created_at) DESC, a.assessment_id DESC
         LIMIT 40`,
        [orgId, effectiveClassId, term.term_id, studentId]
      );

      assessmentResult.rows.forEach((row) => {
        const opensAt = row.edit_window_start ? new Date(row.edit_window_start) : null;
        const closesAt = row.edit_window_end ? new Date(row.edit_window_end) : null;
        const subjectName = row.subject_name || 'Subject';

        if (opensAt && opensAt > now) {
          const days = Math.max(1, diffDays(now, opensAt));
          items.push({
            id: `student-assessment-open-${row.assessment_id}`,
            type: 'assessment_created',
            title: `${row.title} opens soon`,
            body: `${subjectName} • Opens in ${days} day${days === 1 ? '' : 's'} (${formatDateLabel(opensAt)}).`,
            link: '/student/testing-room',
            created_at: opensAt.toISOString(),
          });
          return;
        }

        if (!closesAt || closesAt >= now) {
          const closePart = closesAt
            ? ` • Closes in ${Math.max(0, diffDays(now, closesAt))} day${Math.max(0, diffDays(now, closesAt)) === 1 ? '' : 's'} (${formatDateLabel(closesAt)}).`
            : '';
          items.push({
            id: `student-assessment-live-${row.assessment_id}`,
            type: 'assessment_unlocked',
            title: `${row.title} is ready`,
            body: `${subjectName}${closePart}`,
            link: '/student/testing-room',
            created_at: (opensAt || row.created_at || now).toISOString ? (opensAt || row.created_at || now).toISOString() : now.toISOString(),
          });
          return;
        }

        items.push({
          id: `student-assessment-closed-${row.assessment_id}`,
          type: 'assessment_locked',
          title: `${row.title} is closed`,
          body: `${subjectName} • Closed on ${formatDateLabel(closesAt)}.`,
          link: '/student/testing-room',
          created_at: closesAt.toISOString(),
        });
      });
    }
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
      const items = await buildStudentNotifications(db, req._notifCtx);
      const count = items.filter((item) => !readIds.has(item.id) && !dismissedIds.has(item.id)).length;
      return res.json({ success: true, count });
    }
    const count = await ns.getUnreadCount(db, req._notifCtx);
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
      const items = await buildStudentNotifications(db, req._notifCtx);
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
      const items = await buildStudentNotifications(db, req._notifCtx);
      items.forEach((item) => {
        if (!dismissedIds.has(item.id)) readIds.add(item.id);
      });
      persistStudentNotifState(req, readIds, dismissedIds, state.birthdayPopupShownAt);
      return res.json({ success: true });
    }
    await ns.markAllRead(db, req._notifCtx);
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
      const items = await buildStudentNotifications(db, req._notifCtx);
      items.forEach((item) => dismissedIds.add(item.id));
      persistStudentNotifState(req, readIds, dismissedIds, state.birthdayPopupShownAt);
      return res.json({ success: true });
    }
    await ns.dismissAll(db, req._notifCtx);
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

module.exports = router;
