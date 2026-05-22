'use strict';
/**
 * fetchNotifCount.js
 *
 * Sets res.locals.notifUnreadCount for every authenticated non-admin page.
 * The header.ejs bell badge reads this value.
 * If schema not ready or DB error → silently sets 0 (never blocks the page).
 */
const ns = require('../utils/notificationService');
const db = require('../config/db');

let dbRetryAfter = 0;
let lastErrLogAt  = 0;

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

const fetchNotifCount = async (req, res, next) => {
  // Default — never undefined in templates
  res.locals.notifUnreadCount = 0;

  const now = Date.now();
  if (now < dbRetryAfter) return next();

  const session = req.session || {};
  const orgId   = session.organizationId;
  if (!orgId) return next();

  try {
    // Guardian portal
    if (session.userRole === 'Guardian' || session.accountType === 'Guardian') {
      const guardianId = session.guardianId || session.userId || null;
      if (guardianId) {
        res.locals.notifUnreadCount = await ns.getUnreadCount(db, {
          recipientType: 'guardian',
          recipientId:   Number(guardianId),
          orgId:         Number(orgId),
        });
      }
      return next();
    }

    // Staff / org owner
    const userId = resolveStaffReaderId(session);
    if (userId !== null) {
      res.locals.notifUnreadCount = await ns.getUnreadCount(db, {
        recipientType: 'staff',
        recipientId:   Number(userId),
        orgId:         Number(orgId),
      });
    }
  } catch (err) {
    const throttle = 5 * 60 * 1000;
    if (now - lastErrLogAt > throttle) {
      console.error('[fetchNotifCount] DB error:', err.message);
      lastErrLogAt = now;
    }
    dbRetryAfter = now + 60 * 1000;
    res.locals.notifUnreadCount = 0;
  }

  next();
};

module.exports = fetchNotifCount;
