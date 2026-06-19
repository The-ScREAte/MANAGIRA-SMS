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

// ── GET /notifications/count ──────────────────────────────────────────────────
router.get('/count', requireAuth, async (req, res) => {
  try {
    const count = await ns.getUnreadCount(db, req._notifCtx);
    res.json({ success: true, count });
  } catch (err) {
    res.json({ success: true, count: 0 });
  }
});

// ── GET /notifications/feed ───────────────────────────────────────────────────
router.get('/feed', requireAuth, async (req, res) => {
  try {
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
    await ns.dismissAll(db, req._notifCtx);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
