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
const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { commonController } = require("./commonController");
const { logOrganizationActivity } = require("../utils/activityLog");

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

    // Joined to school_years so callers (Mira's get_term tool) always know
    // which year a term belongs to - previously this returned a flat list
    // of terms with no year linkage at all, which meant the model had no
    // grounding for "which term belongs to which school year" and would
    // guess (wrongly) when asked to summarize terms across years.
    const result = await db.query(
      `SELECT t.term_id, t.term_name, t.start_date, t.end_date, t.current, t.current_term,
              sy.id AS school_year_id, sy.year_label, sy.current AS year_is_current
       FROM terms t
       JOIN school_years sy ON sy.id = t.school_year_id
       WHERE t.organization_id = $1
       ORDER BY sy.year_label DESC, t.start_date DESC
       LIMIT 40`,
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
    // Previously this endpoint had NO permission check at all - the entire
    // authorization decision lived only in the Mira tool's own roleTags
    // guess (mira/tools/createAnnouncement.js), with no backend truth
    // check as a backstop. Brought in line with the school-year write
    // endpoints: the real per-user PUBLISH_EVENTS_ANNOUNCEMENTS grant is
    // now what actually decides this, not a role-name guess.
    const organizationId = await assertHasPermission(
      req,
      PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS,
      "You don't have permission to publish events & announcements."
    );

    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!title || !body) {
      return res.status(400).json({ error: "title and body are required." });
    }

    const inserted = await db.query(
      `INSERT INTO admin_announcements (title, description, is_active, organization_id)
       VALUES ($1, $2, TRUE, $3)
       RETURNING *`,
      [title.slice(0, 255), body, organizationId]
    );

    return res.status(201).json({ announcement: inserted.rows[0] });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
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

// Every Mira write action against School Years funnels through this same
// permission check the browser UI uses (routes/commonRoute.js's
// requirePermission(MANAGE_SCHOOL_YEAR_TERMS)) - a role tag alone
// (mira/middleware/tenantScope.js) is not enough to authorize a
// destructive/record-changing action, so we re-derive the real per-user
// permission grant here from the caller-supplied identity fields, which
// Mira only ever sources from the validated session (see
// mira/middleware/ssoAuth.js), never from chat/model input.
// Shared by every Mira write endpoint: re-derives the caller's actual
// granted permission from the database (never trusting the Mira-side
// tenant.roleTags heuristic, which is only a cheap first-pass UX hint -
// see mira/middleware/tenantScope.js) before allowing a write. Every write
// route below must call this rather than skip straight to a query, so
// there is exactly one place this check can be forgotten instead of one
// per endpoint.
async function assertHasPermission(req, permissionKey, deniedMessage) {
  const { organizationId, userId, userRole, accountType, userEmail } = req.body || {};
  const orgId = parseInt(organizationId, 10);
  if (!Number.isInteger(orgId)) {
    const error = new Error("organizationId is required.");
    error.status = 400;
    throw error;
  }
  const allowed = await userHasPermission(db, { userId, userRole, organizationId: orgId, accountType, userEmail }, permissionKey);
  if (!allowed) {
    const error = new Error(deniedMessage);
    error.status = 403;
    throw error;
  }
  return orgId;
}

// Real school_year_label data is inconsistently spaced ("2026 - 2027" next
// to "2022-2023" in the same org, from years of manual entry) - matching
// year_label with plain SQL "=" made Mira report a real year as "not
// found" whenever the model's guess didn't happen to have the exact same
// spacing as what was actually stored, even though it had the right year.
// Every lookup/dedup-check by label below compares with whitespace
// stripped from both sides instead of relying on exact string equality.
const NORMALIZED_YEAR_LABEL_SQL = "REPLACE(year_label, ' ', '')";
function normalizeYearLabel(label) {
  return String(label || "").replace(/\s+/g, "");
}

async function assertCanManageSchoolYears(req) {
  return assertHasPermission(req, PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS, "You don't have permission to manage school years and terms.");
}

async function assertCanManageClassesSubjects(req) {
  return assertHasPermission(req, PERMISSIONS.MANAGE_CLASSES_SUBJECTS, "You don't have permission to manage classes, subjects, or graduation year groups.");
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

// GET /internal/api/school-years?organizationId=63
// Lets Mira resolve a school year the user names in chat (e.g. "2024-2025")
// to its id, and see whether it's the current year / has terms, before
// proposing an update or delete.
async function listSchoolYears(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) {
      return res.status(400).json({ error: "organizationId is required." });
    }

    const result = await db.query(
      `SELECT sy.id, sy.year_label, sy.current,
              COUNT(t.term_id)::int AS term_count
       FROM school_years sy
       LEFT JOIN terms t ON t.school_year_id = sy.id AND t.organization_id = sy.organization_id
       WHERE sy.organization_id = $1
       GROUP BY sy.id, sy.year_label, sy.current
       ORDER BY sy.year_label DESC`,
      [organizationId]
    );
    return res.json({ schoolYears: result.rows });
  } catch (error) {
    console.error("[internalApi/listSchoolYears]", error);
    return res.status(500).json({ error: "Unable to load school years." });
  }
}

// POST /internal/api/school-years/create
// { organizationId, userId, userRole, accountType, userEmail, yearLabel, terms: [{termName, startDate, endDate}] }
// Mirrors the same rules as the "+ Create School Year" modal / its handler
// (controllers/commonController.js registerSchoolYear, ~line 16446):
// YYYY-YYYY consecutive label, unique per org, at least one term, each
// term's start before its end, no overlapping terms, and each term
// starting at least a day after the previous one ends. That handler talks
// in flash-message + redirect/render, which doesn't translate to a JSON
// API, so this is a from-scratch implementation of the same validation
// rather than a call-through - kept in a transaction (the original isn't)
// so a failure partway through term inserts can't leave an orphaned
// school year behind.
async function createSchoolYear(req, res) {
  const client = await db.connect();
  try {
    const organizationId = await assertCanManageSchoolYears(req);

    const yearLabel = String(req.body?.yearLabel || "").trim();
    const match = yearLabel.match(/^(\d{4})\s*-\s*(\d{4})$/);
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      return res.status(400).json({ error: "yearLabel must be in the format YYYY-YYYY with consecutive years, e.g. 2026-2027." });
    }

    const termsArr = Array.isArray(req.body?.terms) ? req.body.terms : [];
    if (!termsArr.length) {
      return res.status(400).json({ error: "At least one term (name, start date, end date) is required to create a school year." });
    }
    for (const term of termsArr) {
      const termName = String(term?.termName || "").trim();
      if (!termName || !term?.startDate || !term?.endDate) {
        return res.status(400).json({ error: "Every term needs a name, start date, and end date." });
      }
    }

    for (let i = 0; i < termsArr.length; i++) {
      const s = new Date(termsArr[i].startDate);
      const e = new Date(termsArr[i].endDate);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
        return res.status(400).json({ error: `Invalid date for term "${termsArr[i].termName}".` });
      }
      if (s > e) {
        return res.status(400).json({ error: `Start date must be before end date for term: ${termsArr[i].termName}` });
      }
      for (let j = i + 1; j < termsArr.length; j++) {
        const s2 = new Date(termsArr[j].startDate);
        const e2 = new Date(termsArr[j].endDate);
        if (s <= e2 && e >= s2) {
          return res.status(400).json({ error: `Date ranges for "${termsArr[i].termName}" and "${termsArr[j].termName}" overlap.` });
        }
      }
    }

    const orderedTerms = [...termsArr]
      .map((t) => ({ ...t, _start: String(t.startDate || ""), _end: String(t.endDate || "") }))
      .sort((a, b) => a._start.localeCompare(b._start));
    for (let i = 1; i < orderedTerms.length; i++) {
      const previousEnd = new Date(orderedTerms[i - 1]._end);
      previousEnd.setDate(previousEnd.getDate() + 1);
      const currentStart = new Date(orderedTerms[i]._start);
      if (currentStart < previousEnd) {
        return res.status(400).json({
          error: `Term dates must not overlap: "${orderedTerms[i].termName}" should start on or after ${previousEnd.toISOString().slice(0, 10)}.`,
        });
      }
    }

    await client.query("BEGIN");

    const dup = await client.query(
      `SELECT 1 FROM school_years WHERE ${NORMALIZED_YEAR_LABEL_SQL} = $1 AND organization_id = $2`,
      [normalizeYearLabel(yearLabel), organizationId]
    );
    if (dup.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `A school year named "${yearLabel}" already exists.` });
    }

    const yearResult = await client.query(
      "INSERT INTO school_years (year_label, organization_id) VALUES ($1, $2) RETURNING id",
      [yearLabel, organizationId]
    );
    const schoolYearId = yearResult.rows[0].id;

    const createdTerms = [];
    for (const term of termsArr) {
      const termResult = await client.query(
        "INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING term_id, term_name, start_date, end_date",
        [String(term.termName).trim(), term.startDate, term.endDate, schoolYearId, organizationId]
      );
      createdTerms.push(termResult.rows[0]);
    }

    await client.query("COMMIT");
    return res.status(201).json({ id: schoolYearId, yearLabel, terms: createdTerms });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createSchoolYear]", error);
    return res.status(500).json({ error: "Unable to create school year." });
  } finally {
    client.release();
  }
}

// POST /internal/api/school-years/rename
// { organizationId, userId, userRole, accountType, userEmail, yearLabel, newYearLabel }
// Renames a school year by its current label. Deliberately narrower than
// the browser's full "Update School Year" form (routes/commonRoute.js
// updateSchoolYearAndTerms), which also edits term dates and can change
// which term is "current" - carrying enrollment-carryover side effects
// (see the enrollPreviousTerm modal flow in manageRecords.ejs) too
// consequential to trigger from a chat instruction. Mira can rename the
// label only; term-level or current-year changes stay a manual UI action.
async function renameSchoolYear(req, res) {
  try {
    const organizationId = await assertCanManageSchoolYears(req);

    const currentLabel = String(req.body?.yearLabel || "").trim();
    const newLabel = String(req.body?.newYearLabel || "").trim();
    if (!currentLabel || !newLabel) {
      return res.status(400).json({ error: "yearLabel and newYearLabel are required." });
    }

    const match = newLabel.match(/^(\d{4})\s*-\s*(\d{4})$/);
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      return res.status(400).json({ error: "newYearLabel must be in the format YYYY-YYYY with consecutive years, e.g. 2026-2027." });
    }

    const existing = await db.query(
      `SELECT id, year_label FROM school_years WHERE organization_id = $1 AND ${NORMALIZED_YEAR_LABEL_SQL} = $2`,
      [organizationId, normalizeYearLabel(currentLabel)]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: `No school year named "${currentLabel}" was found.` });
    }
    if (existing.rows.length > 1) {
      return res.status(409).json({ error: `More than one school year is named "${currentLabel}"; rename it manually from Manage Records.` });
    }

    const duplicate = await db.query(
      `SELECT id FROM school_years WHERE organization_id = $1 AND ${NORMALIZED_YEAR_LABEL_SQL} = $2 AND id != $3`,
      [organizationId, normalizeYearLabel(newLabel), existing.rows[0].id]
    );
    if (duplicate.rows.length) {
      return res.status(409).json({ error: `A school year named "${newLabel}" already exists.` });
    }

    await db.query(`UPDATE school_years SET year_label = $1 WHERE id = $2 AND organization_id = $3`, [
      newLabel,
      existing.rows[0].id,
      organizationId,
    ]);

    return res.json({ id: existing.rows[0].id, oldLabel: currentLabel, newLabel });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/renameSchoolYear]", error);
    return res.status(500).json({ error: "Unable to rename school year." });
  }
}

// POST /internal/api/school-years/delete
// { organizationId, userId, userRole, accountType, userEmail, yearLabel }
// Resolves the label to an id, then delegates to the exact same
// commonController.deleteSchoolYear used by the Manage Records page -
// including its transaction and collectSchoolYearDeletionBlockers() guard
// (controllers/commonController.js) - by calling it with a minimal
// req/res, rather than re-implementing the deletion/dependency logic.
async function deleteSchoolYear(req, res) {
  try {
    const organizationId = await assertCanManageSchoolYears(req);

    const yearLabel = String(req.body?.yearLabel || "").trim();
    if (!yearLabel) {
      return res.status(400).json({ error: "yearLabel is required." });
    }

    const existing = await db.query(
      `SELECT id, year_label, current FROM school_years WHERE organization_id = $1 AND ${NORMALIZED_YEAR_LABEL_SQL} = $2`,
      [organizationId, normalizeYearLabel(yearLabel)]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: `No school year named "${yearLabel}" was found.` });
    }
    if (existing.rows.length > 1) {
      return res.status(409).json({ error: `More than one school year is named "${yearLabel}"; delete it manually from Manage Records.` });
    }

    const yearRow = existing.rows[0];

    const fakeReq = {
      body: { yearId: yearRow.id },
      session: { organizationId },
      flash: () => {},
    };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
      redirect: () => {},
    };
    // requestExpectsJson() (commonController.js) reads req.headers/req.xhr;
    // an Accept header of application/json routes deleteSchoolYear down its
    // res.json() branch instead of req.flash()+res.redirect().
    fakeReq.headers = { accept: "application/json" };

    await commonController.deleteSchoolYear(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.message || "Unable to delete school year.", wasCurrent: yearRow.current === true });
    }

    return res.json({ id: yearRow.id, yearLabel: yearRow.year_label, wasCurrent: yearRow.current === true });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteSchoolYear]", error);
    return res.status(500).json({ error: "Unable to delete school year." });
  }
}

// POST /internal/api/school-years/terms/add
// { organizationId, userId, userRole, accountType, userEmail, yearLabel, termName, startDate, endDate }
// Adds one term to an existing school year, applying the same date-overlap
// and gap-day rules as term creation (see createSchoolYear above /
// commonController.js registerSchoolYear) against that year's EXISTING
// terms.
async function addTermToSchoolYear(req, res) {
  try {
    const organizationId = await assertCanManageSchoolYears(req);

    const yearLabel = String(req.body?.yearLabel || "").trim();
    const termName = String(req.body?.termName || "").trim();
    const startDate = req.body?.startDate;
    const endDate = req.body?.endDate;
    if (!yearLabel || !termName || !startDate || !endDate) {
      return res.status(400).json({ error: "yearLabel, termName, startDate, and endDate are required." });
    }

    const s = new Date(startDate);
    const e = new Date(endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      return res.status(400).json({ error: "Invalid start or end date." });
    }
    if (s > e) {
      return res.status(400).json({ error: "Start date must be before end date." });
    }

    const yearRows = await db.query(
      `SELECT id FROM school_years WHERE organization_id = $1 AND ${NORMALIZED_YEAR_LABEL_SQL} = $2`,
      [organizationId, normalizeYearLabel(yearLabel)]
    );
    if (!yearRows.rows.length) {
      return res.status(404).json({ error: `No school year named "${yearLabel}" was found.` });
    }
    if (yearRows.rows.length > 1) {
      return res.status(409).json({ error: `More than one school year is named "${yearLabel}"; add the term manually from Manage Records.` });
    }
    const schoolYearId = yearRows.rows[0].id;

    const existingTerms = await db.query(
      `SELECT term_name, start_date, end_date FROM terms WHERE school_year_id = $1 AND organization_id = $2`,
      [schoolYearId, organizationId]
    );
    for (const term of existingTerms.rows) {
      const es = new Date(term.start_date);
      const ee = new Date(term.end_date);
      if (s <= ee && e >= es) {
        return res.status(409).json({ error: `Date range overlaps with existing term "${term.term_name}" (${String(term.start_date).slice(0, 10)} to ${String(term.end_date).slice(0, 10)}).` });
      }
    }

    const inserted = await db.query(
      "INSERT INTO terms (term_name, start_date, end_date, school_year_id, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING term_id, term_name, start_date, end_date",
      [termName, startDate, endDate, schoolYearId, organizationId]
    );

    return res.status(201).json({ yearLabel, term: inserted.rows[0] });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/addTermToSchoolYear]", error);
    return res.status(500).json({ error: "Unable to add term." });
  }
}

// POST /internal/api/school-years/terms/delete
// { organizationId, userId, userRole, accountType, userEmail, yearLabel, termName }
// Resolves (yearLabel, termName) to a term_id, then delegates to
// commonController.deleteTerm - which now runs the same
// collectTermDeletionBlockers() dependency-safety check as
// deleteSchoolYear (previously deleteTerm had none; fixed alongside adding
// this Mira action so the app's own UI gets the same protection).
async function deleteTermFromSchoolYear(req, res) {
  try {
    const organizationId = await assertCanManageSchoolYears(req);

    const yearLabel = String(req.body?.yearLabel || "").trim();
    const termName = String(req.body?.termName || "").trim();
    if (!yearLabel || !termName) {
      return res.status(400).json({ error: "yearLabel and termName are required." });
    }

    const termRows = await db.query(
      `SELECT t.term_id, t.term_name
       FROM terms t
       JOIN school_years sy ON sy.id = t.school_year_id
       WHERE sy.organization_id = $1 AND REPLACE(sy.year_label, ' ', '') = $2 AND t.organization_id = $1 AND t.term_name = $3`,
      [organizationId, normalizeYearLabel(yearLabel), termName]
    );
    if (!termRows.rows.length) {
      return res.status(404).json({ error: `No term named "${termName}" was found under school year "${yearLabel}".` });
    }
    if (termRows.rows.length > 1) {
      return res.status(409).json({ error: `More than one term is named "${termName}" under "${yearLabel}"; delete it manually from Manage Records.` });
    }
    const term = termRows.rows[0];

    const fakeReq = {
      body: { term_id: term.term_id },
      session: { organizationId },
      flash: () => {},
      headers: { accept: "application/json" },
    };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
      redirect: () => {},
    };

    await commonController.deleteTerm(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.message || "Unable to delete term." });
    }
    return res.json({ termId: term.term_id, termName: term.term_name, yearLabel });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteTermFromSchoolYear]", error);
    return res.status(500).json({ error: "Unable to delete term." });
  }
}

// ============================================================
// Classes, Subjects & Graduation Year Groups
// (/common/manageClassSubjectAndGradYr) - same pattern as the School Years
// section above: read tools resolve by exact-ish name, write tools re-derive
// the caller's real MANAGE_CLASSES_SUBJECTS permission from the database,
// and destructive deletes delegate to the main app's own controller
// functions (now hardened - see collectClassDeletionBlockers in
// commonController.js) rather than re-implementing their safety logic.
// ============================================================

// POST /internal/api/classes/create
// { organizationId, userId, userRole, accountType, userEmail, classNames: string[] }
async function createClasses(req, res) {
  const client = await db.connect();
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const classNames = (Array.isArray(req.body?.classNames) ? req.body.classNames : [])
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    if (!classNames.length) {
      return res.status(400).json({ error: "At least one class name is required." });
    }
    for (const name of classNames) {
      if (!/^[A-Za-z0-9\s\-]+$/.test(name)) {
        return res.status(400).json({ error: `"${name}" isn't a valid class name - use only letters, numbers, spaces, and hyphens.` });
      }
    }

    await client.query("BEGIN");

    const existing = await client.query(`SELECT class_name FROM classes WHERE organization_id = $1`, [organizationId]);
    const existingNormalized = new Set(existing.rows.map((r) => normalizeName(r.class_name)));
    const duplicates = classNames.filter((name) => existingNormalized.has(normalizeName(name)));
    if (duplicates.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Class${duplicates.length === 1 ? "" : "es"} already exist: ${duplicates.join(", ")}.` });
    }

    const maxOrderResult = await client.query(
      "SELECT COALESCE(MAX(dashboard_sort_order), 0) AS max_order FROM classes WHERE organization_id = $1",
      [organizationId]
    );
    let nextSortOrder = Number(maxOrderResult.rows[0]?.max_order || 0);

    const created = [];
    for (const name of classNames) {
      nextSortOrder += 1;
      const inserted = await client.query(
        "INSERT INTO classes (class_name, organization_id, dashboard_sort_order) VALUES ($1, $2, $3) RETURNING class_id, class_name",
        [name, organizationId, nextSortOrder]
      );
      created.push(inserted.rows[0]);
    }

    await client.query("COMMIT");
    return res.status(201).json({ classes: created });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createClasses]", error);
    return res.status(500).json({ error: "Unable to create class(es)." });
  } finally {
    client.release();
  }
}

// POST /internal/api/classes/rename
// { organizationId, ..., className, newClassName }
async function renameClass(req, res) {
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const className = String(req.body?.className || "").trim();
    const newClassName = String(req.body?.newClassName || "").trim();
    if (!className || !newClassName) {
      return res.status(400).json({ error: "className and newClassName are required." });
    }
    if (!/^[A-Za-z0-9\s\-]+$/.test(newClassName)) {
      return res.status(400).json({ error: "newClassName may only contain letters, numbers, spaces, and hyphens." });
    }

    const rows = await db.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1`, [organizationId]);
    const match = rows.rows.filter((r) => normalizeName(r.class_name) === normalizeName(className));
    if (!match.length) return res.status(404).json({ error: `No class named "${className}" was found.` });
    if (match.length > 1) return res.status(409).json({ error: `More than one class is named "${className}"; rename it manually from Manage Records.` });

    const duplicate = rows.rows.some((r) => r.class_id !== match[0].class_id && normalizeName(r.class_name) === normalizeName(newClassName));
    if (duplicate) return res.status(409).json({ error: `A class named "${newClassName}" already exists.` });

    await db.query("UPDATE classes SET class_name = $1 WHERE class_id = $2 AND organization_id = $3", [
      newClassName,
      match[0].class_id,
      organizationId,
    ]);

    return res.json({ id: match[0].class_id, oldName: match[0].class_name, newName: newClassName });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/renameClass]", error);
    return res.status(500).json({ error: "Unable to rename class." });
  }
}

// POST /internal/api/classes/delete
// { organizationId, ..., className } - delegates to the hardened
// commonController.deleteClass (blocked by collectClassDeletionBlockers if
// students/attendance/assessments/etc. still reference the class).
async function deleteClassApi(req, res) {
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const className = String(req.body?.className || "").trim();
    if (!className) return res.status(400).json({ error: "className is required." });

    const rows = await db.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1`, [organizationId]);
    const match = rows.rows.filter((r) => normalizeName(r.class_name) === normalizeName(className));
    if (!match.length) return res.status(404).json({ error: `No class named "${className}" was found.` });
    if (match.length > 1) return res.status(409).json({ error: `More than one class is named "${className}"; delete it manually from Manage Records.` });

    const classRow = match[0];
    const fakeReq = { query: { classId: classRow.class_id }, session: { organizationId }, flash: () => {}, headers: { accept: "application/json" } };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
      redirect: () => {},
    };

    await commonController.deleteClass(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.message || "Unable to delete class." });
    }
    return res.json({ id: classRow.class_id, className: classRow.class_name });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteClassApi]", error);
    return res.status(500).json({ error: "Unable to delete class." });
  }
}

// POST /internal/api/classes/reorder
// { organizationId, ..., orderedClassNames: string[] } - names given
// top-to-bottom in the desired dashboard order. Classes not mentioned keep
// their relative existing order, appended after the named ones (same
// resilient-merge behavior as commonController.updateClassDashboardLayout,
// which this delegates to).
async function reorderClasses(req, res) {
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const orderedClassNames = (Array.isArray(req.body?.orderedClassNames) ? req.body.orderedClassNames : [])
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    if (!orderedClassNames.length) {
      return res.status(400).json({ error: "orderedClassNames must be a non-empty array of class names." });
    }

    const rows = await db.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1`, [organizationId]);
    const byNormalizedName = new Map(rows.rows.map((r) => [normalizeName(r.class_name), r]));

    const resolved = [];
    const notFound = [];
    for (const name of orderedClassNames) {
      const row = byNormalizedName.get(normalizeName(name));
      if (row) resolved.push(row);
      else notFound.push(name);
    }
    if (notFound.length) {
      return res.status(404).json({ error: `Class${notFound.length === 1 ? "" : "es"} not found: ${notFound.join(", ")}.` });
    }

    const layoutPayload = JSON.stringify(resolved.map((r) => ({ classId: r.class_id, breakAfter: false })));
    const fakeReq = { body: { layoutPayload }, session: { organizationId }, flash: () => {}, headers: { accept: "application/json" } };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
      redirect: () => {},
    };

    await commonController.updateClassDashboardLayout(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.message || "Unable to reorder classes." });
    }

    const newOrder = await db.query(
      `SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY COALESCE(dashboard_sort_order, 2147483647), class_name ASC, class_id ASC`,
      [organizationId]
    );
    return res.json({ classes: newOrder.rows });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/reorderClasses]", error);
    return res.status(500).json({ error: "Unable to reorder classes." });
  }
}

// GET /internal/api/subjects?organizationId=63
// Groups subjects.subjects rows by name (there's no distinct "subject"
// entity - one row per subject_name+class_id pair) so Mira sees each
// subject once, with which classes have it and which don't - same shape
// as the manageClassSubjectAndGradYr page's own subjectGroups.
async function listSubjects(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const [classesResult, subjectsResult] = await Promise.all([
      db.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1 ORDER BY class_name`, [organizationId]),
      db.query(`SELECT subject_id, subject_name, class_id FROM subjects WHERE organization_id = $1 ORDER BY subject_name`, [organizationId]),
    ]);
    const classes = classesResult.rows;
    const classMap = new Map(classes.map((c) => [Number(c.class_id), c]));

    const groups = new Map();
    for (const subject of subjectsResult.rows) {
      const rawName = String(subject.subject_name || "").trim();
      if (!rawName) continue;
      const key = rawName.toLowerCase();
      if (!groups.has(key)) groups.set(key, { subject_key: key, subject_name: rawName, assigned_classes: [] });
      const group = groups.get(key);
      const classId = Number(subject.class_id);
      const classInfo = classMap.get(classId);
      if (classInfo && !group.assigned_classes.some((c) => c.class_id === classInfo.class_id)) {
        group.assigned_classes.push({ class_id: classInfo.class_id, class_name: classInfo.class_name });
      }
    }

    const subjectGroups = Array.from(groups.values()).map((group) => {
      const assignedIds = new Set(group.assigned_classes.map((c) => Number(c.class_id)));
      return {
        ...group,
        unassigned_classes: classes.filter((c) => !assignedIds.has(Number(c.class_id))).map((c) => ({ class_id: c.class_id, class_name: c.class_name })),
      };
    });

    return res.json({ subjects: subjectGroups });
  } catch (error) {
    console.error("[internalApi/listSubjects]", error);
    return res.status(500).json({ error: "Unable to load subjects." });
  }
}

// POST /internal/api/subjects/create
// { organizationId, ..., subjectName, classNames: string[] } - one row per
// (subjectName, class) pair, skipping any pair that already exists (same
// dedup as commonController.addSubject).
async function createSubject(req, res) {
  const client = await db.connect();
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const subjectName = String(req.body?.subjectName || "").trim();
    const classNames = (Array.isArray(req.body?.classNames) ? req.body.classNames : []).map((n) => String(n || "").trim()).filter(Boolean);
    if (!subjectName || !classNames.length) {
      return res.status(400).json({ error: "subjectName and at least one class name are required." });
    }

    await client.query("BEGIN");

    const classRows = await client.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1`, [organizationId]);
    const byName = new Map(classRows.rows.map((r) => [normalizeName(r.class_name), r]));
    const notFound = classNames.filter((n) => !byName.has(normalizeName(n)));
    if (notFound.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: `Class${notFound.length === 1 ? "" : "es"} not found: ${notFound.join(", ")}.` });
    }

    const created = [];
    const alreadyAssigned = [];
    for (const name of classNames) {
      const classRow = byName.get(normalizeName(name));
      const existing = await client.query(`SELECT 1 FROM subjects WHERE subject_name = $1 AND class_id = $2 AND organization_id = $3`, [
        subjectName,
        classRow.class_id,
        organizationId,
      ]);
      if (existing.rows.length) {
        alreadyAssigned.push(classRow.class_name);
        continue;
      }
      const inserted = await client.query(
        `INSERT INTO subjects (subject_name, class_id, organization_id) VALUES ($1, $2, $3) RETURNING subject_id, subject_name, class_id`,
        [subjectName, classRow.class_id, organizationId]
      );
      created.push({ ...inserted.rows[0], class_name: classRow.class_name });
    }

    await client.query("COMMIT");
    return res.status(201).json({ subjectName, created, alreadyAssigned });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createSubject]", error);
    return res.status(500).json({ error: "Unable to create subject." });
  } finally {
    client.release();
  }
}

// POST /internal/api/subjects/assign
// { organizationId, ..., subjectName, classNames: string[] } - adds an
// EXISTING subject to more classes. Same underlying insert as create, kept
// as a separate endpoint/tool so Mira's intent ("assign" vs "create a new
// subject") stays explicit rather than silently doing either.
async function assignSubjectToClasses(req, res) {
  return createSubject(req, res);
}

// POST /internal/api/subjects/rename
// { organizationId, ..., subjectName, newSubjectName } - renames every row
// sharing that name (i.e. the whole subject "group" across all classes),
// same bulk semantics as commonController.editSubject's bulk mode.
async function renameSubject(req, res) {
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const subjectName = String(req.body?.subjectName || "").trim();
    const newSubjectName = String(req.body?.newSubjectName || "").trim();
    if (!subjectName || !newSubjectName) {
      return res.status(400).json({ error: "subjectName and newSubjectName are required." });
    }

    const existing = await db.query(
      `SELECT subject_id FROM subjects WHERE organization_id = $1 AND LOWER(TRIM(subject_name)) = $2`,
      [organizationId, normalizeName(subjectName)]
    );
    if (!existing.rows.length) return res.status(404).json({ error: `No subject named "${subjectName}" was found.` });

    const duplicate = await db.query(
      `SELECT 1 FROM subjects WHERE organization_id = $1 AND LOWER(TRIM(subject_name)) = $2 LIMIT 1`,
      [organizationId, normalizeName(newSubjectName)]
    );
    if (duplicate.rows.length) return res.status(409).json({ error: `A subject named "${newSubjectName}" already exists.` });

    const result = await db.query(
      `UPDATE subjects SET subject_name = $1 WHERE organization_id = $2 AND LOWER(TRIM(subject_name)) = $3`,
      [newSubjectName, organizationId, normalizeName(subjectName)]
    );
    return res.json({ oldName: subjectName, newName: newSubjectName, classesAffected: result.rowCount });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/renameSubject]", error);
    return res.status(500).json({ error: "Unable to rename subject." });
  }
}

// POST /internal/api/subjects/delete
// { organizationId, ..., subjectName, className? } - className omitted
// deletes the subject from EVERY class (the whole group, matching
// commonController.deleteSubject's subjectKey mode); className given
// removes just that one class's row (subjectId mode). Delegates the actual
// delete to deleteSubject, which already cleans up dependent
// assessment_results/student_subjects/etc rows.
async function resolveSubjectDeleteScope(organizationId, subjectName, className) {
  if (className) {
    const row = await db.query(
      `SELECT s.subject_id FROM subjects s JOIN classes c ON c.class_id = s.class_id
       WHERE s.organization_id = $1 AND LOWER(TRIM(s.subject_name)) = $2 AND LOWER(TRIM(c.class_name)) = $3`,
      [organizationId, normalizeName(subjectName), normalizeName(className)]
    );
    if (!row.rows.length) return { error: `Subject "${subjectName}" was not found in class "${className}".` };
    return { subjectIds: [row.rows[0].subject_id], queryParams: { subjectId: row.rows[0].subject_id }, scopeLabel: `"${subjectName}" in "${className}"` };
  }
  const rows = await db.query(`SELECT subject_id FROM subjects WHERE organization_id = $1 AND LOWER(TRIM(subject_name)) = $2`, [
    organizationId,
    normalizeName(subjectName),
  ]);
  if (!rows.rows.length) return { error: `No subject named "${subjectName}" was found.` };
  return { subjectIds: rows.rows.map((r) => r.subject_id), queryParams: { subjectKey: subjectName }, scopeLabel: `"${subjectName}" (all classes)` };
}

// GET /internal/api/subjects/delete-impact?organizationId=63&subjectName=Math&className=Grade+3
// Read-only preview: how many assessment results/records would be lost if
// this subject (or just its one class assignment) were deleted, so Mira
// can give an honest, specific warning before the destructive call below -
// deleteSubject doesn't block on this the way deleteClass/deleteSchoolYear
// do (it's existing, expected app behavior to cascade), so the warning is
// the only safeguard.
async function getSubjectDeleteImpact(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    const subjectName = String(req.query.subjectName || "").trim();
    const className = String(req.query.className || "").trim();
    if (!Number.isInteger(organizationId) || !subjectName) {
      return res.status(400).json({ error: "organizationId and subjectName are required." });
    }

    const scope = await resolveSubjectDeleteScope(organizationId, subjectName, className);
    if (scope.error) return res.status(404).json({ error: scope.error });

    const countTables = ["assessment_results", "student_subjects", "pending_student_subjects", "assessments", "user_subjects"];
    const counts = {};
    for (const tableName of countTables) {
      const exists = await db.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1) AS exists`,
        [tableName]
      );
      if (!exists.rows[0]?.exists) continue;
      const countResult = await db.query(`SELECT COUNT(*)::int AS count FROM ${tableName} WHERE subject_id = ANY($1::int[])`, [scope.subjectIds]);
      const count = Number(countResult.rows[0]?.count || 0);
      if (count > 0) counts[tableName] = count;
    }

    return res.json({ subjectName, className: className || null, scope: scope.scopeLabel, dependentCounts: counts });
  } catch (error) {
    console.error("[internalApi/getSubjectDeleteImpact]", error);
    return res.status(500).json({ error: "Unable to check subject impact." });
  }
}

async function deleteSubjectApi(req, res) {
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const subjectName = String(req.body?.subjectName || "").trim();
    const className = String(req.body?.className || "").trim();
    if (!subjectName) return res.status(400).json({ error: "subjectName is required." });

    const scope = await resolveSubjectDeleteScope(organizationId, subjectName, className);
    if (scope.error) return res.status(404).json({ error: scope.error });

    const fakeReq = { query: scope.queryParams, session: { organizationId }, flash: () => {} };
    let flashError = null;
    fakeReq.flash = (type, message) => {
      if (type === "error") flashError = message;
    };
    const fakeRes = { redirect: () => {} };

    await commonController.deleteSubject(fakeReq, fakeRes, db);

    if (flashError) return res.status(500).json({ error: flashError });
    return res.json({ subjectName, className: className || null, scope: scope.scopeLabel });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteSubjectApi]", error);
    return res.status(500).json({ error: "Unable to delete subject." });
  }
}

// GET /internal/api/graduation-year-groups?organizationId=63
async function listGraduationYearGroups(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const result = await db.query(
      `SELECT g.id, g.name, COUNT(c.class_id)::int AS class_count
       FROM graduation_year_groups g
       LEFT JOIN classes c ON c.graduation_year_group_id = g.id AND c.organization_id = g.organization_id
       WHERE g.organization_id = $1
       GROUP BY g.id, g.name
       ORDER BY g.name`,
      [organizationId]
    );
    return res.json({ graduationYearGroups: result.rows });
  } catch (error) {
    console.error("[internalApi/listGraduationYearGroups]", error);
    return res.status(500).json({ error: "Unable to load graduation year groups." });
  }
}

// POST /internal/api/graduation-year-groups/create
// { organizationId, ..., year } - name is always synthesized as "Graduation
// Class of {year} Group", matching the app's own convention
// (commonController.addGraduationYearGroup) - Mira never invents a raw name.
async function createGraduationYearGroup(req, res) {
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const yearRaw = String(req.body?.year || "").trim();
    if (!/^\d{4}$/.test(yearRaw)) {
      return res.status(400).json({ error: "year must be a 4-digit number, e.g. 2031." });
    }
    const name = `Graduation Class of ${yearRaw} Group`;

    const duplicate = await db.query(`SELECT id FROM graduation_year_groups WHERE organization_id = $1 AND LOWER(name) = LOWER($2)`, [
      organizationId,
      name,
    ]);
    if (duplicate.rows.length) {
      return res.status(409).json({ error: `"${name}" already exists.` });
    }

    const inserted = await db.query(`INSERT INTO graduation_year_groups (name, organization_id) VALUES ($1, $2) RETURNING id, name`, [
      name,
      organizationId,
    ]);
    return res.status(201).json({ graduationYearGroup: inserted.rows[0] });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createGraduationYearGroup]", error);
    return res.status(500).json({ error: "Unable to create graduation year group." });
  }
}

// POST /internal/api/graduation-year-groups/rename
// { organizationId, ..., name, newName }
async function renameGraduationYearGroup(req, res) {
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const name = String(req.body?.name || "").trim();
    const newName = String(req.body?.newName || "").trim();
    if (!name || !newName) return res.status(400).json({ error: "name and newName are required." });

    const existing = await db.query(`SELECT id FROM graduation_year_groups WHERE organization_id = $1 AND LOWER(name) = LOWER($2)`, [
      organizationId,
      name,
    ]);
    if (!existing.rows.length) return res.status(404).json({ error: `No graduation year group named "${name}" was found.` });
    if (existing.rows.length > 1) return res.status(409).json({ error: `More than one graduation year group is named "${name}"; rename it manually.` });

    const duplicate = await db.query(
      `SELECT id FROM graduation_year_groups WHERE organization_id = $1 AND LOWER(name) = LOWER($2) AND id != $3`,
      [organizationId, newName, existing.rows[0].id]
    );
    if (duplicate.rows.length) return res.status(409).json({ error: `A graduation year group named "${newName}" already exists.` });

    await db.query(`UPDATE graduation_year_groups SET name = $1 WHERE id = $2 AND organization_id = $3`, [
      newName,
      existing.rows[0].id,
      organizationId,
    ]);
    return res.json({ id: existing.rows[0].id, oldName: name, newName });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/renameGraduationYearGroup]", error);
    return res.status(500).json({ error: "Unable to rename graduation year group." });
  }
}

// POST /internal/api/graduation-year-groups/delete
// { organizationId, ..., name } - delegates to the hardened
// commonController.deleteGraduationYearGroup (blocked if classes still
// reference it).
async function deleteGraduationYearGroupApi(req, res) {
  try {
    const organizationId = await assertCanManageClassesSubjects(req);

    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required." });

    const existing = await db.query(`SELECT id, name FROM graduation_year_groups WHERE organization_id = $1 AND LOWER(name) = LOWER($2)`, [
      organizationId,
      name,
    ]);
    if (!existing.rows.length) return res.status(404).json({ error: `No graduation year group named "${name}" was found.` });
    if (existing.rows.length > 1) return res.status(409).json({ error: `More than one graduation year group is named "${name}"; delete it manually.` });

    const group = existing.rows[0];
    const fakeReq = { query: { id: group.id }, session: { organizationId }, flash: () => {}, headers: { accept: "application/json" } };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
      redirect: () => {},
    };

    await commonController.deleteGraduationYearGroup(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.message || "Unable to delete graduation year group." });
    }
    return res.json({ id: group.id, name: group.name });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteGraduationYearGroupApi]", error);
    return res.status(500).json({ error: "Unable to delete graduation year group." });
  }
}

// POST /internal/api/activity-logs
// Lets Mira record every write action it performs into the same
// organization_activity_logs table/page the rest of the app logs to
// (utils/activityLog.js, viewed at /common/activityLogs), tagged as coming
// "via Mira" in the description so staff can audit AI-driven changes
// alongside human ones.
async function logActivity(req, res) {
  try {
    const organizationId = parseInt(req.body?.organizationId, 10);
    if (!Number.isInteger(organizationId)) {
      return res.status(400).json({ error: "organizationId is required." });
    }
    await logOrganizationActivity({
      organizationId,
      userId: req.body?.userId || null,
      userName: req.body?.userName || "Unknown User",
      userRole: req.body?.userRole || null,
      actionType: req.body?.actionType || "Updated",
      moduleName: req.body?.moduleName || "Mira",
      pagePath: req.body?.pagePath || null,
      recordType: req.body?.recordType || null,
      recordId: req.body?.recordId || null,
      recordLabel: req.body?.recordLabel || null,
      description: req.body?.description || "Mira performed an action.",
      changedFields: req.body?.changedFields || [],
    });
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error("[internalApi/logActivity]", error);
    return res.status(500).json({ error: "Unable to write activity log." });
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
  listSchoolYears,
  createSchoolYear,
  renameSchoolYear,
  deleteSchoolYear,
  addTermToSchoolYear,
  deleteTermFromSchoolYear,
  createClasses,
  renameClass,
  deleteClassApi,
  reorderClasses,
  listSubjects,
  createSubject,
  assignSubjectToClasses,
  renameSubject,
  deleteSubjectApi,
  getSubjectDeleteImpact,
  listGraduationYearGroups,
  createGraduationYearGroup,
  renameGraduationYearGroup,
  deleteGraduationYearGroupApi,
  logActivity,
};
