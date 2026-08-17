// Thin, read-mostly internal API for the separate Mira AI service
// (mira/). Every handler here is called service-to-service (gated by
// middleware/internalServiceAuth.js), never directly by a browser. Handlers
// deliberately reuse existing query patterns from the main controllers
// rather than introduce new business logic - this file is a thin
// translation layer, not a second copy of the app.
const db = require("../config/db");
const cookieSignature = require("cookie-signature");
const connectPgSimple = require("connect-pg-simple");
const session = require("express-session");

const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // matches server.js's idle-logout window

// Reuses the exact same Postgres-backed session store as the main app
// (same `user_sessions` table, same db pool) so decoding here is
// guaranteed consistent with how server.js itself reads sessions - no
// reimplementation of session semantics.
const pgSession = connectPgSimple(session);
let sessionStore = null;
function getSessionStore() {
  if (!sessionStore) {
    sessionStore = new pgSession({ pool: db, tableName: "user_sessions" });
  }
  return sessionStore;
}

function getSessionRecord(sid) {
  return new Promise((resolve, reject) => {
    getSessionStore().get(sid, (err, sessionData) => {
      if (err) return reject(err);
      resolve(sessionData || null);
    });
  });
}

// Extracts the session id from a raw, URL-decoded "connect.sid" cookie
// value (format "s:<sid>.<signature>") and verifies its HMAC signature
// against SESSION_SECRET, exactly as express-session's cookie parser does.
function unsignSessionCookie(rawCookieValue) {
  const secret = process.env.SESSION_SECRET || "YourSecret";
  if (!rawCookieValue || !rawCookieValue.startsWith("s:")) return null;
  const signed = rawCookieValue.slice(2);
  const sid = cookieSignature.unsign(signed, secret);
  return sid || null; // false on bad signature -> null
}

function toIdentity(sessionData) {
  if (!sessionData) return null;
  return {
    userId: sessionData.userId || sessionData.user?.user_id || null,
    organizationId: sessionData.organizationId || null,
    accountType: sessionData.accountType || null,
    userRole: sessionData.userRole || null,
    guardianId: sessionData.guardianId || null,
    studentId: sessionData.studentId || null,
    firstName: sessionData.firstName || sessionData.user?.first_name || null,
    lastName: sessionData.lastName || sessionData.user?.last_name || null,
    organizationName: sessionData.organizationName || null,
  };
}

// POST /internal/api/session/validate  { cookieValue: "s:<sid>.<sig>" }
// Returns { identity } on success, 401 on an invalid/expired/missing session.
// This is the ONLY way Mira resolves who's asking - it never reads
// user_sessions directly itself.
async function validateSession(req, res) {
  try {
    const rawCookieValue = req.body?.cookieValue;
    const sid = unsignSessionCookie(rawCookieValue);
    if (!sid) return res.status(401).json({ error: "Invalid session cookie." });

    const sessionData = await getSessionRecord(sid);
    if (!sessionData) return res.status(401).json({ error: "Session not found or expired." });

    if (sessionData.organizationId) {
      const lastActivity = sessionData.lastActivity || Date.now();
      if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
        return res.status(401).json({ error: "Session expired due to inactivity." });
      }
    }

    const identity = toIdentity(sessionData);
    if (!identity.userId && !identity.guardianId && !identity.studentId) {
      return res.status(401).json({ error: "Session has no resolvable identity." });
    }

    return res.json({ identity });
  } catch (error) {
    console.error("[internalApi/validateSession]", error);
    return res.status(500).json({ error: "Unable to validate session." });
  }
}

module.exports = {
  validateSession,
};
