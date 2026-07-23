'use strict';
/**
 * fetchNotifCount.js
 *
 * Sets res.locals.notifUnreadCount for every authenticated non-admin page.
 * The header.ejs bell badge reads this value.
 * If schema not ready or DB error → silently sets 0 (never blocks the page).
 *
 * A short-lived in-memory cache (CACHE_TTL_MS) is used per-user so the DB
 * query only runs once per TTL window instead of on every page request.
 * The client-side JS also calls /notifications/count on DOMContentLoaded,
 * so a stale cached 0 is corrected within ~100 ms without blocking page load.
 */
const ns = require('../utils/notificationService');
const db = require('../config/db');

let dbRetryAfter = 0;
let lastErrLogAt  = 0;

// Per-user count cache: key → { count, expiresAt }
const countCache  = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

function cacheKey(recipientType, recipientId, orgId) {
  return `${recipientType}:${recipientId}:${orgId}`;
}

function getCached(recipientType, recipientId, orgId) {
  const key = cacheKey(recipientType, recipientId, orgId);
  const entry = countCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { countCache.delete(key); return null; }
  return entry.count;
}

function setCached(recipientType, recipientId, orgId, count) {
  const key = cacheKey(recipientType, recipientId, orgId);
  countCache.set(key, { count, expiresAt: Date.now() + CACHE_TTL_MS });
  // Prevent unbounded growth — evict expired entries when map is large
  if (countCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of countCache) {
      if (now > v.expiresAt) countCache.delete(k);
    }
  }
}

function getCachedNotifCount(context) {
  if (!context) return null;
  const { recipientType, recipientId, orgId } = context;
  if (!recipientType || recipientId === undefined || recipientId === null || !orgId) return null;
  return getCached(String(recipientType), Number(recipientId), Number(orgId));
}

function setCachedNotifCount(context, count) {
  if (!context) return;
  const { recipientType, recipientId, orgId } = context;
  if (!recipientType || recipientId === undefined || recipientId === null || !orgId) return;
  setCached(String(recipientType), Number(recipientId), Number(orgId), Number(count) || 0);
}

async function getNotifCountCachedOrFetch(dbClient, context) {
  const cached = getCachedNotifCount(context);
  if (cached !== null) return cached;
  const count = await ns.getUnreadCount(dbClient, context);
  setCachedNotifCount(context, count);
  return count;
}

// Exported so other code (e.g. after marking notifications read) can bust the cache
function invalidateNotifCountCache(recipientType, recipientId, orgId) {
  countCache.delete(cacheKey(recipientType, recipientId, orgId));
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

const fetchNotifCount = async (req, res, next) => {
  // Default — never undefined in templates
  res.locals.notifUnreadCount = 0;

  const now = Date.now();
  if (now < dbRetryAfter) return next();

  const session = req.session || {};
  const orgId   = session.organizationId;
  if (!orgId) return next();

  try {
    // Student portal notifications are handled by /notifications/* student context.
    // Keep server-rendered badge neutral to avoid leaking staff counts.
    if (session.userRole === 'Student' || session.accountType === 'Student') {
      res.locals.notifUnreadCount = 0;
      return next();
    }

    // Guardian portal
    if (session.userRole === 'Guardian' || session.accountType === 'Guardian') {
      const guardianId = session.guardianId || session.userId || null;
      if (guardianId) {
        const gId  = Number(guardianId);
        const gOrg = Number(orgId);
        const count = await getNotifCountCachedOrFetch(db, {
          recipientType: 'guardian',
          recipientId:   gId,
          orgId:         gOrg,
        });
        res.locals.notifUnreadCount = count;
      }
      return next();
    }

    // Staff / org owner
    const userId = resolveStaffReaderId(session);
    if (userId !== null) {
      const uId  = Number(userId);
      const uOrg = Number(orgId);
      const count = await getNotifCountCachedOrFetch(db, {
        recipientType: 'staff',
        recipientId:   uId,
        orgId:         uOrg,
      });
      res.locals.notifUnreadCount = count;
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

module.exports = {
  fetchNotifCount,
  invalidateNotifCountCache,
  getCachedNotifCount,
  setCachedNotifCount,
  getNotifCountCachedOrFetch,
};
