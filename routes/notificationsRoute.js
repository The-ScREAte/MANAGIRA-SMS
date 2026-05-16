'use strict';
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const ns = require('../utils/notificationService');

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
  const userId = session.userId || (session.user && session.user.user_id) || null;
  if (!userId || !orgId) return null;
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
    const notifId = Number.parseInt(req.body.notifId, 10);
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
    const notifId = Number.parseInt(req.body.notifId, 10);
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
