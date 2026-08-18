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

// GET /internal/api/students/search?organizationId=63&q=john
// Reuses the same students/classes join pattern used throughout
// commonController.js (e.g. student profile lookups) rather than
// introducing new query logic. organizationId is required on every call -
// Mira derives it from the caller's *validated* session identity, never
// from client input, but this endpoint scopes by it regardless as a second
// layer of tenant enforcement.
async function searchStudents(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    const q = String(req.query.q || "").trim();
    if (!Number.isInteger(organizationId)) {
      return res.status(400).json({ error: "organizationId is required." });
    }
    if (!q) {
      return res.json({ students: [] });
    }

    const result = await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.grade, s.gender,
              s.custom_student_id, c.class_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
       WHERE s.organization_id = $1
         AND (s.first_name || ' ' || s.last_name) ILIKE $2
       ORDER BY s.last_name, s.first_name
       LIMIT 10`,
      [organizationId, `%${q}%`]
    );

    return res.json({ students: result.rows });
  } catch (error) {
    console.error("[internalApi/searchStudents]", error);
    return res.status(500).json({ error: "Unable to search students." });
  }
}

// GET /internal/api/guardians/search?organizationId=63&q=jane
async function searchGuardians(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    const q = String(req.query.q || "").trim();
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });
    if (!q) return res.json({ guardians: [] });

    const result = await db.query(
      `SELECT gp.guardian_id, gp.first_name, gp.last_name, gp.phone, gp.email,
              array_agg(DISTINCT (s.first_name || ' ' || s.last_name)) FILTER (WHERE s.student_id IS NOT NULL) AS student_names
       FROM guardian_profiles gp
       LEFT JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
       LEFT JOIN students s ON s.student_id = gs.student_id AND s.organization_id = gp.organization_id
       WHERE gp.organization_id = $1
         AND (gp.first_name || ' ' || gp.last_name) ILIKE $2
       GROUP BY gp.guardian_id
       ORDER BY gp.last_name, gp.first_name
       LIMIT 10`,
      [organizationId, `%${q}%`]
    );
    return res.json({ guardians: result.rows });
  } catch (error) {
    console.error("[internalApi/searchGuardians]", error);
    return res.status(500).json({ error: "Unable to search guardians." });
  }
}

// GET /internal/api/students/:studentId/fees?organizationId=63
// Reasonable-effort summary (payments recorded vs. active fee templates) -
// not a full Paygira billing-status mirror, which is a much larger system.
async function getStudentFees(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    const studentId = parseInt(req.params.studentId, 10);
    if (!Number.isInteger(organizationId) || !Number.isInteger(studentId)) {
      return res.status(400).json({ error: "organizationId and studentId are required." });
    }

    const student = await db.query(
      `SELECT student_id, first_name, last_name FROM students WHERE student_id = $1 AND organization_id = $2`,
      [studentId, organizationId]
    );
    if (!student.rows[0]) return res.status(404).json({ error: "Student not found." });

    const payments = await db.query(
      `SELECT payment_id, amount, method, occurrence_date, received_at, is_refund
       FROM finance_payments
       WHERE student_id = $1 AND organization_id = $2
       ORDER BY received_at DESC
       LIMIT 20`,
      [studentId, organizationId]
    );
    const totals = await db.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE is_refund IS NOT TRUE), 0) AS total_paid,
              COALESCE(SUM(amount) FILTER (WHERE is_refund IS TRUE), 0) AS total_refunded
       FROM finance_payments WHERE student_id = $1 AND organization_id = $2`,
      [studentId, organizationId]
    );

    return res.json({ student: student.rows[0], payments: payments.rows, totals: totals.rows[0] });
  } catch (error) {
    console.error("[internalApi/getStudentFees]", error);
    return res.status(500).json({ error: "Unable to load fee information." });
  }
}

// GET /internal/api/students/:studentId/attendance?organizationId=63&days=30
async function getStudentAttendance(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    const studentId = parseInt(req.params.studentId, 10);
    const days = Math.min(parseInt(req.query.days, 10) || 30, 180);
    if (!Number.isInteger(organizationId) || !Number.isInteger(studentId)) {
      return res.status(400).json({ error: "organizationId and studentId are required." });
    }

    const student = await db.query(
      `SELECT student_id, first_name, last_name FROM students WHERE student_id = $1 AND organization_id = $2`,
      [studentId, organizationId]
    );
    if (!student.rows[0]) return res.status(404).json({ error: "Student not found." });

    const records = await db.query(
      `SELECT date, status FROM attendance_records
       WHERE student_id = $1 AND organization_id = $2 AND date >= (CURRENT_DATE - $3::int)
       ORDER BY date DESC`,
      [studentId, organizationId, days]
    );
    const summary = await db.query(
      `SELECT status, COUNT(*)::int AS count FROM attendance_records
       WHERE student_id = $1 AND organization_id = $2 AND date >= (CURRENT_DATE - $3::int)
       GROUP BY status`,
      [studentId, organizationId, days]
    );

    return res.json({ student: student.rows[0], records: records.rows, summary: summary.rows });
  } catch (error) {
    console.error("[internalApi/getStudentAttendance]", error);
    return res.status(500).json({ error: "Unable to load attendance information." });
  }
}

// GET /internal/api/classes?organizationId=63&q=grade+3
async function listClasses(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    const q = String(req.query.q || "").trim();
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const result = await db.query(
      `SELECT c.class_id, c.class_name, COUNT(s.student_id)::int AS student_count
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.class_id AND s.organization_id = c.organization_id
       WHERE c.organization_id = $1
         AND ($2 = '' OR c.class_name ILIKE '%' || $2 || '%')
       GROUP BY c.class_id
       ORDER BY c.dashboard_sort_order NULLS LAST, c.class_name
       LIMIT 20`,
      [organizationId, q]
    );
    return res.json({ classes: result.rows });
  } catch (error) {
    console.error("[internalApi/listClasses]", error);
    return res.status(500).json({ error: "Unable to load classes." });
  }
}

// GET /internal/api/terms?organizationId=63
async function listTerms(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const result = await db.query(
      `SELECT term_id, term_name, start_date, end_date, current, current_term
       FROM terms WHERE organization_id = $1
       ORDER BY start_date DESC LIMIT 20`,
      [organizationId]
    );
    return res.json({ terms: result.rows });
  } catch (error) {
    console.error("[internalApi/listTerms]", error);
    return res.status(500).json({ error: "Unable to load terms." });
  }
}

// GET /internal/api/organizations/:organizationId  - basic org info, used
// by the list_projects tool (Mira's "project" concept = the caller's own
// school; a session is always scoped to exactly one org).
async function getOrganization(req, res) {
  try {
    const organizationId = parseInt(req.params.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const result = await db.query(
      `SELECT organization_id, organization_name, logo FROM organizations WHERE organization_id = $1 AND deleted IS NOT TRUE`,
      [organizationId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Organization not found." });
    return res.json({ organization: result.rows[0] });
  } catch (error) {
    console.error("[internalApi/getOrganization]", error);
    return res.status(500).json({ error: "Unable to load organization." });
  }
}

// GET /internal/api/students/:studentId/guardians?organizationId=63
async function getStudentGuardians(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    const studentId = parseInt(req.params.studentId, 10);
    if (!Number.isInteger(organizationId) || !Number.isInteger(studentId)) {
      return res.status(400).json({ error: "organizationId and studentId are required." });
    }

    const result = await db.query(
      `SELECT gp.guardian_id, gp.first_name, gp.last_name, gp.phone, gp.email, gs.relationship
       FROM guardian_students gs
       JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
       JOIN students s ON s.student_id = gs.student_id
       WHERE gs.student_id = $1 AND s.organization_id = $2 AND gp.organization_id = $2`,
      [studentId, organizationId]
    );
    return res.json({ guardians: result.rows });
  } catch (error) {
    console.error("[internalApi/getStudentGuardians]", error);
    return res.status(500).json({ error: "Unable to load guardians." });
  }
}

// POST /internal/api/announcements
// { organizationId, title, body }
// Uses the admin_announcements table (org-targeted via organization_id,
// same table the /admin/announcements page reads from today) - the newer
// broadcast_announcements engine lives on a different, not-yet-merged
// branch, so this deliberately doesn't take a dependency on it.
async function createAnnouncement(req, res) {
  try {
    const organizationId = parseInt(req.body?.organizationId, 10);
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();

    if (!Number.isInteger(organizationId) || !title || !body) {
      return res.status(400).json({ error: "organizationId, title, and body are required." });
    }

    const inserted = await db.query(
      `INSERT INTO admin_announcements (title, description, is_active, organization_id)
       VALUES ($1, $2, TRUE, $3)
       RETURNING *`,
      [title.slice(0, 255), body, organizationId]
    );

    return res.status(201).json({ announcement: inserted.rows[0] });
  } catch (error) {
    console.error("[internalApi/createAnnouncement]", error);
    return res.status(500).json({ error: "Unable to create announcement." });
  }
}

// GET /internal/api/documentation - the platform's own published help-
// center articles (documentation_articles), used to build Mira's RAG
// index (see mira/scripts/ingestDocs.js). Public, non-tenant content -
// no organizationId scoping needed, unlike every other endpoint here.
// Drafts are excluded so Mira never cites unpublished content.
async function listDocumentationArticles(req, res) {
  try {
    const result = await db.query(
      `SELECT id, title, slug, topic, subtopic, tags, content_html
       FROM documentation_articles
       WHERE status = 'active'
       ORDER BY topic, subtopic, title`
    );
    return res.json({ articles: result.rows });
  } catch (error) {
    console.error("[internalApi/listDocumentationArticles]", error);
    return res.status(500).json({ error: "Unable to load documentation." });
  }
}

module.exports = {
  validateSession,
  searchStudents,
  searchGuardians,
  getStudentFees,
  getStudentAttendance,
  listClasses,
  listTerms,
  getOrganization,
  getStudentGuardians,
  createAnnouncement,
  listDocumentationArticles,
};
