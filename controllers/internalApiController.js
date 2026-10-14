// Thin, read-mostly internal API for the separate Mira AI service
// (mira/). Every handler here is called service-to-service (gated by
// middleware/internalServiceAuth.js), never directly by a browser. Handlers
// deliberately reuse existing query patterns from the main controllers
// rather than introduce new business logic - this file is a thin
// translation layer, not a second copy of the app.
const { renameLibrarySubject } = require("../utils/academicLibrary");
const db = require("../config/db");
const crypto = require("crypto");
const cookieSignature = require("cookie-signature");
const connectPgSimple = require("connect-pg-simple");
const session = require("express-session");
const {
  userHasPermission,
  PERMISSIONS,
  PERMISSION_OPTIONS,
  MAILROOM_ALL_ACCESS_KEY,
  isManagerLikeRole,
  normalizePermissionsList,
  getUserPermissions,
} = require("../middleware/permissionMiddleware");
const {
  commonController,
  getUpcomingBirthdayInfo,
  buildUpcomingBirthdayCards,
} = require("./commonController");
const promotionController = require("./promotionController");
const { transportationController, getStudentTransportationSnapshot } = require("./transportationController");
const accountController = require("./accountController");
const { uploadToS3 } = require("../middleware/s3Upload");
const { renderReportCardsPerStudent, renderMeritSheetPdf, storePdf } = require("../utils/pdfService");
const { parseMeritSheetColumns, buildMeritSheetData } = require("../utils/meritSheetData");
const websiteExtras = require("../utils/websiteExtras");
const { getOrganizationWebsiteInfo } = require("../utils/schoolWebsiteAccess");
const statsController = require("./statsController");
const guardianMessaging = require("./guardianMessagingController");
const { getMessagingChannelStatus, sendGuardianMessages, countSmsSegments, sanitizeForSms } = require("../utils/guardianMessaging");
const { createShortLink } = require("../utils/shortLink");
const { recordMessageSent, recordDeliveryAuditRow } = require("../utils/messageDeliveryLog");
const { isEmailEnabledForRecipient } = require("../utils/emailPreferences");
const { reverseGeocode, geocodeAddress } = require("../utils/geocode");
const { documentController, ensureDocumentsSchema } = require("./documentController");
const { logOrganizationActivity, getLatestIntegrationActivity } = require("../utils/activityLog");
const { getGoogleIntegrationStatus } = require("../utils/googleClassroomIntegration");
const { getWhatsappIntegrationStatus } = require("../utils/whatsappIntegration");
const { getStudentPortalIntegrationStatus } = require("../utils/studentPortal");
const { getTransportationIntegrationStatus } = require("../utils/transportation");
const { getSmsIntegrationStatus } = require("../utils/smsIntegration");
const { getMiraIntegrationStatus } = require("../utils/miraIntegration");
const commonValidation = require("../validation/commonValidation");
const printController = require("./printController")(db);
const { formatDisplayName } = require("../utils/organizationDisplayPreferences");
const notifSvc = require("../utils/notificationService");

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
    // Needed so Mira's write endpoints can pass userEmail into
    // userHasPermission (middleware/permissionMiddleware.js) the same way
    // requirePermission() does for the browser UI - a user logged in as an
    // employee whose email matches the org's own signup email is the
    // organization owner and gets full access regardless of individually
    // granted permissions. Without this, Mira was strictly more
    // restrictive than the real app for that exact case.
    userEmail: sessionData.user?.email || sessionData.email || null,
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

// GET /internal/api/students/search?organizationId=63&q=john&className=Grade%205
// Reuses the same students/classes join pattern used throughout
// commonController.js (e.g. student profile lookups) rather than
// introducing new query logic. organizationId is required on every call -
// Mira derives it from the caller's *validated* session identity, never
// from client input, but this endpoint scopes by it regardless as a second
// layer of tenant enforcement.
async function searchStudents(req, res) {
  try {
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_STUDENTS], "You don't have permission to view student records.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    const q = String(req.query.q || "").trim();
    const className = String(req.query.className || "").trim();
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
         AND ($3 = '' OR LOWER(c.class_name) = LOWER($3))
       ORDER BY s.last_name, s.first_name
       LIMIT 10`,
      [organizationId, `%${q}%`, className]
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
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_PAYGIRA, PERMISSIONS.MANAGE_BILLING], "You don't have permission to view fees and payments.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
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
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MARK_ATTENDANCE, PERMISSIONS.MANAGE_STUDENTS], "You don't have permission to view attendance.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
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

// GET /internal/api/mira/activation-status?organizationId=63&userId=&userRole=&accountType=&userEmail=
// - the two booleans Mira's own server checks on every request (see
// mira/middleware/requireMiraActivated.js) to decide whether this org has
// Mira on at all, and whether this specific caller has been individually
// granted access to it (PERMISSIONS.USE_MIRA - see /account/mira). Caller
// identity fields are optional so the org-only check still works if a
// caller only wants `activated`. Deliberately its own tiny endpoint rather
// than reusing getIntegrationsStatusApi: that one requires Manage Settings
// and returns every integration's full config, more than this gate check
// needs or should be able to see.
//
// Deliberately does NOT call the shared userHasPermission() helper for the
// `canUse` check - that function always grants the organization owner (and
// any user whose email matches the org's own signup email) every
// permission automatically, which is the right behavior for the rest of
// the app but wrong for Mira specifically: everyone with access to Mira,
// including the owner, needs their own explicit "Use Mira" grant, because
// every seat is meant to be individually billable once pricing is wired
// up. This reads the real user_permissions row directly instead, so the
// owner is never silently treated as a free/unbilled seat.
async function getMiraActivationStatusApi(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const status = await getMiraIntegrationStatus(db, organizationId);
    const activated = !!status.activated;

    const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;
    let canUse = false;
    if (activated && Number.isInteger(userId)) {
      const permissions = await getUserPermissions(db, userId, organizationId);
      canUse = permissions.includes(PERMISSIONS.USE_MIRA);
    }

    return res.json({ activated, canUse });
  } catch (error) {
    console.error("[internalApi/getMiraActivationStatusApi]", error);
    return res.status(500).json({ error: "Unable to load Mira activation status." });
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

// GET /internal/api/guardians/details?organizationId=63&guardianName=|studentName=|email=
// Guardian data lives in two parallel tables kept in sync only by fuzzy
// application-level matching (guardian_profiles/guardian_students/
// guardian_accounts - the modern model everything else in this file
// already reads from, e.g. getStudentGuardians above - and a legacy
// per-student `guardians` table from before that model existed). This
// treats guardian_profiles as authoritative and only falls back to the
// legacy table when nothing is found there, for orgs with older
// un-migrated records. Read-only - matches the product decision to keep
// this page look-up-only for now, given neither table enforces a
// permission check on its own writes today.
async function getGuardianDetailsApi(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const guardianName = String(req.query.guardianName || "").trim();
    const studentName = String(req.query.studentName || "").trim();
    const email = String(req.query.email || "").trim();
    if (!guardianName && !studentName && !email) {
      return res.status(400).json({ error: "Provide a guardianName, studentName, or email to look up." });
    }

    let profileRows;
    if (email) {
      profileRows = await db.query(
        `SELECT guardian_id, first_name, last_name, phone, email, address, hometown FROM guardian_profiles WHERE organization_id = $1 AND LOWER(email) = LOWER($2)`,
        [organizationId, email]
      );
    } else if (studentName) {
      const student = await resolveStudentByName(organizationId, studentName);
      profileRows = await db.query(
        `SELECT gp.guardian_id, gp.first_name, gp.last_name, gp.phone, gp.email, gp.address, gp.hometown
         FROM guardian_students gs JOIN guardian_profiles gp ON gp.guardian_id = gs.guardian_id
         WHERE gs.student_id = $1 AND gp.organization_id = $2`,
        [student.student_id, organizationId]
      );
    } else {
      profileRows = await db.query(
        `SELECT guardian_id, first_name, last_name, phone, email, address, hometown FROM guardian_profiles WHERE organization_id = $1 AND (first_name || ' ' || last_name) ILIKE $2`,
        [organizationId, `%${guardianName}%`]
      );
    }

    let guardians = [];
    if (profileRows.rows.length) {
      const guardianIds = profileRows.rows.map((r) => r.guardian_id);
      const studentsRes = await db.query(
        `SELECT gs.guardian_id, s.student_id, s.first_name, s.last_name, gs.relationship
         FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id
         WHERE gs.guardian_id = ANY($1::int[])`,
        [guardianIds]
      );
      const accountsRes = await db.query(
        `SELECT guardian_id, login_email, login_phone, (password_hash IS NOT NULL) AS password_set FROM guardian_accounts WHERE guardian_id = ANY($1::int[])`,
        [guardianIds]
      );
      const studentsByGuardian = new Map();
      studentsRes.rows.forEach((r) => {
        if (!studentsByGuardian.has(r.guardian_id)) studentsByGuardian.set(r.guardian_id, []);
        studentsByGuardian.get(r.guardian_id).push({ studentName: `${r.first_name} ${r.last_name}`, relationship: r.relationship });
      });
      const accountByGuardian = new Map(accountsRes.rows.map((r) => [r.guardian_id, r]));

      guardians = profileRows.rows.map((r) => {
        const account = accountByGuardian.get(r.guardian_id);
        return {
          source: "profile",
          name: `${r.first_name} ${r.last_name}`,
          phone: r.phone,
          email: r.email,
          address: r.address,
          hometown: r.hometown,
          students: studentsByGuardian.get(r.guardian_id) || [],
          portalAccess: account
            ? { hasAccount: true, loginEmail: account.login_email, loginPhone: account.login_phone, passwordSet: account.password_set === true }
            : { hasAccount: false },
        };
      });
    } else {
      let legacyRows;
      if (email) {
        legacyRows = await db.query(
          `SELECT g.guardian_id, g.first_name, g.last_name, g.phone, g.email, g.address, g.hometown, s.first_name AS student_first_name, s.last_name AS student_last_name
           FROM guardians g JOIN students s ON s.student_id = g.student_id
           WHERE g.organization_id = $1 AND LOWER(g.email) = LOWER($2)`,
          [organizationId, email]
        );
      } else if (studentName) {
        const student = await resolveStudentByName(organizationId, studentName);
        legacyRows = await db.query(
          `SELECT g.guardian_id, g.first_name, g.last_name, g.phone, g.email, g.address, g.hometown, s.first_name AS student_first_name, s.last_name AS student_last_name
           FROM guardians g JOIN students s ON s.student_id = g.student_id
           WHERE g.student_id = $1 AND g.organization_id = $2`,
          [student.student_id, organizationId]
        );
      } else {
        legacyRows = await db.query(
          `SELECT g.guardian_id, g.first_name, g.last_name, g.phone, g.email, g.address, g.hometown, s.first_name AS student_first_name, s.last_name AS student_last_name
           FROM guardians g JOIN students s ON s.student_id = g.student_id
           WHERE g.organization_id = $1 AND (g.first_name || ' ' || g.last_name) ILIKE $2`,
          [organizationId, `%${guardianName}%`]
        );
      }
      guardians = legacyRows.rows.map((r) => ({
        source: "legacy",
        name: `${r.first_name} ${r.last_name}`,
        phone: r.phone,
        email: r.email,
        address: r.address,
        hometown: r.hometown,
        students: [{ studentName: `${r.student_first_name} ${r.student_last_name}`, relationship: null }],
        portalAccess: { hasAccount: false },
      }));
    }

    return res.json({ guardians });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getGuardianDetailsApi]", error);
    return res.status(500).json({ error: "Unable to load guardian details." });
  }
}

// POST /internal/api/announcements
// { organizationId, title, body }
// Creates a dashboard notice for the caller's school staff in the unified
// announcement system (broadcast_announcements, display_type 'dashboard'),
// shown once per person on the school dashboard - the same behavior the
// older admin_announcements notices had.
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

    const { ensureAnnouncementSchema, SCHOOL_STAFF_ROLES } = require("../utils/announcementSystem");
    await ensureAnnouncementSchema(db);
    const createdBy = Number.parseInt(req.body?.userId, 10);
    const inserted = await db.query(
      `INSERT INTO broadcast_announcements
         (tenant_id, title, body, display_type, variant, position, frequency, dismissible, is_active, created_by)
       VALUES ($1, $2, $3, 'dashboard', 'info', 'center', 'once', TRUE, TRUE, $4)
       RETURNING *`,
      [organizationId, title.slice(0, 255), body, Number.isFinite(createdBy) ? createdBy : null]
    );
    const announcement = inserted.rows[0];
    for (const role of SCHOOL_STAFF_ROLES) {
      await db.query(
        `INSERT INTO broadcast_announcement_targets (announcement_id, target_type, target_value) VALUES ($1, 'role', $2)`,
        [announcement.id, role]
      );
    }

    return res.status(201).json({ announcement });
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
async function assertHasPermissionFrom(params, permissionKey, deniedMessage) {
  const { organizationId, userId, userRole, accountType, userEmail } = params || {};
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

// Write endpoints carry caller identity in the POST body. A couple of
// promotion endpoints need the same check on GET reads (the real
// /promotion/* routes gate viewing, not just writing) - assertHasPermission
// stays the body-based helper every other write endpoint already calls;
// assertHasPermissionQuery is the query-string sibling for those GETs.
async function assertHasPermission(req, permissionKey, deniedMessage) {
  return assertHasPermissionFrom(req.body, permissionKey, deniedMessage);
}

async function assertHasPermissionQuery(req, permissionKey, deniedMessage) {
  return assertHasPermissionFrom(req.query, permissionKey, deniedMessage);
}

// Read endpoints: the caller needs at least one of the permissions the
// matching website page requires (identity comes from Mira's validated
// session, added to every call by mira/internalApiClient.js).
async function assertHasAnyPermissionQuery(req, permissionKeys, deniedMessage) {
  const { organizationId, userId, userRole, accountType, userEmail } = req.query || {};
  const orgId = parseInt(organizationId, 10);
  if (!Number.isInteger(orgId)) {
    const error = new Error("organizationId is required.");
    error.status = 400;
    throw error;
  }
  for (const permissionKey of permissionKeys) {
    if (await userHasPermission(db, { userId, userRole, organizationId: orgId, accountType, userEmail }, permissionKey)) {
      return orgId;
    }
  }
  const error = new Error(deniedMessage);
  error.status = 403;
  throw error;
}

function sendPermissionError(res, error) {
  return res.status(error.status).json({ error: error.message });
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
      const existing = await client.query(`SELECT 1 FROM subjects WHERE LOWER(TRIM(subject_name)) = LOWER(TRIM($1)) AND class_id = $2 AND organization_id = $3`, [
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
      // The database skips a subject the class already teaches (see utils/academicLibrary.js).
      if (inserted.rows.length) created.push({ ...inserted.rows[0], class_name: classRow.class_name });
      else alreadyAssigned.push(classRow.class_name);
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

    // Rename the school's library subject (and every class using it) in one go.
    const library = await db.query(
      `SELECT id FROM subject_library WHERE organization_id = $1 AND lower(btrim(name)) = $2 LIMIT 1`,
      [organizationId, normalizeName(subjectName)]
    );
    if (library.rows.length) {
      await renameLibrarySubject(db, organizationId, library.rows[0].id, newSubjectName);
      return res.json({ oldName: subjectName, newName: newSubjectName.trim(), classesAffected: existing.rows.length });
    }
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

// ============================================================
// Enrollment - /enrollment/manageEnrollment. Unlike the sections above,
// enrollment has no dedicated PERMISSIONS constant in the app today (the
// real routes only gate on isAuthenticated) - MANAGE_STUDENTS is reused
// here since enrollment is fundamentally about assigning students to
// classes for a term.
// An "enrollment" is one row per (organization, school year, term) that
// fans out into enrolled_classes/enrolled_students. The real "Modify
// Enrollment" form always deletes and fully re-inserts the whole
// class/student roster for an enrollment - there's no endpoint for
// incrementally adding/removing one student - so setEnrollmentRosterApi
// mirrors that exact full-replace behavior rather than inventing new
// incremental semantics.
// ============================================================

async function assertCanManageEnrollment(req) {
  return assertHasPermission(req, PERMISSIONS.MANAGE_STUDENTS, "You don't have permission to manage students/enrollment.");
}

async function resolveClassesByNames(organizationId, classNames) {
  const rows = await db.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1`, [organizationId]);
  const byName = new Map(rows.rows.map((r) => [normalizeName(r.class_name), r]));
  const resolved = [];
  const notFound = [];
  for (const name of classNames) {
    const row = byName.get(normalizeName(name));
    if (row) resolved.push(row);
    else notFound.push(name);
  }
  if (notFound.length) {
    const error = new Error(`Class${notFound.length === 1 ? "" : "es"} not found: ${notFound.join(", ")}.`);
    error.status = 404;
    throw error;
  }
  return resolved;
}

async function resolveStudentByName(organizationId, studentName) {
  const rows = await db.query(
    `SELECT student_id, first_name, last_name FROM students WHERE organization_id = $1 AND (first_name || ' ' || last_name) ILIKE $2`,
    [organizationId, `%${studentName}%`]
  );
  if (!rows.rows.length) {
    const error = new Error(`No student matching "${studentName}" was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one student matches "${studentName}"; be more specific (full name).`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

async function getTermContext(organizationId, termName, yearLabel) {
  const termId = await resolveTermId(organizationId, termName, yearLabel);
  const row = await db.query(
    `SELECT t.term_id, t.term_name, sy.id AS school_year_id, sy.year_label
     FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
     WHERE t.term_id = $1 AND t.organization_id = $2`,
    [termId, organizationId]
  );
  return row.rows[0];
}

async function getEnrollmentRow(organizationId, schoolYearId, termId) {
  const row = await db.query(
    `SELECT enrollment_id FROM enrollments WHERE organization_id = $1 AND school_year_id = $2 AND term_id = $3`,
    [organizationId, schoolYearId, termId]
  );
  return row.rows[0] || null;
}

async function loadEnrollmentRoster(enrollmentId) {
  if (!enrollmentId) return [];
  const classesRes = await db.query(
    `SELECT c.class_id, c.class_name
     FROM enrolled_classes ec JOIN classes c ON ec.class_id = c.class_id
     WHERE ec.enrollment_id = $1
     ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC`,
    [enrollmentId]
  );
  const classes = [];
  for (const cls of classesRes.rows) {
    const studentsRes = await db.query(
      `SELECT s.student_id, s.first_name, s.last_name
       FROM enrolled_students es JOIN students s ON es.student_id = s.student_id
       WHERE es.enrollment_id = $1 AND es.class_id = $2
       ORDER BY s.last_name, s.first_name`,
      [enrollmentId, cls.class_id]
    );
    classes.push({ classId: cls.class_id, className: cls.class_name, students: studentsRes.rows });
  }
  return classes;
}

// GET /internal/api/enrollment?organizationId=63
// Lists every enrollment (one per school year+term that has ever been
// opened) with class/student counts, so Mira can point at the right
// year/term before reading or changing its roster.
async function listEnrollmentsApi(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const result = await db.query(
      `SELECT e.enrollment_id, sy.year_label, sy.current AS is_current_year, t.term_name, t.current AS is_current_term,
              (SELECT COUNT(*) FROM enrolled_classes ec WHERE ec.enrollment_id = e.enrollment_id)::int AS class_count,
              (SELECT COUNT(*) FROM enrolled_students es WHERE es.enrollment_id = e.enrollment_id)::int AS student_count
       FROM enrollments e
       JOIN school_years sy ON e.school_year_id = sy.id
       JOIN terms t ON e.term_id = t.term_id
       WHERE e.organization_id = $1
       ORDER BY sy.current DESC, sy.year_label, t.term_name`,
      [organizationId]
    );
    return res.json({ enrollments: result.rows });
  } catch (error) {
    console.error("[internalApi/listEnrollmentsApi]", error);
    return res.status(500).json({ error: "Unable to load enrollments." });
  }
}

// GET /internal/api/enrollment/roster?organizationId=63&termName=...&yearLabel=...
async function getEnrollmentRosterApi(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });

    const term = await getTermContext(organizationId, req.query.termName, req.query.yearLabel);
    const enrollment = await getEnrollmentRow(organizationId, term.school_year_id, term.term_id);
    const classes = await loadEnrollmentRoster(enrollment?.enrollment_id);

    return res.json({
      yearLabel: term.year_label,
      termName: term.term_name,
      enrollmentExists: !!enrollment,
      classes,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getEnrollmentRosterApi]", error);
    return res.status(500).json({ error: "Unable to load the enrollment roster." });
  }
}

// POST /internal/api/enrollment/set
// { organizationId, ..., termName?, yearLabel?, roster: [{ className, studentNames: string[] }], confirm }
// The given roster is the FULL intended state for the term - any
// currently-enrolled class or student not mentioned is removed from this
// enrollment (their other records - attendance, scores, etc. - are
// untouched, since nothing else keys off enrollment_id). confirm
// omitted/false returns a diff preview instead of writing anything.
async function setEnrollmentRosterApi(req, res) {
  const client = await db.connect();
  try {
    const organizationId = await assertCanManageEnrollment(req);

    const rosterInput = Array.isArray(req.body?.roster) ? req.body.roster : [];
    if (!rosterInput.length) {
      return res.status(400).json({ error: "At least one class (with its student list, which may be empty) is required." });
    }
    const classNames = rosterInput.map((r) => String(r?.className || "").trim());
    if (classNames.some((n) => !n)) {
      return res.status(400).json({ error: "Every roster entry needs a className." });
    }
    const seen = new Set();
    const duplicateClass = classNames.find((n) => {
      const key = normalizeName(n);
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    if (duplicateClass) {
      return res.status(400).json({ error: `"${duplicateClass}" appears more than once in the roster - list each class once.` });
    }

    const term = await getTermContext(organizationId, req.body?.termName, req.body?.yearLabel);
    const resolvedClasses = await resolveClassesByNames(organizationId, classNames);
    const classByName = new Map(resolvedClasses.map((c) => [normalizeName(c.class_name), c]));

    // Resolve every distinct student name once.
    const allStudentNames = new Set();
    rosterInput.forEach((entry) => (Array.isArray(entry?.studentNames) ? entry.studentNames : []).forEach((n) => allStudentNames.add(String(n || "").trim())));
    allStudentNames.delete("");
    const studentByName = new Map();
    for (const name of allStudentNames) {
      studentByName.set(name, await resolveStudentByName(organizationId, name));
    }

    // Build the requested roster as classId -> [studentId], guarding
    // against the same student being listed under two different classes
    // in the same request (a student can only be in one class per
    // enrollment, same as the real form).
    const requestedByClassId = new Map();
    const studentToClassName = new Map();
    for (const entry of rosterInput) {
      const cls = classByName.get(normalizeName(entry.className));
      const names = Array.isArray(entry.studentNames) ? entry.studentNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
      const ids = [];
      for (const name of names) {
        const student = studentByName.get(name);
        if (studentToClassName.has(student.student_id) && studentToClassName.get(student.student_id) !== entry.className) {
          const error = new Error(
            `"${name}" is listed under more than one class (${studentToClassName.get(student.student_id)} and ${entry.className}) - a student can only be in one class per enrollment.`
          );
          error.status = 400;
          throw error;
        }
        studentToClassName.set(student.student_id, entry.className);
        ids.push(student.student_id);
      }
      requestedByClassId.set(cls.class_id, { className: cls.class_name, studentIds: ids });
    }

    // Diff against current state for the confirmation preview.
    const existingEnrollment = await getEnrollmentRow(organizationId, term.school_year_id, term.term_id);
    const currentClasses = await loadEnrollmentRoster(existingEnrollment?.enrollment_id);
    const currentStudentClass = new Map(); // studentId -> className
    const currentClassIds = new Set();
    const nameLookup = new Map();
    currentClasses.forEach((c) => {
      currentClassIds.add(c.classId);
      c.students.forEach((s) => {
        currentStudentClass.set(s.student_id, c.className);
        nameLookup.set(s.student_id, `${s.first_name} ${s.last_name}`);
      });
    });
    studentByName.forEach((s) => nameLookup.set(s.student_id, `${s.first_name} ${s.last_name}`));

    const requestedClassIds = new Set(requestedByClassId.keys());
    const classesAdded = resolvedClasses.filter((c) => !currentClassIds.has(c.class_id)).map((c) => c.class_name);
    const classesRemoved = currentClasses.filter((c) => !requestedClassIds.has(c.classId)).map((c) => c.className);

    const studentsAdded = [];
    const studentsMoved = [];
    for (const [studentId, className] of studentToClassName.entries()) {
      if (!currentStudentClass.has(studentId)) studentsAdded.push({ studentId, className });
      else if (currentStudentClass.get(studentId) !== className) studentsMoved.push({ studentId, from: currentStudentClass.get(studentId), to: className });
    }
    const studentsRemoved = [];
    currentStudentClass.forEach((className, studentId) => {
      if (!studentToClassName.has(studentId)) studentsRemoved.push({ studentId, className });
    });

    if (req.body?.confirm !== true) {
      const fmtName = (studentId) => nameLookup.get(studentId) || `#${studentId}`;
      return res.json({
        status: "confirmation_required",
        yearLabel: term.year_label,
        termName: term.term_name,
        classesAdded,
        classesRemoved,
        studentsAddedCount: studentsAdded.length,
        studentsRemovedCount: studentsRemoved.length,
        studentsMovedCount: studentsMoved.length,
        warning:
          `Setting the roster for ${term.year_label} - ${term.term_name}: ` +
          (classesAdded.length ? `opens class(es) ${classesAdded.join(", ")}; ` : "") +
          (classesRemoved.length ? `closes class(es) ${classesRemoved.join(", ")} (their currently-enrolled students will no longer be assigned a class this term); ` : "") +
          (studentsAdded.length ? `adds ${studentsAdded.length} student(s) [${studentsAdded.map((s) => fmtName(s.studentId)).join(", ")}]; ` : "") +
          (studentsRemoved.length ? `removes ${studentsRemoved.length} student(s) [${studentsRemoved.map((s) => fmtName(s.studentId)).join(", ")}] from this term's enrollment; ` : "") +
          (studentsMoved.length ? `moves ${studentsMoved.length} student(s) [${studentsMoved.map((s) => `${fmtName(s.studentId)}: ${s.from} -> ${s.to}`).join(", ")}]; ` : "") +
          (!classesAdded.length && !classesRemoved.length && !studentsAdded.length && !studentsRemoved.length && !studentsMoved.length ? "no changes; " : "") +
          `nothing else (attendance, scores, etc.) is affected. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    await client.query("BEGIN");
    let enrollmentId = existingEnrollment?.enrollment_id;
    if (!enrollmentId) {
      const inserted = await client.query(
        `INSERT INTO enrollments (school_year_id, term_id, organization_id, created_at) VALUES ($1, $2, $3, NOW()) RETURNING enrollment_id`,
        [term.school_year_id, term.term_id, organizationId]
      );
      enrollmentId = inserted.rows[0].enrollment_id;
    }
    await client.query(`DELETE FROM enrolled_students WHERE enrollment_id = $1`, [enrollmentId]);
    await client.query(`DELETE FROM enrolled_classes WHERE enrollment_id = $1`, [enrollmentId]);

    for (const classId of requestedByClassId.keys()) {
      await client.query(`INSERT INTO enrolled_classes (enrollment_id, class_id) VALUES ($1, $2)`, [enrollmentId, classId]);
    }
    for (const [classId, { studentIds }] of requestedByClassId) {
      for (const studentId of studentIds) {
        await client.query(`INSERT INTO enrolled_students (enrollment_id, student_id, class_id) VALUES ($1, $2, $3)`, [enrollmentId, studentId, classId]);
      }
    }
    await client.query("COMMIT");

    if (studentsAdded.length) {
      const addedClassIds = [
        ...new Set(
          studentsAdded
            .map((s) => {
              for (const [classId, v] of requestedByClassId) if (v.studentIds.includes(s.studentId)) return classId;
              return null;
            })
            .filter(Boolean)
        ),
      ];
      if (addedClassIds.length) {
        notifSvc
          .notifyPerClassTeachers(db, {
            orgId: organizationId,
            classIds: addedClassIds,
            type: "enrollment_added",
            title: "Students enrolled in your class",
            body: "New students have been added.",
            linkTemplate: "/common/classDashboard?classId={classId}",
          })
          .catch((err) => console.error("[Notif] enrollment_added failed:", err.message));
      }
    }

    return res.json({
      enrollmentId,
      yearLabel: term.year_label,
      termName: term.term_name,
      classCount: requestedByClassId.size,
      studentCount: studentToClassName.size,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setEnrollmentRosterApi]", error);
    return res.status(500).json({ error: "Unable to set the enrollment roster." });
  } finally {
    client.release();
  }
}

// POST /internal/api/enrollment/delete
// { organizationId, ..., termName?, yearLabel?, confirm }
async function deleteEnrollmentApi(req, res) {
  const client = await db.connect();
  try {
    const organizationId = await assertCanManageEnrollment(req);
    const term = await getTermContext(organizationId, req.body?.termName, req.body?.yearLabel);
    const enrollment = await getEnrollmentRow(organizationId, term.school_year_id, term.term_id);
    if (!enrollment) {
      return res.status(404).json({ error: `No enrollment exists for ${term.year_label} - ${term.term_name}.` });
    }

    const counts = await db.query(
      `SELECT (SELECT COUNT(*) FROM enrolled_classes WHERE enrollment_id = $1)::int AS class_count,
              (SELECT COUNT(*) FROM enrolled_students WHERE enrollment_id = $1)::int AS student_count`,
      [enrollment.enrollment_id]
    );
    const { class_count: classCount, student_count: studentCount } = counts.rows[0];

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        yearLabel: term.year_label,
        termName: term.term_name,
        classCount,
        studentCount,
        warning:
          `Deleting the enrollment for ${term.year_label} - ${term.term_name} is permanent. ` +
          `It has ${classCount} class(es) and ${studentCount} student assignment(s) open for this term - all of them will be removed. ` +
          `Attendance, scores, and other records are unaffected (they don't depend on enrollment). ` +
          `Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    await client.query("BEGIN");
    await client.query(`DELETE FROM enrolled_students WHERE enrollment_id = $1`, [enrollment.enrollment_id]);
    await client.query(`DELETE FROM enrolled_classes WHERE enrollment_id = $1`, [enrollment.enrollment_id]);
    await client.query(`DELETE FROM enrollments WHERE enrollment_id = $1 AND organization_id = $2`, [enrollment.enrollment_id, organizationId]);
    await client.query("COMMIT");

    return res.json({ yearLabel: term.year_label, termName: term.term_name, classCount, studentCount });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteEnrollmentApi]", error);
    return res.status(500).json({ error: "Unable to delete the enrollment." });
  } finally {
    client.release();
  }
}

// ============================================================
// Promotion - /promotion/apply. Bulk-creates next-term class/subject
// enrollment for every student a class's report generation already marked
// Promoted/Repeated with a destination class - it never touches
// students.class_id or graduation, and every write it makes is logged to
// promotion_schedule_audit so it can be reversed. The real page's
// permission gate (APPROVE_PROMOTIONS - the enum's MANAGE_PROMOTIONS key
// exists but no route actually checks it) covers reading AND writing, so
// every endpoint here checks it, including the two read/preview ones.
// Every write delegates to the real controller's own handler
// (schedulePromotion, applyNow, cancelScheduledPromotion,
// reverseAppliedPromotion, deleteReversedPromotion) via a fake req/res
// that captures its flash-message outcome, rather than re-implementing
// the audit-trail/retry-policy logic those functions depend on - this
// file stays a thin translation layer per its own header comment. A
// schedule is identified by its (source term/year, target term/year) pair,
// the same way a user would describe it, rather than by scheduleId.
// ============================================================

async function assertCanApprovePromotions(req) {
  return assertHasPermission(req, PERMISSIONS.APPROVE_PROMOTIONS, "You don't have permission to manage promotions.");
}
async function assertCanApprovePromotionsQuery(req) {
  return assertHasPermissionQuery(req, PERMISSIONS.APPROVE_PROMOTIONS, "You don't have permission to manage promotions.");
}

function makeFlashCapture() {
  const flashes = [];
  return {
    flash(type, msg) {
      if (msg === undefined) return [];
      flashes.push({ type: String(type || ""), msg: String(msg || "") });
      return [];
    },
    errorEntry: () => flashes.find((f) => f.type.toLowerCase().includes("error")),
    successEntry: () => flashes.find((f) => !f.type.toLowerCase().includes("error")),
  };
}

// Calls one of promotionController's own exported handlers (which only
// know how to redirect + flash a message, never JSON) through a fake
// req/res, and turns its flash outcome into a thrown error or a message
// string - so the write logic (audit rows, retry policy, notifications)
// lives in exactly one place.
async function delegateToPromotionController(controllerFn, organizationId, body) {
  const capture = makeFlashCapture();
  const fakeReq = { session: { organizationId }, body, query: {}, flash: capture.flash };
  const fakeRes = {
    redirect() {},
    status() { return this; },
    json() { return this; },
  };
  await controllerFn(fakeReq, fakeRes);
  const error = capture.errorEntry();
  if (error) {
    const err = new Error(error.msg);
    err.status = 409;
    throw err;
  }
  return capture.successEntry()?.msg || "Done.";
}

// Resolves an existing promotion_schedule row by its (source, target)
// term/year pair rather than a raw scheduleId. allowedStatuses, when
// given, rejects with a clear "wrong state" error instead of acting on a
// schedule in a state the caller didn't expect (e.g. canceling something
// already applied).
async function resolvePromotionSchedule(organizationId, { sourceTermName, sourceYearLabel, targetTermName, targetYearLabel } = {}, allowedStatuses) {
  if (!targetTermName) {
    const error = new Error("targetTermName is required to identify a promotion schedule.");
    error.status = 400;
    throw error;
  }
  const source = await getTermContext(organizationId, sourceTermName, sourceYearLabel);
  const target = await getTermContext(organizationId, targetTermName, targetYearLabel);

  const rows = await db.query(
    `SELECT * FROM promotion_schedule
     WHERE organization_id = $1 AND current_term_id = $2 AND current_school_year_id = $3
       AND target_term_id = $4 AND target_school_year_id = $5
     ORDER BY id DESC LIMIT 1`,
    [organizationId, source.term_id, source.school_year_id, target.term_id, target.school_year_id]
  );
  if (!rows.rows.length) {
    const error = new Error(`No promotion schedule found from ${source.year_label} - ${source.term_name} to ${target.year_label} - ${target.term_name}.`);
    error.status = 404;
    throw error;
  }
  const schedule = rows.rows[0];
  if (allowedStatuses && !allowedStatuses.includes(schedule.status)) {
    const error = new Error(
      `This promotion schedule (${source.year_label} - ${source.term_name} → ${target.year_label} - ${target.term_name}) is currently "${schedule.status}", not "${allowedStatuses.join('" or "')}".`
    );
    error.status = 409;
    throw error;
  }
  return { schedule, source, target };
}

async function getActivatePromotionMap(organizationId, termId, classIds) {
  if (!classIds.length) return new Map();
  const rows = await db.query(
    `SELECT class_id, activate_promotion FROM status_settings WHERE organization_id = $1 AND term_id = $2 AND class_id = ANY($3::int[])`,
    [organizationId, termId, classIds]
  );
  return new Map(rows.rows.map((r) => [Number(r.class_id), r.activate_promotion === true]));
}

// GET /internal/api/promotion/schedules?organizationId&userId&userRole&accountType&userEmail
async function listPromotionSchedulesApi(req, res) {
  try {
    const organizationId = await assertCanApprovePromotionsQuery(req);

    // LEFT JOINs, not INNER - promotion_schedule has no FK constraints on
    // its term/year columns (confirmed: this org has a real row whose
    // target term was deleted after the fact), so an INNER JOIN would
    // silently drop real history instead of just showing it with a
    // "deleted" placeholder.
    const rows = await db.query(
      `SELECT ps.id, ps.status, ps.scheduled_date, ps.created_at,
              COALESCE(sy1.year_label, '(deleted year)') AS source_year_label,
              COALESCE(t1.term_name, '(deleted term)') AS source_term_name,
              COALESCE(sy2.year_label, '(deleted year)') AS target_year_label,
              COALESCE(t2.term_name, '(deleted term)') AS target_term_name,
              EXISTS (SELECT 1 FROM promotion_schedule_audit psa WHERE psa.schedule_id = ps.id) AS has_audit
       FROM promotion_schedule ps
       LEFT JOIN terms t1 ON t1.term_id = ps.current_term_id
       LEFT JOIN school_years sy1 ON sy1.id = ps.current_school_year_id
       LEFT JOIN terms t2 ON t2.term_id = ps.target_term_id
       LEFT JOIN school_years sy2 ON sy2.id = ps.target_school_year_id
       WHERE ps.organization_id = $1
       ORDER BY ps.scheduled_date DESC, ps.id DESC`,
      [organizationId]
    );

    const schedules = await Promise.all(
      rows.rows.map(async (row) => {
        const classesRes = await db.query(
          `SELECT c.class_name FROM promotion_schedule_classes psc JOIN classes c ON c.class_id = psc.class_id WHERE psc.schedule_id = $1`,
          [row.id]
        );
        const daysSinceScheduled = (Date.now() - new Date(row.scheduled_date).getTime()) / (24 * 60 * 60 * 1000);
        return {
          status: row.status,
          scheduledDate: row.scheduled_date,
          sourceYearLabel: row.source_year_label,
          sourceTermName: row.source_term_name,
          targetYearLabel: row.target_year_label,
          targetTermName: row.target_term_name,
          classNames: classesRes.rows.map((r) => r.class_name),
          canReverse: row.status === "completed" && row.has_audit && daysSinceScheduled <= 15,
        };
      })
    );

    return res.json({ schedules });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listPromotionSchedulesApi]", error);
    return res.status(500).json({ error: "Unable to load promotion schedules." });
  }
}

// GET /internal/api/promotion/preview?organizationId&...&termName&yearLabel&classNames=A,B
async function getPromotionPreviewApi(req, res) {
  try {
    const organizationId = await assertCanApprovePromotionsQuery(req);

    const classNames = String(req.query.classNames || "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (!classNames.length) return res.status(400).json({ error: "At least one className is required." });

    const term = await getTermContext(organizationId, req.query.termName, req.query.yearLabel);
    const resolvedClasses = await resolveClassesByNames(organizationId, classNames);
    const classIds = resolvedClasses.map((c) => c.class_id);

    const fakeReq = { session: { organizationId }, query: { termId: term.term_id, classIds } };
    let payload = null;
    const fakeRes = {
      json(body) { payload = body; return this; },
      status() { return this; },
    };
    await promotionController.getPromotionPreview(fakeReq, fakeRes);

    const activateMap = await getActivatePromotionMap(organizationId, term.term_id, classIds);
    const classes = (payload?.classes || []).map((c) => ({
      ...c,
      promotionActivated: activateMap.get(Number(c.classId)) === true,
    }));

    return res.json({ yearLabel: term.year_label, termName: term.term_name, classes });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getPromotionPreviewApi]", error);
    return res.status(500).json({ error: "Unable to load the promotion preview." });
  }
}

// POST /internal/api/promotion/schedule
// { organizationId, ..., sourceTermName?, sourceYearLabel?, targetTermName,
//   targetYearLabel?, classNames: string[], applyMode: "now"|"schedule",
//   scheduledDate? (required if applyMode="schedule"), confirm }
async function schedulePromotionApi(req, res) {
  try {
    const organizationId = await assertCanApprovePromotions(req);

    const classNames = Array.isArray(req.body?.classNames) ? req.body.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    if (!classNames.length) return res.status(400).json({ error: "At least one className is required." });
    const targetTermName = String(req.body?.targetTermName || "").trim();
    if (!targetTermName) return res.status(400).json({ error: 'targetTermName is required (the term students will be promoted into).' });
    const applyMode = req.body?.applyMode === "now" ? "now" : "schedule";
    if (applyMode === "schedule" && !req.body?.scheduledDate) {
      return res.status(400).json({ error: 'scheduledDate is required when applyMode is "schedule".' });
    }

    const source = await getTermContext(organizationId, req.body?.sourceTermName, req.body?.sourceYearLabel);
    const target = await getTermContext(organizationId, targetTermName, req.body?.targetYearLabel);
    if (target.term_id === source.term_id) {
      return res.status(400).json({ error: "Target term must be different from the source term." });
    }
    const resolvedClasses = await resolveClassesByNames(organizationId, classNames);
    const classIds = resolvedClasses.map((c) => c.class_id);

    // Duplicate check - mirrors schedulePromotion's own guard, checked
    // here too so the confirm=false preview can explain it instead of the
    // user only finding out after confirming.
    const existing = await db.query(
      `SELECT status FROM promotion_schedule
       WHERE organization_id = $1 AND current_term_id = $2 AND current_school_year_id = $3
         AND target_term_id = $4 AND target_school_year_id = $5 AND status IN ('scheduled','completed')
       ORDER BY id DESC LIMIT 1`,
      [organizationId, source.term_id, source.school_year_id, target.term_id, target.school_year_id]
    );
    if (existing.rows.length) {
      const status = existing.rows[0].status;
      return res.status(409).json({
        error: `This promotion (${source.year_label} - ${source.term_name} → ${target.year_label} - ${target.term_name}) is already ${status === "completed" ? "applied" : "scheduled"}.`,
      });
    }

    // Eligibility + activate_promotion gate, per selected class - the real
    // apply step silently skips any class without activate_promotion on,
    // so that needs to be surfaced up front rather than discovered after.
    const eligibleResult = await db.query(
      `SELECT sr.class_id, COUNT(*)::int AS eligible_count
       FROM student_reports sr
       JOIN students s ON s.student_id = sr.student_id AND s.organization_id = sr.organization_id AND COALESCE(s.graduated, FALSE) = FALSE
       WHERE sr.organization_id = $1 AND sr.term_id = $2 AND sr.class_id = ANY($3::int[])
         AND sr.promotion_status IN ('Promoted', 'Repeated') AND sr.promotion_class_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM enrollments e JOIN enrolled_students es ON es.enrollment_id = e.enrollment_id AND es.student_id = sr.student_id AND es.class_id = sr.class_id
           WHERE e.organization_id = sr.organization_id AND e.term_id = sr.term_id
         )
       GROUP BY sr.class_id`,
      [organizationId, source.term_id, classIds]
    );
    const eligibleByClass = new Map(eligibleResult.rows.map((r) => [Number(r.class_id), r.eligible_count]));
    const activateMap = await getActivatePromotionMap(organizationId, source.term_id, classIds);

    const skippedNoActivation = resolvedClasses.filter((c) => activateMap.get(c.class_id) !== true).map((c) => c.class_name);
    const totalEligible = [...eligibleByClass.values()].reduce((a, b) => a + b, 0);
    const perClassSummary = resolvedClasses.map(
      (c) => `${c.class_name}: ${eligibleByClass.get(c.class_id) || 0} eligible${activateMap.get(c.class_id) !== true ? " (promotion not activated for this class - will be skipped)" : ""}`
    );

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        sourceYearLabel: source.year_label,
        sourceTermName: source.term_name,
        targetYearLabel: target.year_label,
        targetTermName: target.term_name,
        applyMode,
        scheduledDate: applyMode === "schedule" ? req.body?.scheduledDate : null,
        classSummary: perClassSummary,
        totalEligible,
        classesSkippedNoActivation: skippedNoActivation,
        warning:
          (totalEligible === 0
            ? `No students are currently eligible for promotion in the selected class(es) - nothing would happen. `
            : `Promoting from ${source.year_label} - ${source.term_name} to ${target.year_label} - ${target.term_name} would enroll up to ${totalEligible} student(s) into their new classes for the target term (${perClassSummary.join("; ")}). `) +
          (skippedNoActivation.length ? `Promotion is NOT activated for: ${skippedNoActivation.join(", ")} - those classes will be skipped entirely. ` : "") +
          (applyMode === "now" ? `This runs IMMEDIATELY. ` : `This is scheduled to run automatically on ${req.body?.scheduledDate}. `) +
          `This only adds new-term class/subject assignments - it never touches a student's current class or graduation status, and can be reversed within 15 days of running (if nothing else has changed since). ` +
          `Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    if (totalEligible === 0) {
      return res.status(409).json({ error: "No students are eligible for promotion in the selected class(es)." });
    }

    const message = await delegateToPromotionController(promotionController.schedulePromotion, organizationId, {
      fromSchoolYearId: source.school_year_id,
      fromTermId: source.term_id,
      targetYearId: target.school_year_id,
      targetTermId: target.term_id,
      scheduledDate: applyMode === "schedule" ? req.body?.scheduledDate : undefined,
      classIds,
      applyMode: applyMode === "now" ? "applyNow" : "scheduleLater",
    });

    const created = await db.query(
      `SELECT id, status FROM promotion_schedule
       WHERE organization_id = $1 AND current_term_id = $2 AND current_school_year_id = $3
         AND target_term_id = $4 AND target_school_year_id = $5
       ORDER BY id DESC LIMIT 1`,
      [organizationId, source.term_id, source.school_year_id, target.term_id, target.school_year_id]
    );
    const scheduleId = created.rows[0]?.id;
    const status = created.rows[0]?.status;
    let enrolledCount = null;
    if (scheduleId && status === "completed") {
      const cnt = await db.query(`SELECT COUNT(*)::int AS c FROM promotion_schedule_audit WHERE schedule_id = $1 AND action_type = 'student_enrolled'`, [scheduleId]);
      enrolledCount = cnt.rows[0]?.c ?? null;
    }

    return res.json({
      sourceYearLabel: source.year_label,
      sourceTermName: source.term_name,
      targetYearLabel: target.year_label,
      targetTermName: target.term_name,
      status,
      enrolledCount,
      message,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/schedulePromotionApi]", error);
    return res.status(500).json({ error: "Unable to schedule the promotion." });
  }
}

// POST /internal/api/promotion/apply-now
// { organizationId, ..., sourceTermName?, sourceYearLabel?, targetTermName, targetYearLabel?, confirm }
async function applyScheduledPromotionApi(req, res) {
  try {
    const organizationId = await assertCanApprovePromotions(req);
    const { schedule, source, target } = await resolvePromotionSchedule(organizationId, req.body, ["scheduled"]);

    if (req.body?.confirm !== true) {
      const classesRes = await db.query(
        `SELECT c.class_name FROM promotion_schedule_classes psc JOIN classes c ON c.class_id = psc.class_id WHERE psc.schedule_id = $1`,
        [schedule.id]
      );
      return res.json({
        status: "confirmation_required",
        sourceYearLabel: source.year_label,
        sourceTermName: source.term_name,
        targetYearLabel: target.year_label,
        targetTermName: target.term_name,
        classNames: classesRes.rows.map((r) => r.class_name),
        originallyScheduledFor: schedule.scheduled_date,
        warning: `Applying this promotion now runs it immediately instead of waiting for its scheduled date (${new Date(schedule.scheduled_date).toDateString()}) - it enrolls eligible students into ${target.year_label} - ${target.term_name} right away. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const message = await delegateToPromotionController(promotionController.applyNow, organizationId, { scheduleId: schedule.id });

    const updated = await db.query(`SELECT status FROM promotion_schedule WHERE id = $1`, [schedule.id]);
    let enrolledCount = null;
    if (updated.rows[0]?.status === "completed") {
      const cnt = await db.query(`SELECT COUNT(*)::int AS c FROM promotion_schedule_audit WHERE schedule_id = $1 AND action_type = 'student_enrolled'`, [schedule.id]);
      enrolledCount = cnt.rows[0]?.c ?? null;
    }

    return res.json({
      sourceYearLabel: source.year_label,
      sourceTermName: source.term_name,
      targetYearLabel: target.year_label,
      targetTermName: target.term_name,
      status: updated.rows[0]?.status,
      enrolledCount,
      message,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/applyScheduledPromotionApi]", error);
    return res.status(500).json({ error: "Unable to apply the promotion." });
  }
}

// POST /internal/api/promotion/cancel
// { organizationId, ..., sourceTermName?, sourceYearLabel?, targetTermName, targetYearLabel?, confirm }
async function cancelScheduledPromotionApi(req, res) {
  try {
    const organizationId = await assertCanApprovePromotions(req);
    // cancelScheduledPromotion itself deletes regardless of status - guard
    // here so this can only cancel a not-yet-applied schedule, never
    // silently delete the history of a completed/reversed one.
    const { schedule, source, target } = await resolvePromotionSchedule(organizationId, req.body, ["scheduled"]);

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        sourceYearLabel: source.year_label,
        sourceTermName: source.term_name,
        targetYearLabel: target.year_label,
        targetTermName: target.term_name,
        scheduledDate: schedule.scheduled_date,
        warning: `Canceling removes this scheduled promotion (${source.year_label} - ${source.term_name} → ${target.year_label} - ${target.term_name}, due ${new Date(schedule.scheduled_date).toDateString()}) - it will not run. Nothing has been applied yet, so there's nothing to undo. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const message = await delegateToPromotionController(promotionController.cancelScheduledPromotion, organizationId, { scheduleId: schedule.id });
    return res.json({
      sourceYearLabel: source.year_label,
      sourceTermName: source.term_name,
      targetYearLabel: target.year_label,
      targetTermName: target.term_name,
      message,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/cancelScheduledPromotionApi]", error);
    return res.status(500).json({ error: "Unable to cancel the promotion." });
  }
}

// POST /internal/api/promotion/reverse
// { organizationId, ..., sourceTermName?, sourceYearLabel?, targetTermName, targetYearLabel?, confirm }
async function reverseAppliedPromotionApi(req, res) {
  try {
    const organizationId = await assertCanApprovePromotions(req);
    const { schedule, source, target } = await resolvePromotionSchedule(organizationId, req.body, ["completed"]);

    const auditCount = await db.query(`SELECT COUNT(*)::int AS c FROM promotion_schedule_audit WHERE schedule_id = $1`, [schedule.id]);
    if (!auditCount.rows[0]?.c) {
      return res.status(409).json({ error: "This promotion has no recorded action audit (an older record) - it can't be reversed automatically. Correct it manually from Manage Records." });
    }
    // The 15-day reverse window is a UI-only rule today (the backend
    // endpoint itself doesn't enforce it) - Mira bypasses the UI entirely,
    // so it enforces the same limit itself rather than being more
    // permissive than what a user going through the real page could do.
    const daysSince = (Date.now() - new Date(schedule.scheduled_date).getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince > 15) {
      return res.status(409).json({ error: `This promotion was applied ${Math.floor(daysSince)} days ago - reversal is only available within 15 days, same as the Promotion page.` });
    }

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        sourceYearLabel: source.year_label,
        sourceTermName: source.term_name,
        targetYearLabel: target.year_label,
        targetTermName: target.term_name,
        warning: `Reversing undoes this promotion (${source.year_label} - ${source.term_name} → ${target.year_label} - ${target.term_name}) exactly where safe to do so - it removes the class/subject enrollments it created for the target term (any enrollments/classes now unused are cleaned up too). This does NOT undo anything a human has since changed by hand on top of it. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const message = await delegateToPromotionController(promotionController.reverseAppliedPromotion, organizationId, { scheduleId: schedule.id });
    return res.json({
      sourceYearLabel: source.year_label,
      sourceTermName: source.term_name,
      targetYearLabel: target.year_label,
      targetTermName: target.term_name,
      message,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/reverseAppliedPromotionApi]", error);
    return res.status(500).json({ error: "Unable to reverse the promotion." });
  }
}

// POST /internal/api/promotion/delete-reversed
// { organizationId, ..., sourceTermName?, sourceYearLabel?, targetTermName, targetYearLabel?, confirm }
async function deleteReversedPromotionApi(req, res) {
  try {
    const organizationId = await assertCanApprovePromotions(req);
    const { schedule, source, target } = await resolvePromotionSchedule(organizationId, req.body, ["reversed"]);

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        sourceYearLabel: source.year_label,
        sourceTermName: source.term_name,
        targetYearLabel: target.year_label,
        targetTermName: target.term_name,
        warning: `Deleting removes this reversed promotion's history entry (${source.year_label} - ${source.term_name} → ${target.year_label} - ${target.term_name}) permanently - it was already undone by the reversal, so this only clears the record; nothing live changes. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const message = await delegateToPromotionController(promotionController.deleteReversedPromotion, organizationId, { scheduleId: schedule.id });
    return res.json({
      sourceYearLabel: source.year_label,
      sourceTermName: source.term_name,
      targetYearLabel: target.year_label,
      targetTermName: target.term_name,
      message,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteReversedPromotionApi]", error);
    return res.status(500).json({ error: "Unable to delete the reversed promotion." });
  }
}

// ============================================================
// Employees - /common/manageEmployees. Directly controls who can log in and
// what they can do, so this is more conservative than every section above:
// only list/create/hold-or-resume are exposed (per product decision) -
// modifying an existing employee's role/permissions/classes and deleting an
// employee stay manual-UI-only. Every write delegates to the real
// commonController handler (createEmployeePost, toggleHoldEmployee) via a
// fake req/res + flash capture, so the real safety logic (duplicate-email
// check, high-risk-permission filtering, Driver-only-manage_students,
// Manager-account-requires-manager-requestor) is the actual authority, not
// a re-implementation. The 15-day-reverse-style extra guard here: Mira
// refuses to put the CALLING user's own account on hold - the real
// toggleHoldEmployee endpoint has no such protection at all, and Mira
// bypassing the UI shouldn't be able to lock the caller out of their own
// session by accident.
// ============================================================

const EMPLOYEE_HIGH_RISK_PERMISSIONS = new Set([
  PERMISSIONS.MANAGE_EMPLOYEES,
  PERMISSIONS.MANAGE_SETTINGS,
  PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS,
  PERMISSIONS.APPROVE_PROMOTIONS,
  PERMISSIONS.MANAGE_BILLING,
]);
const VALID_PERMISSION_KEYS = new Set(PERMISSION_OPTIONS.map((o) => o.key));
const VALID_EMPLOYEE_ROLES = new Set(["Manager", "Supervisor", "Teacher", "Driver"]);

async function assertCanManageEmployees(req) {
  return assertHasPermission(req, PERMISSIONS.MANAGE_EMPLOYEES, "You don't have permission to manage employees.");
}
async function assertCanManageEmployeesQuery(req) {
  return assertHasPermissionQuery(req, PERMISSIONS.MANAGE_EMPLOYEES, "You don't have permission to manage employees.");
}

function publicBaseUrlParts() {
  const base = process.env.BASE_URL_PRODUCTION || process.env.BASE_URL_PRODUCTION_FALLBACK || "https://managira.com";
  try {
    const u = new URL(base);
    return { protocol: u.protocol.replace(":", ""), host: u.host };
  } catch {
    return { protocol: "https", host: "managira.com" };
  }
}

async function resolveEmployeeByIdentifier(organizationId, { email, name } = {}) {
  const trimmedEmail = String(email || "").trim();
  if (trimmedEmail) {
    const rows = await db.query(
      `SELECT user_id, first_name, last_name, email, account_type, on_hold FROM users WHERE organization_id = $1 AND LOWER(email) = LOWER($2)`,
      [organizationId, trimmedEmail]
    );
    if (!rows.rows.length) {
      const error = new Error(`No employee with email "${trimmedEmail}" was found in this organization.`);
      error.status = 404;
      throw error;
    }
    return rows.rows[0];
  }
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    const error = new Error("An employee email or name is required.");
    error.status = 400;
    throw error;
  }
  const rows = await db.query(
    `SELECT user_id, first_name, last_name, email, account_type, on_hold FROM users WHERE organization_id = $1 AND (first_name || ' ' || last_name) ILIKE $2`,
    [organizationId, `%${trimmedName}%`]
  );
  if (!rows.rows.length) {
    const error = new Error(`No employee matching "${trimmedName}" was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one employee matches "${trimmedName}" - use their exact email instead.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

// GET /internal/api/employees?organizationId&userId&userRole&accountType&userEmail
async function listEmployeesApi(req, res) {
  try {
    const organizationId = await assertCanManageEmployeesQuery(req);

    const rows = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.account_type, u.on_hold, u.password,
              array_agg(DISTINCT c.class_name) FILTER (WHERE c.class_name IS NOT NULL) AS class_names
       FROM users u
       LEFT JOIN user_classes uc ON uc.user_id = u.user_id
       LEFT JOIN classes c ON c.class_id = uc.class_id
       WHERE u.organization_id = $1
       GROUP BY u.user_id
       ORDER BY u.last_name, u.first_name`,
      [organizationId]
    );

    const permsRes = await db.query(`SELECT user_id, permission_key FROM user_permissions WHERE organization_id = $1 AND permission_key != $2`, [
      organizationId,
      MAILROOM_ALL_ACCESS_KEY,
    ]);
    const permsByUser = new Map();
    permsRes.rows.forEach((r) => {
      if (!permsByUser.has(r.user_id)) permsByUser.set(r.user_id, []);
      permsByUser.get(r.user_id).push(r.permission_key);
    });

    const employees = rows.rows.map((r) => ({
      name: `${r.first_name} ${r.last_name}`,
      email: r.email,
      role: r.account_type,
      onHold: r.on_hold === true,
      pendingSetup: !r.password,
      classNames: r.class_names || [],
      permissions: permsByUser.get(r.user_id) || [],
    }));

    return res.json({ employees });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listEmployeesApi]", error);
    return res.status(500).json({ error: "Unable to load employees." });
  }
}

// POST /internal/api/employees/create
// { organizationId, userId, userRole, accountType, userEmail, organizationName?,
//   firstName, lastName, email, role, dateOfBirth?, classNames?: string[],
//   permissions?: string[], confirm }
async function createEmployeeApi(req, res) {
  try {
    const organizationId = await assertCanManageEmployees(req);

    const firstName = String(req.body?.firstName || "").trim();
    const lastName = String(req.body?.lastName || "").trim();
    const email = String(req.body?.email || "").trim();
    const role = String(req.body?.role || "").trim();
    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ error: "firstName, lastName, email, and role are required." });
    }
    if (!VALID_EMPLOYEE_ROLES.has(role)) {
      return res.status(400).json({ error: `role must be one of: ${[...VALID_EMPLOYEE_ROLES].join(", ")}.` });
    }

    const classNames = Array.isArray(req.body?.classNames) ? req.body.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    const resolvedClasses = classNames.length ? await resolveClassesByNames(organizationId, classNames) : [];
    const classIds = resolvedClasses.map((c) => c.class_id);

    // Validate against the raw input BEFORE normalizePermissionsList, which
    // silently drops anything not in its own valid-key set - checking the
    // already-normalized list here would never catch a bad key at all, it
    // would just vanish with no error and no warning to the caller.
    const rawPermissions = Array.isArray(req.body?.permissions) ? req.body.permissions : req.body?.permissions ? [req.body.permissions] : [];
    const invalidPermissions = rawPermissions.map((p) => String(p || "").trim()).filter((p) => p && !VALID_PERMISSION_KEYS.has(p));
    if (invalidPermissions.length) {
      return res.status(400).json({ error: `Unknown permission key(s): ${invalidPermissions.join(", ")}.` });
    }
    const requestedPermissions = normalizePermissionsList(req.body?.permissions);

    // Same safety rules the real create-employee form enforces, re-derived
    // here ONLY to build an accurate confirm=false preview - the delegated
    // call below runs the real, authoritative copy of this same logic
    // itself, so a divergence here can only make the preview's wording
    // wrong, never actually bypass anything.
    const requestorRole = req.body?.userRole;
    const canAssignSensitivePermissions = isManagerLikeRole(requestorRole) || String(requestorRole || "").trim() === "Manager";
    if (role === "Manager" && !canAssignSensitivePermissions) {
      // 422, not 403 - the caller DOES have Manage Employees (that's
      // already been checked above); this is a separate business rule, and
      // callWriteApi (mira/tools/_writeAuth.js) treats every 403 as "you
      // lack the permission", which would mislabel this.
      const error = new Error("Only managers can create Manager accounts.");
      error.status = 422;
      throw error;
    }
    let predictedPermissions = canAssignSensitivePermissions ? requestedPermissions : requestedPermissions.filter((p) => !EMPLOYEE_HIGH_RISK_PERMISSIONS.has(p));
    if (role === "Driver") {
      predictedPermissions = predictedPermissions.filter((p) => p === PERMISSIONS.MANAGE_STUDENTS);
    }
    const strippedPermissions = requestedPermissions.filter((p) => !predictedPermissions.includes(p));

    // Duplicate-email check - platform-wide, matching the real unique
    // constraint on users.email / organizations.email.
    const dup = await db.query(`SELECT email FROM users WHERE LOWER(email) = LOWER($1) UNION SELECT email FROM organizations WHERE LOWER(email) = LOWER($1)`, [email]);
    if (dup.rows.length) {
      return res.status(409).json({ error: "This email is already in use by another user or organization." });
    }

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        firstName,
        lastName,
        email,
        role,
        classNames: resolvedClasses.map((c) => c.class_name),
        grantedPermissions: predictedPermissions,
        strippedPermissions,
        warning:
          `Creating "${firstName} ${lastName}" (${email}) as a ${role}` +
          (resolvedClasses.length ? ` assigned to ${resolvedClasses.map((c) => c.class_name).join(", ")}` : "") +
          `. They'll be sent a real email invite to set their own password and log in. ` +
          (predictedPermissions.length ? `Permissions granted: ${predictedPermissions.join(", ")}. ` : "No extra permissions granted. ") +
          (strippedPermissions.length
            ? `NOTE: ${strippedPermissions.join(", ")} requested but NOT granted - the requesting user doesn't have manager-level access to assign high-risk permissions. `
            : "") +
          `Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const { protocol, host } = publicBaseUrlParts();
    const fakeReq = {
      session: {
        organizationId,
        userRole: req.body?.userRole,
        organizationName: req.body?.organizationName || null,
        user: { user_id: req.body?.userId },
        userId: req.body?.userId,
      },
      body: {
        firstName,
        lastName,
        email,
        account_type: role,
        dateOfBirth: req.body?.dateOfBirth || null,
        classes: classIds,
        subjects: [],
        permissions: requestedPermissions,
        mailroomScope: "all",
        mailroomClassIds: [],
      },
      protocol,
      get(header) {
        return header === "host" ? host : undefined;
      },
      flash: capture.flash,
    };
    const fakeRes = {
      redirect() {},
      status() { return this; },
      json() { return this; },
    };
    await commonController.createEmployeePost(fakeReq, fakeRes, db);

    const error = capture.errorEntry();
    if (error) {
      return res.status(409).json({ error: error.msg });
    }

    const created = await db.query(`SELECT user_id FROM users WHERE organization_id = $1 AND LOWER(email) = LOWER($2) ORDER BY user_id DESC LIMIT 1`, [organizationId, email]);

    return res.json({
      userId: created.rows[0]?.user_id,
      firstName,
      lastName,
      email,
      role,
      classNames: resolvedClasses.map((c) => c.class_name),
      grantedPermissions: predictedPermissions,
      message: capture.successEntry()?.msg || "Employee created.",
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createEmployeeApi]", error);
    return res.status(500).json({ error: "Unable to create the employee." });
  }
}

// POST /internal/api/employees/set-hold
// { organizationId, userId, ..., email?, name?, hold: true|false, confirm }
async function setEmployeeHoldApi(req, res) {
  try {
    const organizationId = await assertCanManageEmployees(req);
    const hold = req.body?.hold === true;
    const employee = await resolveEmployeeByIdentifier(organizationId, { email: req.body?.email, name: req.body?.name });

    if (hold && Number(employee.user_id) === Number(req.body?.userId)) {
      // 422, not 403 - this is a Mira-side safety guard, not the real
      // permission check, and callWriteApi (mira/tools/_writeAuth.js)
      // treats every 403 as a permission denial - a 403 here would get
      // mislabeled as "you don't have Manage Employees" instead of "Mira
      // won't do this to your own account", so it needs its own status.
      const error = new Error("You can't put your own account on hold via Mira - do this from your own profile if that's really intended.");
      error.status = 422;
      throw error;
    }

    if (employee.on_hold === hold) {
      return res.json({
        status: "no_change",
        userId: employee.user_id,
        name: `${employee.first_name} ${employee.last_name}`,
        onHold: employee.on_hold,
        message: `${employee.first_name} ${employee.last_name} is already ${hold ? "on hold" : "active"}.`,
      });
    }

    if (hold && req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        name: `${employee.first_name} ${employee.last_name}`,
        email: employee.email,
        warning: `Putting "${employee.first_name} ${employee.last_name}" (${employee.email}) on hold notifies them by email and in-app, and may restrict their access. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const fakeReq = { params: { userId: employee.user_id }, session: { organizationId }, flash: () => {} };
    const fakeRes = { redirect() {} };
    await commonController.toggleHoldEmployee(fakeReq, fakeRes, db);

    const updated = await db.query(`SELECT on_hold FROM users WHERE user_id = $1`, [employee.user_id]);

    return res.json({
      userId: employee.user_id,
      name: `${employee.first_name} ${employee.last_name}`,
      email: employee.email,
      onHold: updated.rows[0]?.on_hold === true,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setEmployeeHoldApi]", error);
    return res.status(500).json({ error: "Unable to update the employee's hold status." });
  }
}

// ============================================================
// Transportation - /transportation/manage. Buses, drivers, routes, stops,
// weekly schedules, and student bus assignments, plus live GPS reporting
// (translated to human-readable text - reverse geocoding + next-stop/ETA -
// since the app itself only ever shows a raw map pin and a timestamp, both
// admin-side and in the parent/student dashboards).
// No dedicated PERMISSIONS.MANAGE_TRANSPORTATION exists - the real routes
// reuse MANAGE_STUDENTS (matches every write route in transportationRoute.js).
// Every write here delegates to the real transportationController handler
// (it already supports JSON responses via a wantsJson(req) check, unlike
// the flash-only promotion/employee controllers, so this is a much
// thinner wrapper). "Set status" (hold/pause/resume for a bus, route,
// driver, or one schedule day) is a DIRECT column update rather than a
// delegated call: updateBusPost/updateRoutePost/updateDriverPost are full
// FULL-RECORD overwrites with destructive side effects on other data -
// updateDriverPost unconditionally deletes and rebuilds the driver's whole
// weekly schedule, updateRoutePost unconditionally detaches any stop not
// re-submitted in the same call - so calling them just to flip one status
// field would risk silently wiping a driver's schedule or a route's stops.
// A direct, single-column UPDATE has none of that risk.
// Live trip start/end and GPS-ping posting are NOT exposed to Mira at
// all - those represent a driver physically operating a vehicle right now;
// Mira "starting a trip" makes no sense and could make riders/parents
// believe a bus is running when no one is driving it.
// Student-facing reads (get_student_transportation, live status for a
// student) are available to staff, to a guardian for their own linked
// child, and to a student for themselves - matching the real
// authorizeStudentLiveAccess three-way check on GET /live/student/:id -
// not just staff, since Mira may be chatting with a parent or student too.
// ============================================================

const TRANSPORT_BUS_STATUSES = new Set(["active", "in_service", "maintenance", "out_of_service"]);
const TRANSPORT_ROUTE_STATUSES = new Set(["active", "inactive"]);
const TRANSPORT_DRIVER_STATUSES = new Set(["active", "inactive"]);
const TRANSPORT_SCHEDULE_STATUSES = new Set(["active", "inactive"]);
const TRANSPORT_ARRIVED_KM = 0.15; // matches the driver dashboard's own "arrived at stop" threshold
const TRANSPORT_ASSUMED_SPEED_KMH = 25; // used for ETA only when the live ping's own speed is too low/missing to trust

async function assertCanManageTransportation(req) {
  return assertHasPermission(req, PERMISSIONS.MANAGE_STUDENTS, "You don't have permission to manage transportation.");
}
async function assertCanManageTransportationQuery(req) {
  return assertHasPermissionQuery(req, PERMISSIONS.MANAGE_STUDENTS, "You don't have permission to manage transportation.");
}

async function resolveTransportBusByNumber(organizationId, busNumber) {
  const rows = await db.query(`SELECT * FROM transport_buses WHERE organization_id = $1 AND LOWER(bus_number) = LOWER($2)`, [organizationId, String(busNumber || "").trim()]);
  if (!rows.rows.length) {
    const error = new Error(`No bus numbered "${busNumber}" was found.`);
    error.status = 404;
    throw error;
  }
  return rows.rows[0];
}

async function resolveTransportRouteByName(organizationId, routeName) {
  const rows = await db.query(`SELECT * FROM transport_routes WHERE organization_id = $1 AND LOWER(route_name) = LOWER($2)`, [organizationId, String(routeName || "").trim()]);
  if (!rows.rows.length) {
    const error = new Error(`No route named "${routeName}" was found.`);
    error.status = 404;
    throw error;
  }
  return rows.rows[0];
}

async function resolveTransportStopByName(organizationId, stopName, routeName) {
  const params = [organizationId, String(stopName || "").trim()];
  let routeFilter = "";
  if (routeName) {
    params.push(String(routeName).trim());
    routeFilter = `AND route_id = (SELECT route_id FROM transport_routes WHERE organization_id = $1 AND LOWER(route_name) = LOWER($3))`;
  }
  const rows = await db.query(`SELECT * FROM transport_stops WHERE organization_id = $1 AND LOWER(stop_name) = LOWER($2) ${routeFilter}`, params);
  if (!rows.rows.length) {
    const error = new Error(`No stop named "${stopName}"${routeName ? ` on route "${routeName}"` : ""} was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one stop is named "${stopName}" - specify which route it's on.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

// Drivers are Driver-role `users` rows, optionally with a transport_drivers
// profile layered on top (phone/license/assignment) - resolved by email
// since that's unique platform-wide and is how staff already think of an
// employee (matches the Employees tools' resolution pattern).
async function resolveTransportDriverByEmail(organizationId, email) {
  const trimmedEmail = String(email || "").trim();
  if (!trimmedEmail) {
    const error = new Error("email is required to identify a driver.");
    error.status = 400;
    throw error;
  }
  const userRows = await db.query(
    `SELECT user_id, first_name, last_name, email, account_type FROM users WHERE organization_id = $1 AND LOWER(email) = LOWER($2)`,
    [organizationId, trimmedEmail]
  );
  if (!userRows.rows.length) {
    const error = new Error(`No employee with email "${trimmedEmail}" was found.`);
    error.status = 404;
    throw error;
  }
  const user = userRows.rows[0];
  if (user.account_type !== "Driver") {
    const error = new Error(`${trimmedEmail} is a ${user.account_type}, not a Driver - change their role in Manage Employees first.`);
    error.status = 409;
    throw error;
  }
  const profileRows = await db.query(`SELECT * FROM transport_drivers WHERE organization_id = $1 AND user_id = $2`, [organizationId, user.user_id]);
  return { user, profile: profileRows.rows[0] || null };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every((v) => Number.isFinite(v))) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Replays a trip's full ping history against the route's stops using the
// exact same "last-passed-stop-order only ever increases, arrived within
// 150m" heuristic the driver's own live map computes client-side - nothing
// server-side persists "which stop are we at", so this is recomputed fresh
// each time from raw pings rather than trusted from a stored field.
function computeRouteProgress(pings, stops) {
  const orderedStops = [...stops]
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
    .sort((a, b) => a.stopOrder - b.stopOrder);
  if (!orderedStops.length) return { lastPassedStop: null, nextStop: null };

  let lastPassedOrder = -Infinity;
  for (const ping of pings) {
    for (const stop of orderedStops) {
      if (stop.stopOrder <= lastPassedOrder) continue;
      const d = haversineKm(ping.latitude, ping.longitude, stop.latitude, stop.longitude);
      if (d !== null && d <= TRANSPORT_ARRIVED_KM) {
        lastPassedOrder = Math.max(lastPassedOrder, stop.stopOrder);
      }
    }
  }
  const lastPassedStop = [...orderedStops].reverse().find((s) => s.stopOrder <= lastPassedOrder && lastPassedOrder !== -Infinity) || null;
  const nextStop = orderedStops.find((s) => s.stopOrder > lastPassedOrder) || null;
  return { lastPassedStop, nextStop };
}

// Builds the human-readable "where is the bus" report - the actual
// deliverable behind get_transportation_live_status / the live portion of
// get_student_transportation. Takes the raw trip/live-ping/route data this
// file already has to query and turns it into one clear paragraph, never
// raw lat/lng, with a graceful fallback if reverse geocoding is
// unavailable (rate-limited/offline) - the coordinates and next-stop
// computation still work even when the address lookup doesn't.
async function buildLiveStatusReport(organizationId, { busLabel, routeLabel, driverName, tripRow, stops }) {
  if (!tripRow) {
    return {
      hasActiveTrip: false,
      location: null,
      progress: null,
      message: `${busLabel || routeLabel || "This bus"} does not have an active trip right now, so no live location is available.`,
    };
  }

  const pingsResult = await db.query(
    `SELECT latitude, longitude, speed_kmh, heading_deg, recorded_at
     FROM transport_live_locations
     WHERE organization_id = $1 AND trip_id = $2
     ORDER BY recorded_at ASC`,
    [organizationId, tripRow.trip_id]
  );
  const pings = pingsResult.rows.map((r) => ({
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    speedKmh: r.speed_kmh !== null ? Number(r.speed_kmh) : null,
    headingDeg: r.heading_deg !== null ? Number(r.heading_deg) : null,
    recordedAt: r.recorded_at,
  }));

  if (!pings.length) {
    return {
      hasActiveTrip: true,
      location: null,
      progress: null,
      message: `${busLabel || routeLabel || "This bus"}'s trip has started, but no GPS location has come in yet. Try again shortly.`,
    };
  }

  const latest = pings[pings.length - 1];
  const geocoded = await reverseGeocode(latest.latitude, latest.longitude).catch(() => null);
  const minutesAgo = Math.max(0, Math.round((Date.now() - new Date(latest.recordedAt).getTime()) / 60000));

  const normalizedStops = (stops || []).map((s) => ({
    stopId: s.stop_id ?? s.stopId,
    stopName: s.stop_name ?? s.stopName,
    stopAddress: s.stop_address ?? s.stopAddress,
    latitude: s.latitude !== null && s.latitude !== undefined ? Number(s.latitude) : null,
    longitude: s.longitude !== null && s.longitude !== undefined ? Number(s.longitude) : null,
    stopOrder: s.stop_order !== undefined ? Number(s.stop_order) : Number(s.stopOrder ?? 0),
  }));
  const { lastPassedStop, nextStop } = computeRouteProgress(pings, normalizedStops);

  let etaMinutes = null;
  if (nextStop) {
    const distanceToNext = haversineKm(latest.latitude, latest.longitude, nextStop.latitude, nextStop.longitude);
    const speedForEta = latest.speedKmh && latest.speedKmh > 1 ? latest.speedKmh : TRANSPORT_ASSUMED_SPEED_KMH;
    if (distanceToNext !== null) etaMinutes = Math.max(0, Math.round((distanceToNext / speedForEta) * 60));
  }

  const whoLabel = [busLabel, routeLabel].filter(Boolean).join(" on ") || "The bus";
  const whereText = geocoded?.address ? `near ${geocoded.road || geocoded.address}` : `at ${latest.latitude.toFixed(5)}, ${latest.longitude.toFixed(5)} (address lookup unavailable right now)`;
  const movingText = latest.speedKmh && latest.speedKmh > 1 ? `, moving at about ${Math.round(latest.speedKmh)} km/h` : latest.speedKmh === 0 ? ", currently stopped" : "";
  const driverText = driverName ? ` (Driver: ${driverName})` : "";
  const passedText = lastPassedStop ? ` It just passed ${lastPassedStop.stopName}.` : "";
  const nextText = nextStop
    ? ` Heading to ${nextStop.stopName} next${etaMinutes !== null ? `, about ${etaMinutes} minute${etaMinutes === 1 ? "" : "s"} away` : ""}.`
    : "";
  const staleWarning = minutesAgo >= 5 ? ` (Last update was ${minutesAgo} minutes ago - this may be out of date.)` : "";

  return {
    hasActiveTrip: true,
    location: {
      latitude: latest.latitude,
      longitude: latest.longitude,
      humanAddress: geocoded?.address || null,
      recordedAt: latest.recordedAt,
      minutesAgo,
      speedKmh: latest.speedKmh,
      headingDeg: latest.headingDeg,
    },
    progress: {
      lastPassedStop: lastPassedStop ? { stopName: lastPassedStop.stopName, stopAddress: lastPassedStop.stopAddress } : null,
      nextStop: nextStop ? { stopName: nextStop.stopName, stopAddress: nextStop.stopAddress, etaMinutes } : null,
    },
    message: `${whoLabel}${driverText} is currently ${whereText}${movingText}.${passedText}${nextText}${staleWarning}`.trim(),
  };
}

async function assertStudentAccessibleToTenant(tenant, studentId) {
  // 422, not 403 - this is an ownership check on WHICH student a guardian/
  // student may view, not the real Manage-* permission check, and
  // callWriteApi/most tool catch blocks treat every 403 as "you lack the
  // permission" (mislabeling this) since that's the convention
  // assertHasPermission's real RBAC denials use everywhere else.
  if (tenant.viewerType === "student") {
    if (Number(tenant.userId) !== Number(studentId)) {
      const error = new Error("You can only view your own transportation info.");
      error.status = 422;
      throw error;
    }
    return;
  }
  if (tenant.viewerType === "guardian") {
    const rows = await db.query(`SELECT 1 FROM guardian_students WHERE guardian_id = $1 AND student_id = $2`, [tenant.userId, studentId]);
    if (!rows.rows.length) {
      const error = new Error("You can only view transportation info for your own linked student(s).");
      error.status = 422;
      throw error;
    }
  }
  // Staff: no additional restriction beyond org scoping - matches the real
  // GET /transportation/live/student/:id, which allows any authenticated
  // staff member, not gated behind a specific permission.
}

async function resolveStudentIdForTenant(organizationId, tenant, studentName) {
  if (tenant.viewerType === "student") {
    return Number(tenant.userId);
  }
  if (tenant.viewerType === "guardian" && !studentName) {
    const rows = await db.query(
      `SELECT gs.student_id, s.first_name, s.last_name FROM guardian_students gs JOIN students s ON s.student_id = gs.student_id WHERE gs.guardian_id = $1`,
      [tenant.userId]
    );
    if (!rows.rows.length) {
      const error = new Error("No students are linked to your account.");
      error.status = 404;
      throw error;
    }
    if (rows.rows.length > 1) {
      const error = new Error(`You have more than one linked student (${rows.rows.map((r) => `${r.first_name} ${r.last_name}`).join(", ")}) - specify which one.`);
      error.status = 409;
      throw error;
    }
    return Number(rows.rows[0].student_id);
  }
  if (!studentName) {
    const error = new Error("studentName is required.");
    error.status = 400;
    throw error;
  }
  const student = await resolveStudentByName(organizationId, studentName);
  await assertStudentAccessibleToTenant(tenant, student.student_id);
  return Number(student.student_id);
}

// GET /internal/api/transportation/buses
async function listTransportBusesApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportationQuery(req);
    const rows = await db.query(
      `SELECT b.*, u.first_name AS driver_first_name, u.last_name AS driver_last_name
       FROM transport_buses b
       LEFT JOIN users u ON u.user_id = b.driver_user_id
       WHERE b.organization_id = $1
       ORDER BY b.bus_number ASC`,
      [organizationId]
    );
    const buses = rows.rows.map((r) => ({
      busNumber: r.bus_number,
      busName: r.bus_name,
      licensePlate: r.license_plate,
      capacity: r.capacity,
      status: r.status,
      driverName: r.driver_first_name ? `${r.driver_first_name} ${r.driver_last_name}` : null,
      vehicle: { make: r.vehicle_make, model: r.vehicle_model, year: r.vehicle_year, color: r.vehicle_color, vin: r.vin, fuelType: r.fuel_type, odometer: r.odometer !== null ? Number(r.odometer) : null },
    }));
    return res.json({ buses });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listTransportBusesApi]", error);
    return res.status(500).json({ error: "Unable to load buses." });
  }
}

// GET /internal/api/transportation/drivers
async function listTransportDriversApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportationQuery(req);
    const rows = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.on_hold,
              d.phone, d.license_number, d.status AS transport_status,
              bus.bus_number AS assigned_bus_number, r.route_name AS assigned_route_name
       FROM users u
       LEFT JOIN transport_drivers d ON d.organization_id = u.organization_id AND d.user_id = u.user_id
       LEFT JOIN transport_buses bus ON bus.organization_id = u.organization_id AND bus.bus_id = d.assigned_bus_id
       LEFT JOIN transport_routes r ON r.organization_id = u.organization_id AND r.route_id = d.assigned_route_id
       WHERE u.organization_id = $1 AND u.account_type = 'Driver'
       ORDER BY u.last_name, u.first_name`,
      [organizationId]
    );
    const drivers = rows.rows.map((r) => ({
      name: `${r.first_name} ${r.last_name}`,
      email: r.email,
      employeeOnHold: r.on_hold === true,
      inTransportationRoster: r.transport_status !== null,
      transportStatus: r.transport_status,
      phone: r.phone,
      licenseNumber: r.license_number,
      assignedBusNumber: r.assigned_bus_number,
      assignedRouteName: r.assigned_route_name,
    }));
    return res.json({ drivers });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listTransportDriversApi]", error);
    return res.status(500).json({ error: "Unable to load drivers." });
  }
}

// GET /internal/api/transportation/routes
async function listTransportRoutesApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportationQuery(req);
    const routesResult = await db.query(`SELECT * FROM transport_routes WHERE organization_id = $1 ORDER BY route_name ASC`, [organizationId]);
    const routes = await Promise.all(
      routesResult.rows.map(async (r) => {
        const stopsResult = await db.query(
          `SELECT stop_name, stop_address, stop_order FROM transport_stops WHERE organization_id = $1 AND route_id = $2 ORDER BY stop_order ASC, stop_name ASC`,
          [organizationId, r.route_id]
        );
        return {
          routeName: r.route_name,
          routeCode: r.route_code,
          status: r.route_status,
          destinationAddress: r.destination_address,
          useSchoolDestination: r.use_school_destination === true,
          stops: stopsResult.rows.map((s) => ({ stopName: s.stop_name, stopAddress: s.stop_address, stopOrder: s.stop_order })),
        };
      })
    );
    return res.json({ routes });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listTransportRoutesApi]", error);
    return res.status(500).json({ error: "Unable to load routes." });
  }
}

// GET /internal/api/transportation/stops
async function listTransportStopsApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportationQuery(req);
    const rows = await db.query(
      `SELECT s.stop_name, s.stop_address, s.latitude, s.longitude, s.pickup_time, s.dropoff_time, s.stop_order, r.route_name
       FROM transport_stops s
       LEFT JOIN transport_routes r ON r.organization_id = s.organization_id AND r.route_id = s.route_id
       WHERE s.organization_id = $1
       ORDER BY r.route_name ASC NULLS LAST, s.stop_order ASC, s.stop_name ASC`,
      [organizationId]
    );
    const stops = rows.rows.map((r) => ({
      stopName: r.stop_name,
      stopAddress: r.stop_address,
      latitude: r.latitude !== null ? Number(r.latitude) : null,
      longitude: r.longitude !== null ? Number(r.longitude) : null,
      pickupTime: r.pickup_time,
      dropoffTime: r.dropoff_time,
      stopOrder: r.stop_order,
      routeName: r.route_name || null,
    }));
    return res.json({ stops });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listTransportStopsApi]", error);
    return res.status(500).json({ error: "Unable to load stops." });
  }
}

// GET /internal/api/transportation/schedules
async function listTransportSchedulesApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportationQuery(req);
    const rows = await db.query(
      `SELECT sch.day_of_week, sch.start_time, sch.end_time, sch.status, sch.notes,
              bus.bus_number, r.route_name, d.driver_name
       FROM transport_bus_schedules sch
       LEFT JOIN transport_buses bus ON bus.organization_id = sch.organization_id AND bus.bus_id = sch.bus_id
       LEFT JOIN transport_routes r ON r.organization_id = sch.organization_id AND r.route_id = sch.route_id
       LEFT JOIN transport_drivers d ON d.organization_id = sch.organization_id AND d.driver_id = sch.driver_id
       WHERE sch.organization_id = $1
       ORDER BY bus.bus_number ASC,
         CASE sch.day_of_week WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2 WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5 WHEN 'saturday' THEN 6 WHEN 'sunday' THEN 7 ELSE 8 END`,
      [organizationId]
    );
    const schedules = rows.rows.map((r) => ({
      busNumber: r.bus_number,
      routeName: r.route_name,
      driverName: r.driver_name,
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status,
      notes: r.notes,
    }));
    return res.json({ schedules });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listTransportSchedulesApi]", error);
    return res.status(500).json({ error: "Unable to load schedules." });
  }
}

// GET /internal/api/transportation/student?organizationId&...&viewerType&studentName?
async function getStudentTransportationApi(req, res) {
  try {
    // Guardians and students only ever see their own record (resolved
    // below); staff need the same permission as the website's transport pages.
    if (req.query.viewerType !== "guardian" && req.query.viewerType !== "student") {
      try {
        await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_STUDENTS], "You don't have permission to view student transportation.");
      } catch (permissionError) {
        return sendPermissionError(res, permissionError);
      }
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });
    const tenant = { viewerType: req.query.viewerType, userId: req.query.userId };

    const studentId = await resolveStudentIdForTenant(organizationId, tenant, req.query.studentName);
    const snapshot = await getStudentTransportationSnapshot(db, organizationId, studentId);
    if (!snapshot) {
      return res.json({ assigned: false, message: "No transportation assignment found for this student." });
    }
    return res.json({ assigned: true, ...snapshot });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getStudentTransportationApi]", error);
    return res.status(500).json({ error: "Unable to load transportation info." });
  }
}

// GET /internal/api/transportation/live-status?organizationId&...&viewerType&busNumber?|routeName?|studentName?
async function getTransportationLiveStatusApi(req, res) {
  try {
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });
    const tenant = { viewerType: req.query.viewerType, userId: req.query.userId };

    const busNumber = String(req.query.busNumber || "").trim();
    const routeName = String(req.query.routeName || "").trim();
    const studentName = String(req.query.studentName || "").trim();

    if (studentName || (!busNumber && !routeName && (tenant.viewerType === "guardian" || tenant.viewerType === "student"))) {
      // Student-anchored lookup - available to staff, the student's own
      // guardian, or the student themself (see assertStudentAccessibleToTenant).
      const studentId = await resolveStudentIdForTenant(organizationId, tenant, studentName || undefined);
      const snapshot = await getStudentTransportationSnapshot(db, organizationId, studentId);
      if (!snapshot) {
        return res.json({ hasActiveTrip: false, message: "No transportation assignment found for this student." });
      }
      let tripRow = null;
      if (snapshot.live) {
        tripRow = { trip_id: snapshot.live.tripId };
      }
      const report = await buildLiveStatusReport(organizationId, {
        busLabel: snapshot.bus?.busNumber ? `Bus ${snapshot.bus.busNumber}` : null,
        routeLabel: snapshot.route?.routeName || null,
        driverName: snapshot.driverName,
        tripRow,
        stops: snapshot.route?.stops || [],
      });
      return res.json(report);
    }

    // Bus/route-anchored lookup - staff only (matches the real
    // GET /transportation/live/route/:routeId, open to any authenticated
    // staff member, not something a parent/student would ask about in the
    // abstract).
    if (tenant.viewerType !== "staff") {
      return res.status(422).json({ error: "Ask about your own student's transportation instead of a specific bus/route." });
    }
    if (!busNumber && !routeName) {
      return res.status(400).json({ error: "Provide a busNumber, routeName, or studentName." });
    }

    let bus = null;
    let route = null;
    if (busNumber) bus = await resolveTransportBusByNumber(organizationId, busNumber);
    if (routeName) route = await resolveTransportRouteByName(organizationId, routeName);

    const tripResult = await db.query(
      `SELECT trip.*, d.first_name AS driver_first_name, d.last_name AS driver_last_name
       FROM transport_trip_sessions trip
       LEFT JOIN users d ON d.user_id = trip.driver_user_id
       WHERE trip.organization_id = $1 AND trip.status = 'active'
         AND ((trip.bus_id IS NOT NULL AND trip.bus_id = $2) OR (trip.route_id IS NOT NULL AND trip.route_id = $3))
       ORDER BY trip.started_at DESC LIMIT 1`,
      [organizationId, bus?.bus_id || null, route?.route_id || null]
    );
    const tripRow = tripResult.rows[0] || null;

    const effectiveRouteId = route?.route_id || tripRow?.route_id || null;
    const stopsResult = effectiveRouteId
      ? await db.query(`SELECT * FROM transport_stops WHERE organization_id = $1 AND route_id = $2 ORDER BY stop_order ASC`, [organizationId, effectiveRouteId])
      : { rows: [] };

    const report = await buildLiveStatusReport(organizationId, {
      busLabel: bus ? `Bus ${bus.bus_number}` : null,
      routeLabel: route?.route_name || null,
      driverName: tripRow?.driver_first_name ? `${tripRow.driver_first_name} ${tripRow.driver_last_name}` : null,
      tripRow,
      stops: stopsResult.rows,
    });
    return res.json(report);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getTransportationLiveStatusApi]", error);
    return res.status(500).json({ error: "Unable to load live status." });
  }
}

// Calls a real controller handler (transportationController's, which
// support a JSON response via wantsJson(req), unlike the flash-only
// promotion/employee controllers - or plain 2-arg handlers like
// accountController's, which simply ignore the extra `db` argument) through
// a fake req/res, so the underlying business logic (geocoding, upserts, FK
// cleanup) lives in exactly one place. Throws on ok:false / a non-2xx
// status so callers can just await it.
async function delegateToController(controllerFn, organizationId, body, params = {}) {
  // createDriverPost needs req.protocol + req.get("host") to build the
  // invite-email link when the driver is a brand-new employee - same
  // public-URL resolution createEmployeeApi already uses for the same
  // reason, so the link points at the real app, not this internal caller.
  const { protocol, host } = publicBaseUrlParts();
  const fakeReq = {
    session: { organizationId },
    body,
    params,
    headers: { accept: "application/json" },
    protocol,
    get(header) {
      return header === "host" ? host : undefined;
    },
  };
  let statusCode = 200;
  let payload = null;
  const fakeRes = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
  };
  await controllerFn(fakeReq, fakeRes, db);
  if (statusCode >= 400 || payload?.ok === false) {
    const error = new Error(payload?.message || "The action failed.");
    error.status = statusCode >= 400 ? statusCode : 500;
    throw error;
  }
  return payload;
}

async function resolveTransportSchedule(organizationId, busNumber, dayOfWeek) {
  const bus = await resolveTransportBusByNumber(organizationId, busNumber);
  const day = String(dayOfWeek || "").trim().toLowerCase();
  const rows = await db.query(`SELECT * FROM transport_bus_schedules WHERE organization_id = $1 AND bus_id = $2 AND day_of_week = $3`, [organizationId, bus.bus_id, day]);
  if (!rows.rows.length) {
    const error = new Error(`No schedule entry found for Bus "${bus.bus_number}" on ${day}.`);
    error.status = 404;
    throw error;
  }
  return { bus, schedule: rows.rows[0] };
}

// POST /internal/api/transportation/buses/create
async function createTransportBusApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const busNumber = String(req.body?.busNumber || "").trim();
    if (!busNumber) return res.status(400).json({ error: "busNumber is required." });

    let driverUserId = null;
    if (req.body?.driverEmail) {
      const { user } = await resolveTransportDriverByEmail(organizationId, req.body.driverEmail);
      driverUserId = user.user_id;
    }
    const status = req.body?.status ? String(req.body.status).trim().toLowerCase() : "active";
    if (!TRANSPORT_BUS_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...TRANSPORT_BUS_STATUSES].join(", ")}.` });
    }

    // createBusPost upserts by (organization_id, bus_number), so this same
    // call also serves as "edit an existing bus" - call it again with the
    // same busNumber and new field values.
    const payload = await delegateToController(transportationController.createBusPost, organizationId, {
      busNumber,
      busName: req.body?.busName,
      licensePlate: req.body?.licensePlate,
      capacity: req.body?.capacity,
      driverUserId,
      status,
      vehicleMake: req.body?.vehicleMake,
      vehicleModel: req.body?.vehicleModel,
      vehicleYear: req.body?.vehicleYear,
      vehicleColor: req.body?.vehicleColor,
      vin: req.body?.vin,
      fuelType: req.body?.fuelType,
      odometer: req.body?.odometer,
    });
    return res.json({ busNumber, message: payload?.message || "Bus saved." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createTransportBusApi]", error);
    return res.status(500).json({ error: "Unable to create the bus." });
  }
}

// POST /internal/api/transportation/buses/set-status
// Direct single-column update (not a delegated updateBusPost call) - see
// the section header comment for why "set status" avoids the full-record
// update handlers.
async function setTransportBusStatusApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!TRANSPORT_BUS_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...TRANSPORT_BUS_STATUSES].join(", ")}.` });
    }
    const bus = await resolveTransportBusByNumber(organizationId, req.body?.busNumber);
    const activeTrip = await db.query(`SELECT 1 FROM transport_trip_sessions WHERE organization_id = $1 AND bus_id = $2 AND status = 'active'`, [organizationId, bus.bus_id]);

    await db.query(`UPDATE transport_buses SET status = $1, updated_at = NOW() WHERE organization_id = $2 AND bus_id = $3`, [status, organizationId, bus.bus_id]);

    return res.json({
      busNumber: bus.bus_number,
      status,
      hasActiveTrip: activeTrip.rows.length > 0,
      message: `Bus ${bus.bus_number} is now "${status}".` + (activeTrip.rows.length ? " Note: this bus currently has an active trip in progress." : ""),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setTransportBusStatusApi]", error);
    return res.status(500).json({ error: "Unable to update the bus status." });
  }
}

// POST /internal/api/transportation/buses/delete
// The real deleteBusPost has zero dependency checks (schedules referencing
// this bus cascade-delete silently, assignments/trips/pings just get
// NULLed) - this adds the warn-then-confirm safety net the browser page
// doesn't have, without touching the underlying delete logic itself.
async function deleteTransportBusApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const bus = await resolveTransportBusByNumber(organizationId, req.body?.busNumber);

    const [scheduleCount, assignmentCount, activeTrip] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS c FROM transport_bus_schedules WHERE organization_id = $1 AND bus_id = $2`, [organizationId, bus.bus_id]),
      db.query(`SELECT COUNT(*)::int AS c FROM transport_student_assignments WHERE organization_id = $1 AND bus_id = $2 AND active = TRUE`, [organizationId, bus.bus_id]),
      db.query(`SELECT 1 FROM transport_trip_sessions WHERE organization_id = $1 AND bus_id = $2 AND status = 'active'`, [organizationId, bus.bus_id]),
    ]);
    const schedules = scheduleCount.rows[0].c;
    const assignments = assignmentCount.rows[0].c;
    const hasActiveTrip = activeTrip.rows.length > 0;

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        busNumber: bus.bus_number,
        scheduleCount: schedules,
        studentAssignmentCount: assignments,
        hasActiveTrip,
        warning:
          `Deleting bus "${bus.bus_number}" is permanent. ` +
          (schedules ? `Its ${schedules} weekly schedule row(s) will be deleted too. ` : "") +
          (assignments ? `${assignments} student(s) currently assigned to this bus will lose their bus assignment (their route/stop, if set, stays). ` : "") +
          (hasActiveTrip ? `WARNING: this bus has an active trip right now. ` : "") +
          `Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    await delegateToController(transportationController.deleteBusPost, organizationId, { busId: bus.bus_id });
    return res.json({ busNumber: bus.bus_number, scheduleCount: schedules, studentAssignmentCount: assignments, message: `Bus "${bus.bus_number}" deleted.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteTransportBusApi]", error);
    return res.status(500).json({ error: "Unable to delete the bus." });
  }
}

// POST /internal/api/transportation/routes/create
async function createTransportRouteApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const routeName = String(req.body?.routeName || "").trim();
    if (!routeName) return res.status(400).json({ error: "routeName is required." });

    const routeStatus = req.body?.status ? String(req.body.status).trim().toLowerCase() : "active";
    if (!TRANSPORT_ROUTE_STATUSES.has(routeStatus)) {
      return res.status(400).json({ error: `status must be one of: ${[...TRANSPORT_ROUTE_STATUSES].join(", ")}.` });
    }

    // createRoutePost's _syncRouteStops always fully replaces the route's
    // stop set with stopIds (empty array = detach every stop). To let
    // set-status-style callers omit stopNames and mean "leave stops as
    // they are" (not "detach everything"), stopNames === undefined
    // preserves whatever the route already has; an explicit [] still
    // means "detach all stops" on purpose.
    let stopIds;
    if (req.body?.stopNames === undefined) {
      const existingRoute = await db.query(`SELECT route_id FROM transport_routes WHERE organization_id = $1 AND LOWER(route_name) = LOWER($2)`, [organizationId, routeName]);
      if (existingRoute.rows.length) {
        const existingStops = await db.query(`SELECT stop_id FROM transport_stops WHERE organization_id = $1 AND route_id = $2`, [organizationId, existingRoute.rows[0].route_id]);
        stopIds = existingStops.rows.map((r) => r.stop_id);
      } else {
        stopIds = [];
      }
    } else {
      const stopNames = Array.isArray(req.body.stopNames) ? req.body.stopNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
      const resolved = await Promise.all(stopNames.map((name) => resolveTransportStopByName(organizationId, name)));
      stopIds = resolved.map((s) => s.stop_id);
    }

    // createRoutePost upserts by (organization_id, route_name) - same call
    // serves as "edit."
    const payload = await delegateToController(transportationController.createRoutePost, organizationId, {
      routeName,
      routeCode: req.body?.routeCode,
      routeStatus,
      useSchoolDestination: req.body?.useSchoolDestination ? "1" : "",
      destinationAddress: req.body?.destinationAddress,
      stopIds,
    });
    return res.json({ routeName, stopCount: stopIds.length, message: payload?.message || "Route saved." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createTransportRouteApi]", error);
    return res.status(500).json({ error: "Unable to create the route." });
  }
}

// POST /internal/api/transportation/routes/set-status
async function setTransportRouteStatusApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!TRANSPORT_ROUTE_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...TRANSPORT_ROUTE_STATUSES].join(", ")}.` });
    }
    const route = await resolveTransportRouteByName(organizationId, req.body?.routeName);
    await db.query(`UPDATE transport_routes SET route_status = $1, updated_at = NOW() WHERE organization_id = $2 AND route_id = $3`, [status, organizationId, route.route_id]);
    return res.json({ routeName: route.route_name, status, message: `Route "${route.route_name}" is now "${status}".` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setTransportRouteStatusApi]", error);
    return res.status(500).json({ error: "Unable to update the route status." });
  }
}

// POST /internal/api/transportation/routes/delete
async function deleteTransportRouteApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const route = await resolveTransportRouteByName(organizationId, req.body?.routeName);

    const [stopCount, assignmentCount, scheduleCount, activeTrip] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS c FROM transport_stops WHERE organization_id = $1 AND route_id = $2`, [organizationId, route.route_id]),
      db.query(`SELECT COUNT(*)::int AS c FROM transport_student_assignments WHERE organization_id = $1 AND route_id = $2 AND active = TRUE`, [organizationId, route.route_id]),
      db.query(`SELECT COUNT(*)::int AS c FROM transport_bus_schedules WHERE organization_id = $1 AND route_id = $2`, [organizationId, route.route_id]),
      db.query(`SELECT 1 FROM transport_trip_sessions WHERE organization_id = $1 AND route_id = $2 AND status = 'active'`, [organizationId, route.route_id]),
    ]);
    const stops = stopCount.rows[0].c;
    const assignments = assignmentCount.rows[0].c;
    const schedules = scheduleCount.rows[0].c;
    const hasActiveTrip = activeTrip.rows.length > 0;

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        routeName: route.route_name,
        stopCount: stops,
        studentAssignmentCount: assignments,
        scheduleCount: schedules,
        hasActiveTrip,
        warning:
          `Deleting route "${route.route_name}" is permanent. ` +
          (stops ? `${stops} stop(s) on it will become unattached (not deleted). ` : "") +
          (assignments ? `${assignments} student(s) assigned via this route will lose that assignment. ` : "") +
          (schedules ? `${schedules} weekly schedule row(s) referencing it will lose the route link (not deleted). ` : "") +
          (hasActiveTrip ? `WARNING: this route has an active trip right now. ` : "") +
          `Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    await delegateToController(transportationController.deleteRoutePost, organizationId, { routeId: route.route_id });
    return res.json({ routeName: route.route_name, message: `Route "${route.route_name}" deleted.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteTransportRouteApi]", error);
    return res.status(500).json({ error: "Unable to delete the route." });
  }
}

// POST /internal/api/transportation/stops/create
async function createTransportStopApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const stopName = String(req.body?.stopName || "").trim();
    if (!stopName) return res.status(400).json({ error: "stopName is required." });

    let routeId = null;
    if (req.body?.routeName) {
      const route = await resolveTransportRouteByName(organizationId, req.body.routeName);
      routeId = route.route_id;
    }

    let latitude = req.body?.latitude != null ? Number(req.body.latitude) : null;
    let longitude = req.body?.longitude != null ? Number(req.body.longitude) : null;
    const stopAddress = String(req.body?.stopAddress || "").trim();
    if ((latitude === null || !Number.isFinite(latitude) || longitude === null || !Number.isFinite(longitude)) && stopAddress) {
      const orgMeta = await db.query(`SELECT organization_province, organization_country FROM organizations WHERE organization_id = $1`, [organizationId]);
      const geocoded = await geocodeAddress(stopAddress, orgMeta.rows[0]?.organization_province, orgMeta.rows[0]?.organization_country).catch(() => null);
      if (geocoded) {
        latitude = geocoded.lat;
        longitude = geocoded.lng;
      } else {
        latitude = null;
        longitude = null;
      }
    }

    const payload = await delegateToController(transportationController.createStopPost, organizationId, {
      routeId,
      stopName,
      stopAddress,
      latitude,
      longitude,
      pickupTime: req.body?.pickupTime,
      dropoffTime: req.body?.dropoffTime,
      stopOrder: req.body?.stopOrder,
    });
    return res.json({ stopName, geocoded: latitude !== null && longitude !== null, message: payload?.message || "Stop saved." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createTransportStopApi]", error);
    return res.status(500).json({ error: "Unable to create the stop." });
  }
}

// POST /internal/api/transportation/stops/delete
async function deleteTransportStopApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const stop = await resolveTransportStopByName(organizationId, req.body?.stopName, req.body?.routeName);

    const assignmentCount = await db.query(`SELECT COUNT(*)::int AS c FROM transport_student_assignments WHERE organization_id = $1 AND stop_id = $2 AND active = TRUE`, [organizationId, stop.stop_id]);
    const assignments = assignmentCount.rows[0].c;

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        stopName: stop.stop_name,
        studentAssignmentCount: assignments,
        warning:
          `Deleting stop "${stop.stop_name}" is permanent. ` +
          (assignments ? `${assignments} student(s) assigned to this stop will lose that stop (their bus/route assignment stays). ` : "") +
          `Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    await delegateToController(transportationController.deleteStopPost, organizationId, { stopId: stop.stop_id });
    return res.json({ stopName: stop.stop_name, message: `Stop "${stop.stop_name}" deleted.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteTransportStopApi]", error);
    return res.status(500).json({ error: "Unable to delete the stop." });
  }
}

// POST /internal/api/transportation/drivers/create
// Delegates straight to createDriverPost, which already handles both
// "link an existing Driver-role employee" and "create a brand-new one
// through the same invite pipeline Manage Employees uses" - no need to
// duplicate either path here.
async function createTransportDriverApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const firstName = String(req.body?.firstName || "").trim();
    const lastName = String(req.body?.lastName || "").trim();
    const email = String(req.body?.email || "").trim();
    if (!firstName || !lastName || !email) return res.status(400).json({ error: "firstName, lastName, and email are required." });

    let assignedBusId = null;
    if (req.body?.assignedBusNumber) {
      const bus = await resolveTransportBusByNumber(organizationId, req.body.assignedBusNumber);
      assignedBusId = bus.bus_id;
    }
    let assignedRouteId = null;
    if (req.body?.assignedRouteName) {
      const route = await resolveTransportRouteByName(organizationId, req.body.assignedRouteName);
      assignedRouteId = route.route_id;
    }
    const status = req.body?.status ? String(req.body.status).trim().toLowerCase() : "active";
    if (!TRANSPORT_DRIVER_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...TRANSPORT_DRIVER_STATUSES].join(", ")}.` });
    }

    const payload = await delegateToController(transportationController.createDriverPost, organizationId, {
      firstName,
      lastName,
      email,
      phone: req.body?.phone,
      licenseNumber: req.body?.licenseNumber,
      assignedBusId,
      assignedRouteId,
      status,
      scheduleDays: req.body?.scheduleDays,
      scheduleStartTime: req.body?.scheduleStartTime,
      scheduleEndTime: req.body?.scheduleEndTime,
    });
    return res.json({ email, message: payload?.message || "Driver saved." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createTransportDriverApi]", error);
    return res.status(500).json({ error: "Unable to create the driver." });
  }
}

// POST /internal/api/transportation/drivers/set-status
async function setTransportDriverStatusApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!TRANSPORT_DRIVER_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...TRANSPORT_DRIVER_STATUSES].join(", ")}.` });
    }
    const { user, profile } = await resolveTransportDriverByEmail(organizationId, req.body?.email);
    if (!profile) {
      return res.status(404).json({ error: `${user.email} isn't in the transportation roster yet - use create_transport_driver first.` });
    }
    await db.query(`UPDATE transport_drivers SET status = $1, updated_at = NOW() WHERE organization_id = $2 AND user_id = $3`, [status, organizationId, user.user_id]);
    return res.json({
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      status,
      message: `${user.first_name} ${user.last_name} is now "${status}" in transportation.`,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setTransportDriverStatusApi]", error);
    return res.status(500).json({ error: "Unable to update the driver status." });
  }
}

// POST /internal/api/transportation/drivers/delete
// "Delete" here matches the real deleteDriverPost exactly: removes the
// transport_drivers profile + bus link only. The employee's login account
// is never touched - that's Manage Employees' responsibility.
async function deleteTransportDriverApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const { user, profile } = await resolveTransportDriverByEmail(organizationId, req.body?.email);
    if (!profile) {
      return res.json({ email: user.email, message: `${user.first_name} ${user.last_name} wasn't in the transportation roster.` });
    }

    const scheduleCount = await db.query(`SELECT COUNT(*)::int AS c FROM transport_bus_schedules WHERE organization_id = $1 AND driver_id = $2`, [organizationId, profile.driver_id]);
    const schedules = scheduleCount.rows[0].c;

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        scheduleCount: schedules,
        warning:
          `Removing ${user.first_name} ${user.last_name} from transportation is permanent (their employee login is NOT affected - use Manage Employees for that). ` +
          (schedules ? `${schedules} weekly schedule row(s) referencing them will lose the driver link (not deleted). ` : "") +
          `Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    await delegateToController(transportationController.deleteDriverPost, organizationId, { userId: user.user_id });
    return res.json({ email: user.email, name: `${user.first_name} ${user.last_name}`, message: `${user.first_name} ${user.last_name} removed from transportation.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteTransportDriverApi]", error);
    return res.status(500).json({ error: "Unable to remove the driver." });
  }
}

// POST /internal/api/transportation/schedules/create
async function createTransportScheduleApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const bus = await resolveTransportBusByNumber(organizationId, req.body?.busNumber);
    const dayOfWeek = String(req.body?.dayOfWeek || "").trim().toLowerCase();
    const validDays = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
    if (!validDays.has(dayOfWeek)) return res.status(400).json({ error: `dayOfWeek must be one of: ${[...validDays].join(", ")}.` });

    let routeId = null;
    if (req.body?.routeName) {
      const route = await resolveTransportRouteByName(organizationId, req.body.routeName);
      routeId = route.route_id;
    }
    let driverId = null;
    if (req.body?.driverEmail) {
      const { profile } = await resolveTransportDriverByEmail(organizationId, req.body.driverEmail);
      if (!profile) return res.status(404).json({ error: `${req.body.driverEmail} isn't in the transportation roster yet - use create_transport_driver first.` });
      driverId = profile.driver_id;
    }
    const status = req.body?.status ? String(req.body.status).trim().toLowerCase() : "active";
    if (!TRANSPORT_SCHEDULE_STATUSES.has(status)) return res.status(400).json({ error: `status must be one of: ${[...TRANSPORT_SCHEDULE_STATUSES].join(", ")}.` });

    // Duplicate-day guard - the real form allows creating a second row for
    // the same bus+day with no warning; Mira checks first so a repeated
    // "schedule Bus 12 for Monday" doesn't quietly create a duplicate.
    const existing = await db.query(`SELECT schedule_id FROM transport_bus_schedules WHERE organization_id = $1 AND bus_id = $2 AND day_of_week = $3`, [organizationId, bus.bus_id, dayOfWeek]);
    if (existing.rows.length) {
      return res.status(409).json({ error: `Bus "${bus.bus_number}" already has a schedule entry for ${dayOfWeek}. Delete it first, or use a different day.` });
    }

    await delegateToController(transportationController.createSchedulePost, organizationId, {
      busId: bus.bus_id,
      driverId,
      routeId,
      dayOfWeek,
      startTime: req.body?.startTime,
      endTime: req.body?.endTime,
      status,
      notes: req.body?.notes,
    });
    return res.json({ busNumber: bus.bus_number, dayOfWeek, message: `Schedule saved for Bus ${bus.bus_number} on ${dayOfWeek}.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createTransportScheduleApi]", error);
    return res.status(500).json({ error: "Unable to create the schedule." });
  }
}

// POST /internal/api/transportation/schedules/set-status
async function setTransportScheduleStatusApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!TRANSPORT_SCHEDULE_STATUSES.has(status)) return res.status(400).json({ error: `status must be one of: ${[...TRANSPORT_SCHEDULE_STATUSES].join(", ")}.` });
    const { bus, schedule } = await resolveTransportSchedule(organizationId, req.body?.busNumber, req.body?.dayOfWeek);
    await db.query(`UPDATE transport_bus_schedules SET status = $1, updated_at = NOW() WHERE organization_id = $2 AND schedule_id = $3`, [status, organizationId, schedule.schedule_id]);
    return res.json({
      busNumber: bus.bus_number,
      dayOfWeek: schedule.day_of_week,
      status,
      message: `Bus ${bus.bus_number}'s ${schedule.day_of_week} schedule is now "${status}".`,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setTransportScheduleStatusApi]", error);
    return res.status(500).json({ error: "Unable to update the schedule status." });
  }
}

// POST /internal/api/transportation/schedules/delete
async function deleteTransportScheduleApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const { bus, schedule } = await resolveTransportSchedule(organizationId, req.body?.busNumber, req.body?.dayOfWeek);

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        busNumber: bus.bus_number,
        dayOfWeek: schedule.day_of_week,
        warning: `Deleting Bus ${bus.bus_number}'s ${schedule.day_of_week} schedule entry is permanent. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    await delegateToController(transportationController.deleteSchedulePost, organizationId, { scheduleId: schedule.schedule_id });
    return res.json({ busNumber: bus.bus_number, dayOfWeek: schedule.day_of_week, message: `Bus ${bus.bus_number}'s ${schedule.day_of_week} schedule entry deleted.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteTransportScheduleApi]", error);
    return res.status(500).json({ error: "Unable to delete the schedule." });
  }
}

// POST /internal/api/transportation/students/assign
// assignStudentPost has no JSON response mode (flash-only), so this uses
// the same flash-capture pattern as the Promotion section above.
async function assignStudentTransportationApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const student = await resolveStudentByName(organizationId, req.body?.studentName);

    let busId = null;
    let routeId = null;
    let stopId = null;
    if (req.body?.busNumber) {
      const bus = await resolveTransportBusByNumber(organizationId, req.body.busNumber);
      busId = bus.bus_id;
    }
    if (req.body?.routeName) {
      const route = await resolveTransportRouteByName(organizationId, req.body.routeName);
      routeId = route.route_id;
    }
    if (req.body?.stopName) {
      const stop = await resolveTransportStopByName(organizationId, req.body.stopName, req.body?.routeName);
      stopId = stop.stop_id;
    }
    if (!busId && !routeId && !stopId) {
      return res.status(400).json({ error: "Provide at least one of busNumber, routeName, or stopName." });
    }

    const capture = makeFlashCapture();
    const fakeReq = {
      session: { organizationId },
      body: {
        studentId: student.student_id,
        busId,
        routeId,
        stopId,
        pickupTime: req.body?.pickupTime,
        dropoffTime: req.body?.dropoffTime,
        homeAddress: req.body?.homeAddress,
        homeLatitude: req.body?.homeLatitude,
        homeLongitude: req.body?.homeLongitude,
      },
      flash: capture.flash,
    };
    const fakeRes = { redirect() {} };
    await transportationController.assignStudentPost(fakeReq, fakeRes, db);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 400;
      throw err;
    }

    return res.json({ studentName: `${student.first_name} ${student.last_name}`, message: capture.successEntry()?.msg || "Transportation assignment saved." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/assignStudentTransportationApi]", error);
    return res.status(500).json({ error: "Unable to assign transportation." });
  }
}

// POST /internal/api/transportation/students/remove
// Mirrors the "uncheck" half of the real bulk class-access toggle, but for
// one named student - sets active=false rather than deleting the row
// (matches the real soft-revoke semantics; no hard-delete path exists for
// a single assignment in the app itself).
async function removeStudentTransportationApi(req, res) {
  try {
    const organizationId = await assertCanManageTransportation(req);
    const student = await resolveStudentByName(organizationId, req.body?.studentName);

    const existing = await db.query(`SELECT active FROM transport_student_assignments WHERE organization_id = $1 AND student_id = $2`, [organizationId, student.student_id]);
    if (!existing.rows.length || existing.rows[0].active !== true) {
      return res.json({
        status: "no_change",
        studentName: `${student.first_name} ${student.last_name}`,
        message: `${student.first_name} ${student.last_name} doesn't currently have active bus access.`,
      });
    }

    await db.query(`UPDATE transport_student_assignments SET active = FALSE, updated_at = NOW() WHERE organization_id = $1 AND student_id = $2`, [organizationId, student.student_id]);
    return res.json({ studentName: `${student.first_name} ${student.last_name}`, message: `${student.first_name} ${student.last_name}'s bus access has been removed.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/removeStudentTransportationApi]", error);
    return res.status(500).json({ error: "Unable to remove transportation access." });
  }
}

// ============================================================
// Events & Announcements - /common/manageEventsAnnouncements. Two simple,
// unrelated-to-each-other tables (`school_events`, `announcements`) with no
// other table referencing either, so deletes have zero blast radius beyond
// the row itself. Gated by PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS on
// every route already (create/update/delete all re-verify it server-side -
// no gap to patch here, unlike some other pages). Every write delegates to
// the real commonController handler (flash-only, no JSON mode, same
// flash-capture pattern as Promotion/Transportation above) so the
// auto-current-term resolution and broadcast/notification side effects
// stay the single source of truth.
// NOT the same feature as the pre-existing `create_announcement` Mira tool
// (mira/tools/createAnnouncement.js) - that one targets the unrelated
// `admin_announcements` table via POST /internal/api/announcements (a
// different, platform-level announcements feature). Tool/route names here
// are deliberately distinct (`school-announcements`, not `announcements`)
// so the two are never confused.
// `visibility` ('org' | 'public' | 'both') controls whether an item is
// exposed on the school's public website and whether the "Notify
// Guardians" broadcast feature can target it (blocked for 'org'). Mira
// defaults to 'org' (internal-only) when the caller doesn't specify one -
// safer than the DB/form's own 'both' default, since Mira should never
// publish something externally without being told to.
// ============================================================

const EVENT_ANNOUNCEMENT_VISIBILITIES = new Set(["org", "public", "both"]);

async function assertCanPublishEventsAnnouncements(req) {
  return assertHasPermission(req, PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS, "You don't have permission to publish events & announcements.");
}
async function assertCanPublishEventsAnnouncementsQuery(req) {
  return assertHasPermissionQuery(req, PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS, "You don't have permission to publish events & announcements.");
}

async function getCurrentSchoolYearTerm(organizationId) {
  const rows = await db.query(
    `SELECT sy.id AS school_year_id, t.term_id
     FROM school_years sy JOIN terms t ON sy.id = t.school_year_id
     WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
     LIMIT 1`,
    [organizationId]
  );
  return rows.rows[0] || null;
}

function normalizeVisibility(value) {
  const v = String(value || "").trim().toLowerCase();
  return EVENT_ANNOUNCEMENT_VISIBILITIES.has(v) ? v : "org";
}

async function resolveEventByName(organizationId, eventName, eventDate) {
  const params = [organizationId, String(eventName || "").trim()];
  let dateFilter = "";
  if (eventDate) {
    params.push(eventDate);
    dateFilter = "AND event_date = $3";
  }
  const rows = await db.query(`SELECT * FROM school_events WHERE organization_id = $1 AND LOWER(name) = LOWER($2) ${dateFilter}`, params);
  if (!rows.rows.length) {
    const error = new Error(`No event named "${eventName}"${eventDate ? ` on ${eventDate}` : ""} was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one event is named "${eventName}" - also give its exact date (e.g. "2026-09-01") to pick the right one.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

async function resolveAnnouncementByText(organizationId, textFragment) {
  const trimmed = String(textFragment || "").trim();
  if (!trimmed) {
    const error = new Error("A snippet of the announcement's text is required to identify it.");
    error.status = 400;
    throw error;
  }
  const rows = await db.query(`SELECT * FROM announcements WHERE organization_id = $1 AND message ILIKE $2`, [organizationId, `%${trimmed}%`]);
  if (!rows.rows.length) {
    const error = new Error(`No announcement containing "${textFragment}" was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one announcement matches "${textFragment}" - use a longer, more specific snippet.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}
function eventTiming(dateStr) {
  const d = daysUntil(dateStr);
  if (d === null) return null;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d > 1) return `in ${d} days`;
  if (d === -1) return "yesterday";
  return `${Math.abs(d)} days ago`;
}

// GET /internal/api/events?organizationId&...&scope=current|all&when=today|upcoming|past|all
async function listEventsApi(req, res) {
  try {
    const organizationId = await assertCanPublishEventsAnnouncementsQuery(req);
    const scope = req.query.scope === "all" ? "all" : "current";
    const when = ["today", "upcoming", "past"].includes(req.query.when) ? req.query.when : "all";

    let termFilter = "";
    const params = [organizationId];
    if (scope === "current") {
      const current = await getCurrentSchoolYearTerm(organizationId);
      if (!current) return res.json({ events: [], message: "No current school year/term is set for this org." });
      params.push(current.school_year_id, current.term_id);
      termFilter = "AND school_year_id = $2 AND term_id = $3";
    }

    let dateFilter = "";
    if (when === "today") dateFilter = "AND event_date = CURRENT_DATE";
    else if (when === "upcoming") dateFilter = "AND event_date >= CURRENT_DATE";
    else if (when === "past") dateFilter = "AND event_date < CURRENT_DATE";

    const rows = await db.query(`SELECT * FROM school_events WHERE organization_id = $1 ${termFilter} ${dateFilter} ORDER BY event_date ASC NULLS LAST, id ASC`, params);
    const events = rows.rows.map((r) => ({
      name: r.name,
      eventDate: r.event_date,
      timing: eventTiming(r.event_date),
      details: r.details,
      visibility: r.visibility,
    }));
    return res.json({ events });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listEventsApi]", error);
    return res.status(500).json({ error: "Unable to load events." });
  }
}

// GET /internal/api/school-announcements?organizationId&...&scope=current|all
async function listSchoolAnnouncementsApi(req, res) {
  try {
    const organizationId = await assertCanPublishEventsAnnouncementsQuery(req);
    const scope = req.query.scope === "all" ? "all" : "current";

    let termFilter = "";
    const params = [organizationId];
    if (scope === "current") {
      const current = await getCurrentSchoolYearTerm(organizationId);
      if (!current) return res.json({ announcements: [], message: "No current school year/term is set for this org." });
      params.push(current.school_year_id, current.term_id);
      termFilter = "AND school_year_id = $2 AND term_id = $3";
    }

    const rows = await db.query(`SELECT * FROM announcements WHERE organization_id = $1 ${termFilter} ORDER BY created_at DESC`, params);
    const announcements = rows.rows.map((r) => ({
      message: r.message,
      visibility: r.visibility,
      createdAt: r.created_at,
    }));
    return res.json({ announcements });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listSchoolAnnouncementsApi]", error);
    return res.status(500).json({ error: "Unable to load announcements." });
  }
}

// POST /internal/api/events/create
// { organizationId, ..., eventName, eventDate, eventDetails, visibility?, notifyByEmail?, confirm? }
async function createEventApi(req, res) {
  try {
    const organizationId = await assertCanPublishEventsAnnouncements(req);

    const eventName = String(req.body?.eventName || "").trim();
    const eventDate = String(req.body?.eventDate || "").trim();
    const eventDetails = String(req.body?.eventDetails || "").trim();
    if (!eventName || !eventDate || !eventDetails) {
      return res.status(400).json({ error: "eventName, eventDate, and eventDetails are required." });
    }
    if (Number.isNaN(Date.parse(eventDate))) {
      return res.status(400).json({ error: "eventDate must be a valid date (e.g. 2026-09-01)." });
    }
    const visibility = normalizeVisibility(req.body?.visibility);
    const notifyByEmail = req.body?.notifyByEmail === true;

    if (notifyByEmail && req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        eventName,
        eventDate,
        visibility,
        warning: `Creating "${eventName}" on ${eventDate} with email notifications on will send a real email to guardians right away. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { type: "event", eventName, eventDate, eventDetails, visibility, notifyByEmail: notifyByEmail ? "true" : "false" }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.createEventAnnouncementPost(fakeReq, fakeRes, db);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ eventName, eventDate, visibility, notifyByEmail, message: capture.successEntry()?.msg || "Event created." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createEventApi]", error);
    return res.status(500).json({ error: "Unable to create the event." });
  }
}

// POST /internal/api/events/update
// { organizationId, ..., eventName, eventDate? (to disambiguate/find), newEventName?, newEventDate?, eventDetails?, visibility?, notifyByEmail?, confirm? }
async function updateEventApi(req, res) {
  try {
    const organizationId = await assertCanPublishEventsAnnouncements(req);
    const event = await resolveEventByName(organizationId, req.body?.eventName, req.body?.eventDate);

    const newEventName = req.body?.newEventName !== undefined ? String(req.body.newEventName).trim() : event.name;
    const newEventDate = req.body?.newEventDate !== undefined ? String(req.body.newEventDate).trim() : event.event_date;
    const newEventDetails = req.body?.eventDetails !== undefined ? String(req.body.eventDetails).trim() : event.details;
    const visibility = req.body?.visibility !== undefined ? normalizeVisibility(req.body.visibility) : event.visibility;
    if (!newEventName || !newEventDate || !newEventDetails) {
      return res.status(400).json({ error: "The event needs a name, date, and details - can't clear any of them to empty." });
    }
    if (Number.isNaN(Date.parse(newEventDate))) {
      return res.status(400).json({ error: "newEventDate must be a valid date (e.g. 2026-09-01)." });
    }
    const notifyByEmail = req.body?.notifyByEmail === true;

    if (notifyByEmail && req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        eventName: newEventName,
        eventDate: newEventDate,
        warning: `Updating "${event.name}" with email notifications on will send a real email to guardians right away. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = {
      session: { organizationId },
      body: { id: event.id, eventName: newEventName, eventDate: newEventDate, eventDetails: newEventDetails, visibility, notifyByEmail: notifyByEmail ? "true" : "false" },
      flash: capture.flash,
    };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.updateEvent(fakeReq, fakeRes, db);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ eventName: newEventName, eventDate: newEventDate, visibility, message: capture.successEntry()?.msg || "Event updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/updateEventApi]", error);
    return res.status(500).json({ error: "Unable to update the event." });
  }
}

// POST /internal/api/events/delete
// { organizationId, ..., eventName, eventDate?, confirm }
async function deleteEventApi(req, res) {
  try {
    const organizationId = await assertCanPublishEventsAnnouncements(req);
    const event = await resolveEventByName(organizationId, req.body?.eventName, req.body?.eventDate);

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        eventName: event.name,
        eventDate: event.event_date,
        warning: `Deleting the event "${event.name}" (${event.event_date instanceof Date ? event.event_date.toISOString().slice(0, 10) : event.event_date}) is permanent. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { id: event.id }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.deleteEvent(fakeReq, fakeRes, db);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ eventName: event.name, message: capture.successEntry()?.msg || "Event deleted." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteEventApi]", error);
    return res.status(500).json({ error: "Unable to delete the event." });
  }
}

// POST /internal/api/school-announcements/create
// { organizationId, ..., message, visibility?, notifyByEmail?, confirm? }
async function createSchoolAnnouncementApi(req, res) {
  try {
    const organizationId = await assertCanPublishEventsAnnouncements(req);
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required." });

    const visibility = normalizeVisibility(req.body?.visibility);
    const notifyByEmail = req.body?.notifyByEmail === true;

    if (notifyByEmail && req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        message,
        visibility,
        warning: `Posting this announcement with email notifications on will send a real email to guardians right away: "${message.slice(0, 120)}${message.length > 120 ? "..." : ""}". Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { type: "announcement", announcementMessage: message, visibility, notifyByEmail: notifyByEmail ? "true" : "false" }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.createEventAnnouncementPost(fakeReq, fakeRes, db);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ message, visibility, notifyByEmail, statusMessage: capture.successEntry()?.msg || "Announcement created." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createSchoolAnnouncementApi]", error);
    return res.status(500).json({ error: "Unable to create the announcement." });
  }
}

// POST /internal/api/school-announcements/update
// { organizationId, ..., currentText, newMessage?, visibility?, notifyByEmail?, confirm? }
async function updateSchoolAnnouncementApi(req, res) {
  try {
    const organizationId = await assertCanPublishEventsAnnouncements(req);
    const announcement = await resolveAnnouncementByText(organizationId, req.body?.currentText);

    const newMessage = req.body?.newMessage !== undefined ? String(req.body.newMessage).trim() : announcement.message;
    if (!newMessage) return res.status(400).json({ error: "The announcement can't be updated to empty text." });
    const visibility = req.body?.visibility !== undefined ? normalizeVisibility(req.body.visibility) : announcement.visibility;
    const notifyByEmail = req.body?.notifyByEmail === true;

    if (notifyByEmail && req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        newMessage,
        visibility,
        warning: `Updating this announcement with email notifications on will send a real email to guardians right away. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { id: announcement.announcement_id, announcementMessage: newMessage, visibility, notifyByEmail: notifyByEmail ? "true" : "false" }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.updateAnnouncement(fakeReq, fakeRes, db);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ message: newMessage, visibility, statusMessage: capture.successEntry()?.msg || "Announcement updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/updateSchoolAnnouncementApi]", error);
    return res.status(500).json({ error: "Unable to update the announcement." });
  }
}

// POST /internal/api/school-announcements/delete
// { organizationId, ..., currentText, confirm }
async function deleteSchoolAnnouncementApi(req, res) {
  try {
    const organizationId = await assertCanPublishEventsAnnouncements(req);
    const announcement = await resolveAnnouncementByText(organizationId, req.body?.currentText);

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        message: announcement.message,
        warning: `Deleting the announcement "${announcement.message.slice(0, 120)}${announcement.message.length > 120 ? "..." : ""}" is permanent. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { id: announcement.announcement_id }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.deleteAnnouncement(fakeReq, fakeRes, db);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ message: announcement.message, statusMessage: capture.successEntry()?.msg || "Announcement deleted." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteSchoolAnnouncementApi]", error);
    return res.status(500).json({ error: "Unable to delete the announcement." });
  }
}

// ============================================================
// School Website - /account/managePublicContent. Gallery images, articles,
// About Us details, layout, style/theme, and self-enrollment settings for
// the org's public-facing website (views/common/publicDashboard.ejs reads
// the exact same tables this page writes). Gated by PERMISSIONS.
// MANAGE_SETTINGS on every route already - the one gap found
// (POST /account/updatePublicRegistration having no auth/permission
// middleware at all) was fixed directly in routes/accountRoute.js as part
// of this work, not just worked around here.
// Every write here except the image upload delegates to the real
// accountController handler (flash-only, same flash-capture pattern used
// throughout this file) so the JSON-blob merge logic in
// organization_dashboard.order_data (theme/layout/aboutDetails all share
// one row, read-patch-write) stays the single source of truth - reimplementing
// that merge here would risk clobbering fields Mira isn't even touching.
// Image upload (uploadWebsiteImageApi) is the one write NOT delegated -
// the real uploadSlideshowImages handler expects multer-populated
// req.files (multipart), which doesn't exist in Mira's JSON-body world;
// this reimplements the same insert logic for a base64 image body instead,
// and (unlike the real browser path, which reuses the raw uploaded
// filename as the literal S3 key with no collision protection) always
// generates a unique key, since Mira has no real filename to begin with
// anyway.
// ============================================================

const WEBSITE_LAYOUTS = new Set(["wireframe1", "wireframe2", "wireframe3", "wireframe4"]);
const WEBSITE_THEMES = new Set(["classic", "modern", "green", "minimal", "indigo", "rose", "amber", "yellow", "slate", "cyan", "orange", "charcoal"]);
const WEBSITE_IMAGE_CONTENT_TYPES = new Set(["slideshow", "siteImage"]);
const WEBSITE_IMAGE_ALLOCATIONS = new Set(["hero", "slideshow", "siteImage"]);
const WEBSITE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

async function assertCanManageWebsite(req) {
  return assertHasPermission(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to manage the school website.");
}
async function assertCanManageWebsiteQuery(req) {
  return assertHasPermissionQuery(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to manage the school website.");
}

async function resolveWebsiteImage(organizationId, { imageId, captionSnippet }) {
  if (imageId) {
    const rows = await db.query(`SELECT * FROM organization_images WHERE organization_id = $1 AND image_id = $2`, [organizationId, imageId]);
    if (!rows.rows.length) {
      const error = new Error(`No website image with id ${imageId} was found.`);
      error.status = 404;
      throw error;
    }
    return rows.rows[0];
  }
  const trimmed = String(captionSnippet || "").trim();
  if (!trimmed) {
    const error = new Error("An imageId or a snippet of the image's caption is required to identify it.");
    error.status = 400;
    throw error;
  }
  const rows = await db.query(`SELECT * FROM organization_images WHERE organization_id = $1 AND caption ILIKE $2`, [organizationId, `%${trimmed}%`]);
  if (!rows.rows.length) {
    const error = new Error(`No website image with a caption containing "${captionSnippet}" was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one website image has a caption matching "${captionSnippet}" - use a longer snippet, or list_website_gallery_images to get the exact imageId.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

async function resolveWebsiteArticle(organizationId, heading) {
  const trimmed = String(heading || "").trim();
  if (!trimmed) {
    const error = new Error("The article's exact heading is required to identify it.");
    error.status = 400;
    throw error;
  }
  const rows = await db.query(`SELECT * FROM organization_texts WHERE organization_id = $1 AND LOWER(heading) = LOWER($2)`, [organizationId, trimmed]);
  if (!rows.rows.length) {
    const error = new Error(`No article headed "${heading}" was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one article is headed "${heading}" - rename one manually from Manage Records to disambiguate.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

// Every one of theme/layout/about-details shares this single JSON blob
// (organization_dashboard.order_data) - read-patch-write, matching every
// real handler that touches it (updateAboutUsSection, updatePublicDashboardLayoutPost,
// updatePublicDashboardThemePost all do this same parse independently).
async function getWebsiteDashboardBlob(organizationId) {
  const rows = await db.query(`SELECT order_data FROM organization_dashboard WHERE organization_id = $1`, [organizationId]);
  let order = [];
  let theme = "classic";
  let layout = "wireframe1";
  let aboutDetails = {};
  if (rows.rows.length) {
    let raw = rows.rows[0].order_data;
    try {
      if (typeof raw === "string") raw = JSON.parse(raw);
      if (Array.isArray(raw)) {
        order = raw;
      } else if (raw && typeof raw === "object") {
        if (Array.isArray(raw.order)) order = raw.order;
        if (typeof raw.theme === "string" && raw.theme.trim()) theme = raw.theme.trim();
        if (typeof raw.layout === "string" && raw.layout.trim()) layout = raw.layout.trim();
        if (raw.aboutDetails && typeof raw.aboutDetails === "object") aboutDetails = raw.aboutDetails;
      }
    } catch {
      // fall through with defaults, matching every real handler's own catch-and-reset behavior
    }
  }
  return { order, theme, layout, aboutDetails };
}

// GET /internal/api/website/images
async function listWebsiteImagesApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsiteQuery(req);
    const rows = await db.query(`SELECT image_id, image_url, caption, allocation, created_at FROM organization_images WHERE organization_id = $1 ORDER BY created_at DESC`, [organizationId]);
    return res.json({
      images: rows.rows.map((r) => ({ imageId: r.image_id, imageUrl: r.image_url, caption: r.caption, allocation: r.allocation, createdAt: r.created_at })),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listWebsiteImagesApi]", error);
    return res.status(500).json({ error: "Unable to load website images." });
  }
}

// GET /internal/api/website/articles
async function listWebsiteArticlesApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsiteQuery(req);
    const rows = await db.query(`SELECT text_id, heading, paragraph FROM organization_texts WHERE organization_id = $1 ORDER BY text_id DESC`, [organizationId]);
    return res.json({ articles: rows.rows.map((r) => ({ heading: r.heading, paragraph: r.paragraph })) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listWebsiteArticlesApi]", error);
    return res.status(500).json({ error: "Unable to load website articles." });
  }
}

// GET /internal/api/website/about-us
async function getWebsiteAboutUsApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsiteQuery(req);
    const orgRows = await db.query(`SELECT aboutus, motto, email, organization_phone FROM organizations WHERE organization_id = $1`, [organizationId]);
    const org = orgRows.rows[0] || {};
    const { aboutDetails } = await getWebsiteDashboardBlob(organizationId);
    return res.json({
      aboutUs: org.aboutus || "",
      motto: (Array.isArray(aboutDetails.mottos) && aboutDetails.mottos[0]) || org.motto || "",
      emails: Array.isArray(aboutDetails.emails) && aboutDetails.emails.length ? aboutDetails.emails : org.email ? [org.email] : [],
      phones: Array.isArray(aboutDetails.phones) && aboutDetails.phones.length ? aboutDetails.phones : org.organization_phone ? [org.organization_phone] : [],
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getWebsiteAboutUsApi]", error);
    return res.status(500).json({ error: "Unable to load the About Us section." });
  }
}

// GET /internal/api/website/settings
async function getWebsiteSettingsApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsiteQuery(req);
    const orgRows = await db.query(
      `SELECT theme_color, public_registration_enabled, registration_start_date, registration_end_date, public_registration_price, public_registration_currency
       FROM organizations WHERE organization_id = $1`,
      [organizationId]
    );
    const org = orgRows.rows[0] || {};
    const { theme, layout } = await getWebsiteDashboardBlob(organizationId);
    const registration = websiteExtras.registrationState(org);
    const { overview, sections } = await loadWebsiteOverview(organizationId);
    return res.json({
      publicUrl: await websitePublicUrl(req, organizationId),
      layout,
      theme,
      selfEnrollment: {
        enabled: org.public_registration_enabled === true,
        startDate: org.registration_start_date,
        endDate: org.registration_end_date,
        price: org.public_registration_price !== null ? Number(org.public_registration_price) : 0,
        currency: org.public_registration_currency || "USD",
        status: registration.message,
      },
      setupChecklist: overview.items.map(({ label, done, detail, optional }) => ({ label, done, detail, optional: Boolean(optional) })),
      unreadWebsiteMessages: overview.unreadMessages,
      sections,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getWebsiteSettingsApi]", error);
    return res.status(500).json({ error: "Unable to load website settings." });
  }
}

// ---- Website sections (quick facts, programs, leadership, testimonials,
// FAQ, about photo, contact form) - same storage and rules as the Manage
// Website page (utils/websiteExtras.js).

async function websitePublicUrl(req, organizationId) {
  if (process.env.NODE_ENV === "production") {
    const info = await getOrganizationWebsiteInfo(db, organizationId).catch(() => null);
    if (info?.websiteUrl) return info.websiteUrl;
  }
  return `${req.protocol}://${req.get("host")}/common/publicDashboard?organizationId=${organizationId}`;
}

async function loadWebsiteOverview(organizationId) {
  const [orgRow, counts, blob, settings, unread] = await Promise.all([
    db.query(`SELECT aboutus, email, organization_phone, public_registration_enabled, registration_start_date, registration_end_date, public_registration_price FROM organizations WHERE organization_id = $1`, [organizationId]),
    db.query(
      `SELECT (SELECT COUNT(*)::int FROM organization_images WHERE organization_id = $1) AS images,
              (SELECT COUNT(*)::int FROM organization_texts WHERE organization_id = $1) AS articles`,
      [organizationId]
    ),
    getWebsiteDashboardBlob(organizationId),
    websiteExtras.getWebsiteSettings(db, organizationId),
    websiteExtras.countUnreadMessages(db, organizationId).catch(() => 0),
  ]);
  const org = orgRow.rows[0] || {};
  const list = (value, fallback) => {
    const values = (Array.isArray(value) ? value : [value]).map((v) => String(v || "").trim()).filter(Boolean);
    return values.length ? values : fallback ? [fallback] : [];
  };
  const overview = websiteExtras.buildWebsiteOverview({
    orgDetails: org,
    aboutDetails: { emails: list(blob.aboutDetails?.emails, org.email), phones: list(blob.aboutDetails?.phones, org.organization_phone) },
    settings,
    imageCount: counts.rows[0].images,
    articleCount: counts.rows[0].articles,
    layout: blob.layout,
    theme: blob.theme,
    registration: websiteExtras.registrationState(org),
    unreadMessages: unread,
  });
  const visible = websiteExtras.visibleSections(settings);
  const sections = {};
  websiteExtras.SECTION_KEYS.forEach((key) => {
    sections[key] = { ...settings[key], liveOnWebsite: Boolean(visible[key]) };
  });
  return { overview, sections };
}

const SECTION_ITEM_LABEL = (item) => String(item?.title || item?.name || item?.question || item?.label || item?.quote || "").trim().toLowerCase();

function hiddenReason(key, section) {
  if (key === "page") return "";
  if (key === "about") return section.imageUrl ? "" : "No photo yet.";
  if (key === "contact") return !section.enabled ? "The contact form is switched off." : !section.notifyEmail ? "It needs the school email address messages should go to." : "";
  if (!section.enabled) return "The section is switched off.";
  if (!section.items || !section.items.length) return "It has no items yet.";
  return "";
}

// POST /internal/api/website/sections/save
// { section, enabled?, title?, intro?, items? (replace), addItems?, updateItems? [{match, ...}],
//   removeItems? [names], notifyEmail?, address?, officeHours?, showMap?, imageUrl?, imageCaption?, confirm? }
async function saveWebsiteSectionApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const body = req.body || {};
    const key = String(body.section || "");
    if (!websiteExtras.SECTION_KEYS.includes(key)) {
      return res.status(400).json({ error: `Unknown section. Use one of: ${websiteExtras.SECTION_KEYS.join(", ")}.` });
    }
    const settings = await websiteExtras.getWebsiteSettings(db, organizationId);
    const current = settings[key];
    const next = { ...current };
    ["title", "intro", "notifyEmail", "address", "officeHours", "imageUrl", "imageCaption"].forEach((field) => {
      if (typeof body[field] === "string") next[field] = body[field];
    });
    if (typeof body.enabled === "boolean") next.enabled = body.enabled;
    if (typeof body.showMap === "boolean") next.showMap = body.showMap;
    if (key === "page") {
      if (Array.isArray(body.order)) next.order = body.order;
      if (Array.isArray(body.hidden)) next.hidden = body.hidden;
      if (body.titles && typeof body.titles === "object") next.titles = { ...(current.titles || {}), ...body.titles };
    }

    const notFound = [];
    if (Array.isArray(current.items)) {
      let items = Array.isArray(body.items) ? body.items : current.items.map((item) => ({ ...item }));
      (Array.isArray(body.updateItems) ? body.updateItems : []).forEach((change) => {
        const match = String(change?.match || "").trim().toLowerCase();
        const target = items.find((item) => SECTION_ITEM_LABEL(item) === match) || items.find((item) => match && SECTION_ITEM_LABEL(item).includes(match));
        if (!target) return notFound.push(change?.match);
        Object.keys(change).forEach((field) => { if (field !== "match" && change[field] !== undefined && change[field] !== null) target[field] = change[field]; });
      });
      if (Array.isArray(body.removeItems) && body.removeItems.length) {
        const drop = body.removeItems.map((name) => String(name || "").trim().toLowerCase()).filter(Boolean);
        drop.forEach((name) => { if (!items.some((item) => SECTION_ITEM_LABEL(item) === name)) notFound.push(name); });
        items = items.filter((item) => !drop.includes(SECTION_ITEM_LABEL(item)));
      }
      if (Array.isArray(body.addItems)) items = items.concat(body.addItems);
      const limit = websiteExtras.LIMITS[key];
      if (limit && items.length > limit) {
        return res.status(400).json({ error: `This section holds up to ${limit} items - it would have ${items.length}. Remove some first.` });
      }
      next.items = items;
    }

    const section = websiteExtras.normalizeSection(key, next);
    if (Array.isArray(next.items) && section.items.length < next.items.length) {
      const required = { quickFacts: "a value and a label", programs: "a name", leadership: "a name", testimonials: "a quote and a name", faq: "a question and an answer" }[key];
      return res.status(400).json({ error: `Every item needs ${required}. ${next.items.length - section.items.length} item(s) are missing it.` });
    }
    if (key === "contact" && section.enabled && !section.notifyEmail) {
      return res.status(400).json({ error: "The contact form needs the school email address where messages should go. Ask the user for it." });
    }
    const reason = hiddenReason(key, section);
    if (body.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        section: key,
        willBe: section,
        liveOnWebsite: !reason,
        hiddenBecause: reason || undefined,
        notFound: notFound.length ? notFound : undefined,
        message: "Nothing saved yet. Show the user this content and save with confirm=true after they agree.",
      });
    }
    const saved = await websiteExtras.saveWebsiteSection(db, organizationId, key, section);
    return res.json({
      status: "saved",
      section: key,
      saved,
      liveOnWebsite: !reason,
      hiddenBecause: reason || undefined,
      notFound: notFound.length ? notFound : undefined,
      publicUrl: await websitePublicUrl(req, organizationId),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/saveWebsiteSectionApi]", error);
    return res.status(500).json({ error: "Unable to save the website section." });
  }
}

// POST /internal/api/website/sections/image { imageDataUrl } -> { imageUrl }
// For section photos (programs, leadership, about); not added to the gallery.
async function uploadWebsiteSectionImageApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const match = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,(.+)$/i.exec(String(req.body?.imageDataUrl || ""));
    if (!match) return res.status(400).json({ error: "Attach a JPG, PNG, WebP or GIF image." });
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) return res.status(400).json({ error: "The image data is empty." });
    if (buffer.length > WEBSITE_IMAGE_MAX_BYTES) return res.status(400).json({ error: "The image is too large (max 8MB)." });
    const mimeType = match[1].toLowerCase().replace("jpg", "jpeg");
    const extension = mimeType.split("/")[1] === "jpeg" ? "jpg" : mimeType.split("/")[1];
    const key = `images/website/org_${organizationId}/mira-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${extension}`;
    const imageUrl = await uploadToS3({ buffer, mimetype: mimeType, originalname: `mira-section.${extension}` }, key);
    return res.json({ imageUrl });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/uploadWebsiteSectionImageApi]", error);
    return res.status(500).json({ error: "Unable to upload the image." });
  }
}

// GET /internal/api/website/messages?status=new|read|archived
async function listWebsiteMessagesApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsiteQuery(req);
    await websiteExtras.ensureWebsiteSchema(db);
    const status = ["new", "read", "archived"].includes(req.query.status) ? req.query.status : null;
    const rows = (await db.query(
      `SELECT name, email, phone, subject, message, status, created_at
       FROM website_contact_messages
       WHERE organization_id = $1 AND ($2::text IS NULL OR status = $2) AND ($2::text IS NOT NULL OR status <> 'archived')
       ORDER BY created_at DESC LIMIT 25`,
      [organizationId, status]
    )).rows;
    return res.json({
      messages: rows.map((r) => ({ ...r, message: r.message.length > 600 ? `${r.message.slice(0, 600)}...` : r.message })),
      unread: rows.filter((r) => r.status === "new").length,
      note: "Replies go by email from the user's own mailbox. Staff manage messages in Manage Website > Contact Form & Messages.",
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listWebsiteMessagesApi]", error);
    return res.status(500).json({ error: "Unable to load website messages." });
  }
}

// POST /internal/api/website/images/upload
// { organizationId, ..., imageDataUrl (base64 data URL), caption, contentType? }
// Not delegated - see section header for why.
async function uploadWebsiteImageApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);

    const dataUrl = String(req.body?.imageDataUrl || "");
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      return res.status(400).json({ error: "imageDataUrl must be a base64 image data URL (e.g. from an image attached in chat)." });
    }
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) {
      return res.status(400).json({ error: "The image data is empty." });
    }
    if (buffer.length > WEBSITE_IMAGE_MAX_BYTES) {
      return res.status(400).json({ error: `Image is too large (max ${Math.round(WEBSITE_IMAGE_MAX_BYTES / (1024 * 1024))}MB).` });
    }

    const caption = String(req.body?.caption || "").trim();
    const contentType = WEBSITE_IMAGE_CONTENT_TYPES.has(req.body?.contentType) ? req.body.contentType : "siteImage";
    const extension = (mimeType.split("/")[1] || "jpg").split("+")[0];
    // Unique key, unlike the real browser path (which reuses the raw
    // uploaded filename verbatim and can silently overwrite a same-named
    // file within the org) - Mira has no real filename to begin with.
    const imageKey = `images/publicdashboard/${organizationId}/mira-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${extension}`;

    let slideshowId = null;
    if (contentType === "slideshow") {
      const inserted = await db.query(`INSERT INTO slideshows (organization_id) VALUES ($1) RETURNING slideshow_id`, [organizationId]);
      slideshowId = inserted.rows[0].slideshow_id;
    }

    const imageUrl = await uploadToS3({ buffer, mimetype: mimeType, originalname: `mira-upload.${extension}` }, imageKey);

    const inserted = await db.query(
      `INSERT INTO organization_images (organization_id, slideshow_id, image_url, caption, allocation) VALUES ($1, $2, $3, $4, $5) RETURNING image_id`,
      [organizationId, slideshowId, imageUrl, caption, contentType]
    );

    return res.json({ imageId: inserted.rows[0].image_id, imageUrl, caption, contentType, message: "Image published to the school website." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/uploadWebsiteImageApi]", error);
    return res.status(500).json({ error: "Unable to upload the image." });
  }
}

// POST /internal/api/website/images/update
// { organizationId, ..., imageId?, captionSnippet?, caption?, allocation? }
async function updateWebsiteImageApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const image = await resolveWebsiteImage(organizationId, { imageId: req.body?.imageId, captionSnippet: req.body?.captionSnippet });

    const caption = req.body?.caption !== undefined ? String(req.body.caption).trim() : image.caption;
    const allocation = req.body?.allocation !== undefined ? String(req.body.allocation).trim() : image.allocation;
    // accountController.updateImagePost does a raw SQL UPDATE with no validation of its own
    // (the real browser form only ever offers "hero"/"slideshow" via a <select>, which is a
    // client-side constraint only) - the model's tool-schema enum shapes what it's likely to
    // send but isn't a hard boundary, so this internal API - the actual trust boundary - must
    // enforce the whitelist itself.
    if (!WEBSITE_IMAGE_ALLOCATIONS.has(allocation)) {
      return res.status(400).json({ error: `allocation must be one of: ${[...WEBSITE_IMAGE_ALLOCATIONS].join(", ")}.` });
    }

    // accountController's handlers are flash-only (always call req.flash +
    // res.redirect, on both success AND error, with no status-code
    // distinction) - delegateToController can't tell those apart, so this
    // uses the same flash-capture pattern as the rest of this file instead.
    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { imageId: image.image_id, caption, allocation }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updateImagePost(fakeReq, fakeRes);
    const flashError = capture.errorEntry();
    if (flashError) {
      const err = new Error(flashError.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ imageId: image.image_id, caption, allocation, message: "Website image updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/updateWebsiteImageApi]", error);
    return res.status(500).json({ error: "Unable to update the website image." });
  }
}

// POST /internal/api/website/images/delete
// { organizationId, ..., imageId?, captionSnippet?, confirm }
async function deleteWebsiteImageApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const image = await resolveWebsiteImage(organizationId, { imageId: req.body?.imageId, captionSnippet: req.body?.captionSnippet });

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        imageId: image.image_id,
        caption: image.caption,
        warning: `Deleting this website image (${image.caption ? `"${image.caption}"` : `image #${image.image_id}`}) is permanent - it also removes the file itself, not just the listing. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, params: { imageId: image.image_id }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.deleteImageGet(fakeReq, fakeRes);
    const flashError = capture.errorEntry();
    if (flashError) {
      const err = new Error(flashError.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ imageId: image.image_id, message: "Website image deleted." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteWebsiteImageApi]", error);
    return res.status(500).json({ error: "Unable to delete the website image." });
  }
}

// POST /internal/api/website/articles/create
// { organizationId, ..., heading, paragraph }
async function createWebsiteArticleApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const heading = String(req.body?.heading || "").trim();
    const paragraph = String(req.body?.paragraph || "").trim();
    if (heading.length < 3 || heading.length > 100) return res.status(400).json({ error: "heading must be 3-100 characters." });
    if (paragraph.length < 10) return res.status(400).json({ error: "paragraph must be at least 10 characters." });

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { heading, paragraph }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.addTextSection(fakeReq, fakeRes);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ heading, message: "Article added to the school website." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createWebsiteArticleApi]", error);
    return res.status(500).json({ error: "Unable to create the article." });
  }
}

// POST /internal/api/website/articles/update
// { organizationId, ..., heading, newHeading?, paragraph? }
async function updateWebsiteArticleApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const article = await resolveWebsiteArticle(organizationId, req.body?.heading);

    const newHeading = req.body?.newHeading !== undefined ? String(req.body.newHeading).trim() : article.heading;
    const newParagraph = req.body?.paragraph !== undefined ? String(req.body.paragraph).trim() : article.paragraph;
    if (newHeading.length < 3 || newHeading.length > 100) return res.status(400).json({ error: "The heading must be 3-100 characters." });
    if (newParagraph.length < 10) return res.status(400).json({ error: "The paragraph must be at least 10 characters." });

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { textId: article.text_id, heading: newHeading, paragraph: newParagraph }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updateTextPost(fakeReq, fakeRes);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ heading: newHeading, message: "Article updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/updateWebsiteArticleApi]", error);
    return res.status(500).json({ error: "Unable to update the article." });
  }
}

// POST /internal/api/website/articles/delete
// { organizationId, ..., heading, confirm }
async function deleteWebsiteArticleApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const article = await resolveWebsiteArticle(organizationId, req.body?.heading);

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        heading: article.heading,
        warning: `Deleting the article "${article.heading}" is permanent. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, params: { textId: article.text_id }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.deleteTextGet(fakeReq, fakeRes);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ heading: article.heading, message: "Article deleted." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteWebsiteArticleApi]", error);
    return res.status(500).json({ error: "Unable to delete the article." });
  }
}

// POST /internal/api/website/about-us/update
// { organizationId, ..., aboutUs?, motto?, emails?, phones? } - each field
// omitted keeps its current value (fetched first), since the real handler
// always overwrites all of them together.
async function updateWebsiteAboutUsApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);

    const orgRows = await db.query(`SELECT aboutus, motto, email, organization_phone FROM organizations WHERE organization_id = $1`, [organizationId]);
    const org = orgRows.rows[0] || {};
    const { aboutDetails } = await getWebsiteDashboardBlob(organizationId);
    const currentEmails = Array.isArray(aboutDetails.emails) && aboutDetails.emails.length ? aboutDetails.emails : org.email ? [org.email] : [];
    const currentPhones = Array.isArray(aboutDetails.phones) && aboutDetails.phones.length ? aboutDetails.phones : org.organization_phone ? [org.organization_phone] : [];
    const currentMotto = (Array.isArray(aboutDetails.mottos) && aboutDetails.mottos[0]) || org.motto || "";

    const aboutUs = req.body?.aboutUs !== undefined ? String(req.body.aboutUs) : org.aboutus || "";
    const motto = req.body?.motto !== undefined ? String(req.body.motto) : currentMotto;
    const emails = Array.isArray(req.body?.emails) ? req.body.emails.map((e) => String(e || "").trim()).filter(Boolean) : currentEmails;
    const phones = Array.isArray(req.body?.phones) ? req.body.phones.map((p) => String(p || "").trim()).filter(Boolean) : currentPhones;

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { aboutUs, motto, contactEmails: emails, contactPhones: phones }, flash: () => {} };
    let redirected = false;
    let failed = null;
    const fakeRes = {
      redirect() { redirected = true; },
      status(code) {
        if (code >= 400) failed = code;
        return this;
      },
      send() {},
    };
    await accountController.updateAboutUsSection(fakeReq, fakeRes);
    if (failed || !redirected) {
      const err = new Error("Unable to update the About Us section.");
      err.status = failed || 500;
      throw err;
    }

    return res.json({ aboutUs, motto, emails, phones, message: "About Us section updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/updateWebsiteAboutUsApi]", error);
    return res.status(500).json({ error: "Unable to update the About Us section." });
  }
}

// POST /internal/api/website/layout/set
// { organizationId, ..., layout }
async function setWebsiteLayoutApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const layout = String(req.body?.layout || "").trim();
    if (!WEBSITE_LAYOUTS.has(layout)) {
      return res.status(400).json({ error: `layout must be one of: ${[...WEBSITE_LAYOUTS].join(", ")}.` });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { publicDashboardLayout: layout }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updatePublicDashboardLayoutPost(fakeReq, fakeRes);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ layout, message: "Website layout updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setWebsiteLayoutApi]", error);
    return res.status(500).json({ error: "Unable to update the website layout." });
  }
}

// POST /internal/api/website/theme/set
// { organizationId, ..., theme }
async function setWebsiteThemeApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);
    const theme = String(req.body?.theme || "").trim();
    if (!WEBSITE_THEMES.has(theme)) {
      return res.status(400).json({ error: `theme must be one of: ${[...WEBSITE_THEMES].join(", ")}.` });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { publicDashboardTheme: theme }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updatePublicDashboardThemePost(fakeReq, fakeRes);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ theme, message: "Website style updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setWebsiteThemeApi]", error);
    return res.status(500).json({ error: "Unable to update the website style." });
  }
}

// POST /internal/api/website/self-enrollment/set
// { organizationId, ..., enabled?, startDate?, endDate?, price?, currency? } -
// each field omitted keeps its current value (fetched first), since the
// real handler always overwrites all of them together.
async function setWebsiteSelfEnrollmentApi(req, res) {
  try {
    const organizationId = await assertCanManageWebsite(req);

    const orgRows = await db.query(
      `SELECT public_registration_enabled, registration_start_date, registration_end_date, public_registration_price, public_registration_currency
       FROM organizations WHERE organization_id = $1`,
      [organizationId]
    );
    const org = orgRows.rows[0] || {};

    const enabled = req.body?.enabled !== undefined ? req.body.enabled === true : org.public_registration_enabled === true;
    const startDate = req.body?.startDate !== undefined ? req.body.startDate : org.registration_start_date;
    const endDate = req.body?.endDate !== undefined ? req.body.endDate : org.registration_end_date;
    const price = req.body?.price !== undefined ? req.body.price : org.public_registration_price;
    const currency = req.body?.currency !== undefined ? String(req.body.currency).trim() : org.public_registration_currency || "USD";

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { enabled: enabled ? "on" : "off", startDate, endDate, price, currency }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updatePublicRegistration(fakeReq, fakeRes);

    const error = capture.errorEntry();
    if (error) {
      const err = new Error(error.msg);
      err.status = 409;
      throw err;
    }

    return res.json({ enabled, startDate, endDate, price, currency, message: "Self-enrollment settings updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setWebsiteSelfEnrollmentApi]", error);
    return res.status(500).json({ error: "Unable to update self-enrollment settings." });
  }
}

// ============================================================
// Assessments (Tests) - /common/manageAssessment. Same pattern as the
// School Years and Classes/Subjects sections above: read tools resolve by
// exact-ish name, write tools re-derive the caller's real MANAGE_ASSESSMENTS
// permission from the database, and the destructive delete delegates to
// the main app's own controller (now hardened - see the dependency check
// added to commonController.deleteAssessmentPost) rather than
// re-implementing its safety logic.
// A "test" is identified by `group_id`: one shared id fanned out across
// several `assessments` rows (one per class x subject pairing). Mira
// resolves a test by (termId, title) rather than a raw group_id, since
// that's what a user would actually say.
// ============================================================

async function assertCanManageAssessments(req) {
  return assertHasPermission(req, PERMISSIONS.MANAGE_ASSESSMENTS, "You don't have permission to manage assessments.");
}

// No termId given -> same "current term" fallback the Create Test page
// itself uses (commonController.js createTestGet), so Mira defaults to
// exactly what a human clicking "+ New Test" without picking a term would
// get, rather than inventing its own notion of "current."
async function resolveTermId(organizationId, termName, yearLabel) {
  if (termName) {
    // Term names are commonly reused every year ("1st Semester" in both
    // 2025-2026 and 2026-2027) - a bare name is ambiguous across an org's
    // history. yearLabel disambiguates by scoping to that school year;
    // without it, ambiguity is a real error rather than a silent guess.
    const params = [organizationId, termName];
    let yearFilter = "";
    if (yearLabel) {
      params.push(yearLabel);
      yearFilter = `AND EXISTS (SELECT 1 FROM school_years sy WHERE sy.id = t.school_year_id AND REPLACE(sy.year_label, ' ', '') = REPLACE($3, ' ', ''))`;
    }
    // Ordered so that, when the same term name exists in several school
    // years and no year was given, the current school year's term wins,
    // then the most recent one - "the 1st Semester" means this year's
    // unless the user says otherwise.
    const rows = await db.query(
      `SELECT t.term_id, t.term_name
       FROM terms t
       LEFT JOIN school_years sy ON sy.id = t.school_year_id
       WHERE t.organization_id = $1 AND LOWER(TRIM(t.term_name)) = LOWER(TRIM($2)) ${yearFilter}
       ORDER BY COALESCE(sy.current, FALSE) DESC,
                EXISTS (SELECT 1 FROM terms ct WHERE ct.school_year_id = t.school_year_id AND COALESCE(ct.current, FALSE)) DESC,
                t.start_date DESC NULLS LAST, t.term_id DESC`,
      params
    );
    if (!rows.rows.length) {
      const error = new Error(`No term named "${termName}"${yearLabel ? ` in school year "${yearLabel}"` : ""} was found.`);
      error.status = 404;
      throw error;
    }
    return rows.rows[0].term_id;
  }

  const current = await db.query(
    `SELECT term_id FROM terms
     WHERE organization_id = $1 AND (current = TRUE OR (start_date <= NOW() AND end_date >= NOW()))
     ORDER BY current DESC, start_date DESC LIMIT 1`,
    [organizationId]
  );
  if (!current.rows.length) {
    const error = new Error("No current term found for this school - specify a term name, or set one as current first.");
    error.status = 404;
    throw error;
  }
  return current.rows[0].term_id;
}

// Classes must be enrolled for the given term (same scoping
// commonController's createTestGet/modifyAssessmentGet use) - a class that
// simply exists but was never enrolled into that term can't be assigned a
// test for it.
async function resolveEnrolledClassIds(organizationId, termId, classNames) {
  const rows = await db.query(
    `SELECT c.class_id, c.class_name
     FROM enrolled_classes ec
     JOIN classes c ON ec.class_id = c.class_id
     WHERE ec.enrollment_id = (SELECT enrollment_id FROM enrollments WHERE term_id = $1 AND organization_id = $2 LIMIT 1)`,
    [termId, organizationId]
  );
  const byName = new Map(rows.rows.map((r) => [normalizeName(r.class_name), r]));
  const resolved = [];
  const notFound = [];
  for (const name of classNames) {
    const row = byName.get(normalizeName(name));
    if (row) resolved.push(row);
    else notFound.push(name);
  }
  if (notFound.length) {
    const error = new Error(`Class${notFound.length === 1 ? "" : "es"} not enrolled in this term: ${notFound.join(", ")}.`);
    error.status = 404;
    throw error;
  }
  return resolved;
}

// GET /internal/api/assessments?organizationId=63&termId=150 (or &termName=...)
async function listAssessments(req, res) {
  try {
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_ASSESSMENTS], "You don't have permission to view assessments.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });
    const termId = req.query.termId ? parseInt(req.query.termId, 10) : await resolveTermId(organizationId, req.query.termName, req.query.yearLabel);

    const result = await db.query(
      `SELECT a.group_id, a.title, a.weight, a.max_score, a.category, a.term_id,
              c.class_id, c.class_name, s.subject_name,
              BOOL_OR(COALESCE(a.is_locked, FALSE)) OVER (PARTITION BY a.group_id) AS is_locked,
              BOOL_AND(COALESCE(a.is_active, TRUE)) OVER (PARTITION BY a.group_id) AS is_active,
              MIN(a.edit_window_start) OVER (PARTITION BY a.group_id) AS edit_window_start,
              MAX(a.edit_window_end) OVER (PARTITION BY a.group_id) AS edit_window_end
       FROM assessments a
       LEFT JOIN classes c ON a.class_id = c.class_id
       LEFT JOIN subjects s ON a.subject_id = s.subject_id
       WHERE a.organization_id = $1 AND a.term_id = $2
       ORDER BY a.group_id, c.class_name, s.subject_name`,
      [organizationId, termId]
    );

    const byGroup = new Map();
    for (const row of result.rows) {
      if (!byGroup.has(row.group_id)) {
        byGroup.set(row.group_id, {
          group_id: row.group_id,
          title: row.title,
          weight: row.weight,
          max_score: row.max_score,
          category: row.category,
          term_id: row.term_id,
          is_locked: row.is_locked,
          is_active: row.is_active,
          edit_window_start: row.edit_window_start,
          edit_window_end: row.edit_window_end,
          assigned_classes: [],
        });
      }
      const group = byGroup.get(row.group_id);
      let classEntry = group.assigned_classes.find((c) => c.class_id === row.class_id);
      if (!classEntry) {
        classEntry = { class_id: row.class_id, class_name: row.class_name, subjects: [] };
        group.assigned_classes.push(classEntry);
      }
      if (row.subject_name) classEntry.subjects.push(row.subject_name);
    }

    return res.json({ termId, assessments: Array.from(byGroup.values()) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listAssessments]", error);
    return res.status(500).json({ error: "Unable to load assessments." });
  }
}

// Resolves (organizationId, termId, title) -> the group_id + a snapshot of
// its current class/subject assignments - shared by modify/delete/control/
// date-window below, all of which need to resolve a title to a real group
// first.
async function resolveAssessmentGroup(organizationId, termId, title) {
  const rows = await db.query(
    `SELECT a.group_id, a.class_id, a.subject_id, c.class_name, s.subject_name
     FROM assessments a
     JOIN classes c ON c.class_id = a.class_id
     JOIN subjects s ON s.subject_id = a.subject_id
     WHERE a.organization_id = $1 AND a.term_id = $2 AND LOWER(TRIM(a.title)) = LOWER(TRIM($3))`,
    [organizationId, termId, title]
  );
  if (!rows.rows.length) {
    const error = new Error(`No test named "${title}" was found for this term.`);
    error.status = 404;
    throw error;
  }
  const groupId = rows.rows[0].group_id;
  return { groupId, rows: rows.rows };
}

// POST /internal/api/assessments/create
// { organizationId, ..., termName?, testName, testWeight, maxScore, category, classNames, subjectName,
//   scaleBase?, editWindowStart?, editWindowEnd?, isLocked?, isActive?, notifyTeachers? }
// Delegates to commonController.createTestPost, which already does the
// group_id generation, per-class-x-subject fan-out insert, and teacher
// notifications - a from-scratch reimplementation would just be a second,
// divergent copy of that logic.
async function createTest(req, res) {
  try {
    const organizationId = await assertCanManageAssessments(req);

    const testName = String(req.body?.testName || "").trim();
    const testWeight = req.body?.testWeight;
    const maxScore = req.body?.maxScore;
    const category = String(req.body?.category || "").trim();
    const classNames = Array.isArray(req.body?.classNames) ? req.body.classNames.map((n) => String(n || "").trim()).filter(Boolean) : [];
    const subjectName = String(req.body?.subjectName || "").trim();

    if (!testName || testWeight == null || maxScore == null || !category || !classNames.length || !subjectName) {
      return res.status(400).json({ error: "testName, testWeight, maxScore, category, classNames, and subjectName are required." });
    }
    const ALLOWED_CATEGORIES = new Set(["Class Assessment", "Exams Assessment", "Other"]);
    if (!ALLOWED_CATEGORIES.has(category)) {
      return res.status(400).json({ error: `category must be one of: ${Array.from(ALLOWED_CATEGORIES).join(", ")}.` });
    }

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const classes = await resolveEnrolledClassIds(organizationId, termId, classNames);

    const subjectRows = await db.query(
      `SELECT subject_id, class_id FROM subjects WHERE organization_id = $1 AND LOWER(TRIM(subject_name)) = LOWER(TRIM($2)) AND class_id = ANY($3::int[])`,
      [organizationId, subjectName, classes.map((c) => c.class_id)]
    );
    const subjectByClass = new Map(subjectRows.rows.map((r) => [r.class_id, r.subject_id]));
    const missingSubject = classes.filter((c) => !subjectByClass.has(c.class_id));
    if (missingSubject.length) {
      return res.status(404).json({
        error: `Subject "${subjectName}" isn't assigned to: ${missingSubject.map((c) => c.class_name).join(", ")}. Use create_subject or assign_subject_to_classes first.`,
      });
    }

    const fakeReq = {
      body: {
        termId,
        tests: [
          {
            testName,
            testWeight,
            maxScore,
            category,
            scaleBase: req.body?.scaleBase,
            classes: classes.map((c) => String(c.class_id)),
            subjects: classes.map((c) => `${c.class_id}-${subjectByClass.get(c.class_id)}`),
            isLocked: req.body?.isLocked ?? false,
            isActive: req.body?.isActive ?? true,
            editWindowStart: req.body?.editWindowStart || null,
            editWindowEnd: req.body?.editWindowEnd || null,
            notifyTeachers: req.body?.notifyTeachers ?? false,
          },
        ],
      },
      session: { organizationId },
    };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
    };

    await commonController.createTestPost(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.error || "Unable to create test." });
    }
    return res.status(201).json({ termId, testName, classNames: classes.map((c) => c.class_name), subjectName, message: payload?.message });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createTest]", error);
    return res.status(500).json({ error: "Unable to create test." });
  }
}

// POST /internal/api/assessments/modify
// { organizationId, ..., termName?, title, newTestName?, testWeight?, maxScore?, category?, scaleBase? }
// Metadata-only (name/weight/max score/category/scale) - deliberately does
// NOT touch which classes/subjects a test is assigned to. Delegates to
// commonController.modifyAssessmentPost, passing back the test's CURRENT
// class/subject assignments unchanged, so its stale-row reconciliation
// logic (which preserves rows that already have scores, per
// commonController.js modifyAssessmentPost) never has anything to
// reconcile - reassignment is a materially riskier action left to the UI.
async function modifyTest(req, res) {
  try {
    const organizationId = await assertCanManageAssessments(req);

    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "title is required." });

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { groupId, rows } = await resolveAssessmentGroup(organizationId, termId, title);

    const current = await db.query(
      `SELECT title, weight, max_score, category, COALESCE(scale_base,100) AS scale_base,
              COALESCE(is_locked,FALSE) AS is_locked, COALESCE(is_active,TRUE) AS is_active,
              edit_window_start, edit_window_end
       FROM assessments WHERE group_id = $1 AND organization_id = $2 LIMIT 1`,
      [groupId, organizationId]
    );
    const existing = current.rows[0];

    const newTestName = req.body?.newTestName != null ? String(req.body.newTestName).trim() : existing.title;
    const testWeight = req.body?.testWeight ?? existing.weight;
    const maxScore = req.body?.maxScore ?? existing.max_score;
    const category = req.body?.category != null ? String(req.body.category).trim() : existing.category;
    if (category) {
      const ALLOWED_CATEGORIES = new Set(["Class Assessment", "Exams Assessment", "Other"]);
      if (!ALLOWED_CATEGORIES.has(category)) {
        return res.status(400).json({ error: `category must be one of: ${Array.from(ALLOWED_CATEGORIES).join(", ")}.` });
      }
    }

    const uniqueClassIds = [...new Set(rows.map((r) => r.class_id))];
    const subjectPairs = rows.map((r) => `${r.class_id}-${r.subject_id}`);

    const fakeReq = {
      body: {
        termId,
        groupId,
        testName: newTestName,
        testWeight,
        maxScore,
        category,
        scaleBase: req.body?.scaleBase ?? existing.scale_base,
        classes: uniqueClassIds.map(String),
        subjects: subjectPairs,
        isLocked: existing.is_locked,
        isActive: existing.is_active,
        editWindowStart: existing.edit_window_start,
        editWindowEnd: existing.edit_window_end,
      },
      session: { organizationId },
    };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
    };

    await commonController.modifyAssessmentPost(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.error || "Unable to modify test." });
    }
    return res.json({ groupId, oldTitle: title, newTitle: newTestName, weight: testWeight, maxScore, category });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/modifyTest]", error);
    return res.status(500).json({ error: "Unable to modify test." });
  }
}

// GET /internal/api/assessments/delete-impact?organizationId=&termId=&title=
// Read-only preview of how many student scores already exist for a test,
// so Mira can give an honest warning before the (now-blocked-if-non-zero)
// delete below.
async function getAssessmentDeleteImpact(req, res) {
  try {
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_ASSESSMENTS], "You don't have permission to manage assessments.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    const title = String(req.query.title || "").trim();
    if (!Number.isInteger(organizationId) || !title) return res.status(400).json({ error: "organizationId and title are required." });

    const termId = req.query.termId ? parseInt(req.query.termId, 10) : await resolveTermId(organizationId, req.query.termName, req.query.yearLabel);
    const { groupId, rows } = await resolveAssessmentGroup(organizationId, termId, title);

    const scoreCount = await db.query(
      `SELECT COUNT(*)::int AS count FROM assessment_results ar JOIN assessments a ON a.assessment_id = ar.assessment_id WHERE a.group_id = $1 AND a.organization_id = $2`,
      [groupId, organizationId]
    );

    return res.json({
      title,
      termId,
      classCount: new Set(rows.map((r) => r.class_id)).size,
      scoreCount: Number(scoreCount.rows[0]?.count || 0),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getAssessmentDeleteImpact]", error);
    return res.status(500).json({ error: "Unable to check test impact." });
  }
}

// POST /internal/api/assessments/delete
// { organizationId, ..., termName?, title } - delegates to the hardened
// commonController.deleteAssessmentPost (blocked if any student scores
// have already been entered for it).
async function deleteTest(req, res) {
  try {
    const organizationId = await assertCanManageAssessments(req);
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "title is required." });

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { groupId } = await resolveAssessmentGroup(organizationId, termId, title);

    const fakeReq = { body: { groupId }, session: { organizationId } };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
    };

    await commonController.deleteAssessmentPost(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.error || "Unable to delete test." });
    }
    return res.json({ groupId, title, termId });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteTest]", error);
    return res.status(500).json({ error: "Unable to delete test." });
  }
}

// POST /internal/api/assessments/control
// { organizationId, ..., termName?, title, action: "lock"|"unlock"|"activate"|"deactivate" }
// Non-destructive - just toggles is_locked/is_active for the whole group.
// Delegates to commonController.updateAssessmentControlPost.
async function setTestControl(req, res) {
  try {
    const organizationId = await assertCanManageAssessments(req);
    const title = String(req.body?.title || "").trim();
    const action = String(req.body?.action || "").trim().toLowerCase();
    const ALLOWED = new Set(["lock", "unlock", "activate", "deactivate"]);
    if (!title || !ALLOWED.has(action)) {
      return res.status(400).json({ error: `title is required, and action must be one of: ${Array.from(ALLOWED).join(", ")}.` });
    }

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { groupId } = await resolveAssessmentGroup(organizationId, termId, title);

    const fakeReq = { body: { groupId, termId, action }, session: { organizationId } };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(body) { payload = body; return this; },
    };

    await commonController.updateAssessmentControlPost(fakeReq, fakeRes, db);

    if (statusCode >= 400) {
      return res.status(statusCode).json({ error: payload?.error || "Unable to update test status." });
    }
    return res.json({ groupId, title, action });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setTestControl]", error);
    return res.status(500).json({ error: "Unable to update test status." });
  }
}

// POST /internal/api/assessments/date-window
// { organizationId, ..., termName?, title, editWindowStart?, editWindowEnd? }
// Metadata-only, non-destructive - a lightweight direct update rather than
// routing through modifyAssessmentPost's full class/subject reconciliation
// (nothing about class/subject assignment changes here).
async function setTestDateWindow(req, res) {
  try {
    const organizationId = await assertCanManageAssessments(req);
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "title is required." });

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { groupId } = await resolveAssessmentGroup(organizationId, termId, title);

    // A field that's genuinely omitted (undefined) leaves that bound
    // untouched; "" explicitly clears it; anything else is parsed as a
    // date. Fetching current values first is what makes "only change the
    // one field given" possible without a caller having to resend both.
    const current = await db.query(`SELECT edit_window_start, edit_window_end FROM assessments WHERE group_id = $1 AND organization_id = $2 LIMIT 1`, [
      groupId,
      organizationId,
    ]);
    const existing = current.rows[0] || {};

    const resolveBound = (fieldName, existingValue) => {
      if (!(fieldName in (req.body || {})) || req.body[fieldName] === undefined) return existingValue;
      if (req.body[fieldName] === "" || req.body[fieldName] === null) return null;
      const parsed = new Date(req.body[fieldName]);
      if (Number.isNaN(parsed.getTime())) {
        const error = new Error(`Invalid ${fieldName}.`);
        error.status = 400;
        throw error;
      }
      return parsed;
    };

    const start = resolveBound("editWindowStart", existing.edit_window_start);
    const end = resolveBound("editWindowEnd", existing.edit_window_end);
    if (start && end && new Date(start) > new Date(end)) {
      return res.status(400).json({ error: "editWindowStart must be before editWindowEnd." });
    }

    await db.query(`UPDATE assessments SET edit_window_start = $1, edit_window_end = $2 WHERE group_id = $3 AND organization_id = $4`, [
      start,
      end,
      groupId,
      organizationId,
    ]);

    return res.json({ groupId, title, editWindowStart: start, editWindowEnd: end });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setTestDateWindow]", error);
    return res.status(500).json({ error: "Unable to set test date window." });
  }
}

// ============================================================
// Assessment Questions - /common/allClassAssessmentExams. Every route the
// real UI uses here requires BOTH MANAGE_ASSESSMENTS and
// SET_ASSESSMENT_QUESTIONS (routes/commonRoute.js:373+); assertCanSetAssessmentQuestions
// mirrors that exactly. Almost everything below delegates to the main
// app's own controller functions (now hardened - see the two attempt-count
// guards added to upsertAssessmentQuestionSet/deleteAssessmentQuestionSet
// above) via a fake req/res, rather than re-implementing their business
// logic - these are some of the most complex write paths in the app
// (question-set/attempt/grading reconciliation), and re-deriving human
// names (class/subject/test/question-set) into the IDs those controllers
// expect is all the new code needs to do.
// ============================================================

async function assertCanSetAssessmentQuestions(req) {
  const orgId = await assertCanManageAssessments(req);
  const allowed = await userHasPermission(
    db,
    {
      userId: req.body?.userId,
      userRole: req.body?.userRole,
      organizationId: orgId,
      accountType: req.body?.accountType,
      userEmail: req.body?.userEmail,
    },
    PERMISSIONS.SET_ASSESSMENT_QUESTIONS
  );
  if (!allowed) {
    const error = new Error("You don't have permission to set assessment questions.");
    error.status = 403;
    throw error;
  }
  return orgId;
}

// Resolves human names -> the IDs the real controllers expect. Reused by
// every question-set endpoint below.
async function resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle) {
  const classRows = await db.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND LOWER(TRIM(class_name)) = LOWER(TRIM($2))`, [
    organizationId,
    className,
  ]);
  if (!classRows.rows.length) {
    const error = new Error(`No class named "${className}" was found.`);
    error.status = 404;
    throw error;
  }
  const classId = classRows.rows[0].class_id;

  const subjectRows = await db.query(
    `SELECT subject_id FROM subjects WHERE organization_id = $1 AND class_id = $2 AND LOWER(TRIM(subject_name)) = LOWER(TRIM($3))`,
    [organizationId, classId, subjectName]
  );
  if (!subjectRows.rows.length) {
    const error = new Error(`Subject "${subjectName}" isn't assigned to class "${className}".`);
    error.status = 404;
    throw error;
  }
  const subjectId = subjectRows.rows[0].subject_id;

  let assessmentId = null;
  let groupId = null;
  if (testTitle) {
    const assessmentRows = await db.query(
      `SELECT assessment_id, group_id FROM assessments WHERE organization_id = $1 AND term_id = $2 AND class_id = $3 AND subject_id = $4 AND LOWER(TRIM(title)) = LOWER(TRIM($5))`,
      [organizationId, termId, classId, subjectId, testTitle]
    );
    if (!assessmentRows.rows.length) {
      const error = new Error(`No test named "${testTitle}" was found for "${subjectName}" in "${className}" this term.`);
      error.status = 404;
      throw error;
    }
    assessmentId = assessmentRows.rows[0].assessment_id;
    groupId = assessmentRows.rows[0].group_id;
  }

  return { classId, subjectId, assessmentId, groupId };
}

// Resolves an EXISTING question set by (term, class, subject, test) scope -
// the same "most recently updated, non-retake-clone" row the real UI edits
// when a caller doesn't already have a questionSetId.
async function resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId) {
  const rows = await db.query(
    `SELECT question_set_id, set_title FROM assessment_question_sets
     WHERE organization_id = $1 AND term_id = $2 AND class_id = $3 AND subject_id = $4 AND assessment_id = $5 AND retake_student_id IS NULL
     ORDER BY question_set_id DESC LIMIT 1`,
    [organizationId, termId, classId, subjectId, assessmentId]
  );
  if (!rows.rows.length) {
    const error = new Error("No question set exists yet for this test - use set_test_questions to create one.");
    error.status = 404;
    throw error;
  }
  return rows.rows[0];
}

function fakeJsonRes() {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };
  return { res, get statusCode() { return statusCode; }, get payload() { return payload; } };
}

// GET /internal/api/assessments/question-sets?organizationId=&termId=&className=&subjectName=&testTitle?=
// Full question content (text, options, answer key) - this doubles as
// "student preview": reading the returned questions IS what a staff
// member sees when previewing the set.
async function listQuestionSets(req, res) {
  try {
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_ASSESSMENTS], "You don't have permission to view question sets.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    const className = String(req.query.className || "").trim();
    const subjectName = String(req.query.subjectName || "").trim();
    if (!Number.isInteger(organizationId) || !className || !subjectName) {
      return res.status(400).json({ error: "organizationId, className, and subjectName are required." });
    }
    const termId = req.query.termId ? parseInt(req.query.termId, 10) : await resolveTermId(organizationId, req.query.termName, req.query.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, req.query.testTitle);

    const fakeReq = {
      session: { organizationId },
      query: { classId: String(classId), subjectId: String(subjectId), termId: String(termId), assessmentId: assessmentId ? String(assessmentId) : undefined },
    };
    const fake = fakeJsonRes();
    await commonController.getAssessmentQuestionSets(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to load question sets." });
    return res.json(fake.payload);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listQuestionSets]", error);
    return res.status(500).json({ error: "Unable to load question sets." });
  }
}

// GET /internal/api/assessments/question-sets/overview?organizationId=&termId=(or termName/yearLabel)
// Term-wide summary: every question set that exists anywhere in the term,
// with its test/class/subject and question count - answers "how many
// questions do we have set (overall)" without the caller already knowing
// which class/subject to check. listQuestionSets above requires a specific
// class+subject because that's genuinely how the underlying data model
// works (one question set per class x subject x test) - this aggregates
// across all of them for a term-level view.
async function listQuestionSetsOverview(req, res) {
  try {
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_ASSESSMENTS], "You don't have permission to view question sets.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    if (!Number.isInteger(organizationId)) return res.status(400).json({ error: "organizationId is required." });
    const termId = req.query.termId ? parseInt(req.query.termId, 10) : await resolveTermId(organizationId, req.query.termName, req.query.yearLabel);

    const result = await db.query(
      `SELECT
         qs.question_set_id,
         qs.set_title,
         qs.review_status,
         qs.is_active,
         a.title AS test_title,
         c.class_name,
         s.subject_name,
         COUNT(q.question_id)::int AS question_count,
         COALESCE(SUM(q.marks), 0) AS total_marks
       FROM assessment_question_sets qs
       LEFT JOIN assessments a ON a.assessment_id = qs.assessment_id AND a.organization_id = qs.organization_id
       LEFT JOIN classes c ON c.class_id = qs.class_id AND c.organization_id = qs.organization_id
       LEFT JOIN subjects s ON s.subject_id = qs.subject_id AND s.organization_id = qs.organization_id
       LEFT JOIN assessment_questions q ON q.question_set_id = qs.question_set_id
       WHERE qs.organization_id = $1 AND qs.term_id = $2 AND qs.retake_student_id IS NULL
       GROUP BY qs.question_set_id, qs.set_title, qs.review_status, qs.is_active, a.title, c.class_name, s.subject_name
       ORDER BY a.title, c.class_name, s.subject_name`,
      [organizationId, termId]
    );

    const totalQuestions = result.rows.reduce((sum, row) => sum + Number(row.question_count || 0), 0);
    return res.json({ termId, questionSetCount: result.rows.length, totalQuestions, questionSets: result.rows });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listQuestionSetsOverview]", error);
    return res.status(500).json({ error: "Unable to load question set overview." });
  }
}

// POST /internal/api/assessments/question-sets/set
// { organizationId, ..., termName?, yearLabel?, className, subjectName, testTitle, setTitle, questions: [...],
//   openBook?, timeLimitMinutes?, maxAttempts? }
// Creates or replaces a test's question set (matching "Set Questions").
// Editing/replacing an existing set is BLOCKED if any student has already
// started/submitted an attempt on it (see the guard added to
// upsertAssessmentQuestionSet above). Auto-enables
// show_question_set_on_dashboard on the test if it isn't already - a brand
// new question set request is unambiguous intent to use one, and the real
// UI's "disabled" error otherwise reads as a confusing dead end here.
async function setTestQuestions(req, res) {
  try {
    const organizationId = await assertCanSetAssessmentQuestions(req);

    const className = String(req.body?.className || "").trim();
    const subjectName = String(req.body?.subjectName || "").trim();
    const testTitle = String(req.body?.testTitle || "").trim();
    const setTitle = String(req.body?.setTitle || "").trim();
    const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
    if (!className || !subjectName || !testTitle || !setTitle || !questions.length) {
      return res.status(400).json({ error: "className, subjectName, testTitle, setTitle, and at least one question are required." });
    }

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);

    await db.query(`UPDATE assessments SET show_question_set_on_dashboard = TRUE WHERE assessment_id = $1 AND organization_id = $2`, [
      assessmentId,
      organizationId,
    ]);

    let existingQuestionSetId = null;
    try {
      existingQuestionSetId = (await resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId)).question_set_id;
    } catch (_) {
      // No existing set - fine, this creates a new one.
    }

    const fakeReq = {
      session: { organizationId, userId: req.body?.userId },
      body: {
        classId,
        subjectId,
        termId,
        assessmentId,
        questionSetId: existingQuestionSetId,
        setTitle,
        setDescription: req.body?.setDescription,
        questionCardLayout: req.body?.questionCardLayout,
        openBook: req.body?.openBook,
        timeLimitMinutes: req.body?.timeLimitMinutes,
        maxAttempts: req.body?.maxAttempts,
        questions,
      },
    };
    const fake = fakeJsonRes();
    await commonController.upsertAssessmentQuestionSet(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to save question set." });
    return res.status(existingQuestionSetId ? 200 : 201).json({ ...fake.payload, className, subjectName, testTitle, questionCount: questions.length });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setTestQuestions]", error);
    return res.status(500).json({ error: "Unable to save question set." });
  }
}

// GET /internal/api/assessments/question-sets/delete-impact
// Preview of attempt/response counts before the (now-blocked-if-non-zero) delete/edit below.
async function getQuestionSetDeleteImpact(req, res) {
  try {
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_ASSESSMENTS], "You don't have permission to manage question sets.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    const className = String(req.query.className || "").trim();
    const subjectName = String(req.query.subjectName || "").trim();
    const testTitle = String(req.query.testTitle || "").trim();
    if (!Number.isInteger(organizationId) || !className || !subjectName || !testTitle) {
      return res.status(400).json({ error: "organizationId, className, subjectName, and testTitle are required." });
    }
    const termId = req.query.termId ? parseInt(req.query.termId, 10) : await resolveTermId(organizationId, req.query.termName, req.query.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);
    const { question_set_id: questionSetId, set_title: setTitle } = await resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId);

    const attemptCount = await db.query(`SELECT COUNT(*)::int AS count FROM student_assessment_attempts WHERE question_set_id = $1`, [questionSetId]);
    return res.json({ questionSetId, setTitle, attemptCount: Number(attemptCount.rows[0]?.count || 0) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getQuestionSetDeleteImpact]", error);
    return res.status(500).json({ error: "Unable to check question set impact." });
  }
}

// POST /internal/api/assessments/question-sets/delete
async function deleteQuestionSetApi(req, res) {
  try {
    const organizationId = await assertCanSetAssessmentQuestions(req);
    const className = String(req.body?.className || "").trim();
    const subjectName = String(req.body?.subjectName || "").trim();
    const testTitle = String(req.body?.testTitle || "").trim();
    if (!className || !subjectName || !testTitle) return res.status(400).json({ error: "className, subjectName, and testTitle are required." });

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);
    const { question_set_id: questionSetId, set_title: setTitle } = await resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId);

    const fakeReq = { session: { organizationId, userId: req.body?.userId }, body: { questionSetId } };
    const fake = fakeJsonRes();
    await commonController.deleteAssessmentQuestionSet(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to delete question set." });
    return res.json({ questionSetId, setTitle, className, subjectName, testTitle });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteQuestionSetApi]", error);
    return res.status(500).json({ error: "Unable to delete question set." });
  }
}

// POST /internal/api/assessments/question-sets/review
// { ..., className, subjectName, testTitle, action: "approve"|"reject", reviewNote? }
async function reviewQuestionSetApi(req, res) {
  try {
    const organizationId = await assertCanSetAssessmentQuestions(req);
    const className = String(req.body?.className || "").trim();
    const subjectName = String(req.body?.subjectName || "").trim();
    const testTitle = String(req.body?.testTitle || "").trim();
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!className || !subjectName || !testTitle || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "className, subjectName, testTitle, and action (approve/reject) are required." });
    }

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);
    const { question_set_id: questionSetId, set_title: setTitle } = await resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId);

    const fakeReq = { session: { organizationId, userId: req.body?.userId }, body: { questionSetId, action, reviewNote: req.body?.reviewNote } };
    const fake = fakeJsonRes();
    await commonController.reviewAssessmentQuestionSet(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to review question set." });
    return res.json({ ...fake.payload, setTitle, className, subjectName, testTitle });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/reviewQuestionSetApi]", error);
    return res.status(500).json({ error: "Unable to review question set." });
  }
}

// POST /internal/api/assessments/question-sets/reuse
// { ..., className, subjectName, testTitle, targetTermName?, targetYearLabel?, targetClassName, targetSubjectName, targetTestTitle, shuffleMode?, shuffleOptions? }
async function reuseQuestionSetApi(req, res) {
  try {
    const organizationId = await assertCanSetAssessmentQuestions(req);
    const className = String(req.body?.className || "").trim();
    const subjectName = String(req.body?.subjectName || "").trim();
    const testTitle = String(req.body?.testTitle || "").trim();
    const targetClassName = String(req.body?.targetClassName || "").trim();
    const targetSubjectName = String(req.body?.targetSubjectName || "").trim();
    const targetTestTitle = String(req.body?.targetTestTitle || "").trim();
    if (!className || !subjectName || !testTitle || !targetClassName || !targetSubjectName || !targetTestTitle) {
      return res.status(400).json({
        error: "className, subjectName, testTitle (the source), and targetClassName, targetSubjectName, targetTestTitle (the destination) are required.",
      });
    }

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);
    const { question_set_id: sourceQuestionSetId } = await resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId);

    const targetTermId = await resolveTermId(organizationId, req.body?.targetTermName || req.body?.termName, req.body?.targetYearLabel || req.body?.yearLabel);
    const targetClassRows = await db.query(`SELECT class_id FROM classes WHERE organization_id = $1 AND LOWER(TRIM(class_name)) = LOWER(TRIM($2))`, [
      organizationId,
      targetClassName,
    ]);
    if (!targetClassRows.rows.length) return res.status(404).json({ error: `No class named "${targetClassName}" was found.` });
    const targetClassId = targetClassRows.rows[0].class_id;

    const targetSubjectRows = await db.query(
      `SELECT subject_id FROM subjects WHERE organization_id = $1 AND class_id = $2 AND LOWER(TRIM(subject_name)) = LOWER(TRIM($3))`,
      [organizationId, targetClassId, targetSubjectName]
    );
    if (!targetSubjectRows.rows.length) return res.status(404).json({ error: `Subject "${targetSubjectName}" isn't assigned to class "${targetClassName}".` });
    const targetSubjectId = targetSubjectRows.rows[0].subject_id;

    const fakeReq = {
      session: { organizationId, userId: req.body?.userId },
      body: {
        sourceQuestionSetId,
        targetTermId,
        targetClassId,
        targetSubjectId,
        targetAssessmentTitle: targetTestTitle,
        shuffleMode: req.body?.shuffleMode,
        shuffleOptions: req.body?.shuffleOptions,
      },
    };
    const fake = fakeJsonRes();
    await commonController.reuseAssessmentQuestionSet(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to reuse question set." });
    return res.status(201).json({ ...fake.payload, targetClassName, targetSubjectName, targetTestTitle });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/reuseQuestionSetApi]", error);
    return res.status(500).json({ error: "Unable to reuse question set." });
  }
}

// GET /internal/api/assessments/question-sets/students
async function listQuestionSetStudents(req, res) {
  try {
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_ASSESSMENTS], "You don't have permission to view question set results.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    const className = String(req.query.className || "").trim();
    const subjectName = String(req.query.subjectName || "").trim();
    const testTitle = String(req.query.testTitle || "").trim();
    if (!Number.isInteger(organizationId) || !className || !subjectName || !testTitle) {
      return res.status(400).json({ error: "organizationId, className, subjectName, and testTitle are required." });
    }
    const termId = req.query.termId ? parseInt(req.query.termId, 10) : await resolveTermId(organizationId, req.query.termName, req.query.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);
    const { question_set_id: questionSetId } = await resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId);

    const fakeReq = { session: { organizationId }, query: { questionSetId: String(questionSetId) } };
    const fake = fakeJsonRes();
    await commonController.getAssessmentQuestionSetStudents(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to load students." });
    return res.json(fake.payload);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listQuestionSetStudents]", error);
    return res.status(500).json({ error: "Unable to load students." });
  }
}

// POST /internal/api/assessments/question-sets/post-scores
// POST /internal/api/assessments/question-sets/unpost-scores
async function postQuestionSetScoresApi(req, res) {
  return runScorePostAction(req, res, commonController.postAssessmentQuestionSetScores, "postedCount");
}
async function unpostQuestionSetScoresApi(req, res) {
  return runScorePostAction(req, res, commonController.unpostAssessmentQuestionSetScores, "unpostedCount");
}
async function runScorePostAction(req, res, controllerFn, countKey) {
  try {
    const organizationId = await assertCanSetAssessmentQuestions(req);
    const className = String(req.body?.className || "").trim();
    const subjectName = String(req.body?.subjectName || "").trim();
    const testTitle = String(req.body?.testTitle || "").trim();
    if (!className || !subjectName || !testTitle) return res.status(400).json({ error: "className, subjectName, and testTitle are required." });

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);
    const { question_set_id: questionSetId } = await resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId);

    const fakeReq = { session: { organizationId }, body: { questionSetId } };
    const fake = fakeJsonRes();
    await controllerFn(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to update scores." });
    return res.json({ ...fake.payload, className, subjectName, testTitle, count: fake.payload?.[countKey] });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/runScorePostAction]", error);
    return res.status(500).json({ error: "Unable to update scores." });
  }
}

// POST /internal/api/assessments/question-sets/student-status
// { ..., className, subjectName, testTitle, studentName? OR unlockAll, action: "lock"|"unlock", reshuffleQuestions? }
// "unlock" is DESTRUCTIVE - it wipes the student's existing attempt,
// answers, and any posted score so they can retake (see the warning built
// into the Mira tool calling this).
async function setStudentAssessmentStatusApi(req, res) {
  try {
    const organizationId = await assertCanSetAssessmentQuestions(req);
    const className = String(req.body?.className || "").trim();
    const subjectName = String(req.body?.subjectName || "").trim();
    const testTitle = String(req.body?.testTitle || "").trim();
    const action = String(req.body?.action || "").trim().toLowerCase();
    const unlockAll = Boolean(req.body?.unlockAll);
    const studentName = String(req.body?.studentName || "").trim();
    if (!className || !subjectName || !testTitle || !["lock", "unlock"].includes(action) || (!unlockAll && !studentName)) {
      return res.status(400).json({ error: "className, subjectName, testTitle, action (lock/unlock), and either studentName or unlockAll are required." });
    }

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { classId, subjectId, assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);
    const { question_set_id: questionSetId } = await resolveQuestionSetId(organizationId, termId, classId, subjectId, assessmentId);

    let studentId = null;
    if (!unlockAll) {
      const studentRows = await db.query(
        `SELECT student_id FROM students WHERE organization_id = $1 AND (first_name || ' ' || last_name) ILIKE $2`,
        [organizationId, `%${studentName}%`]
      );
      if (!studentRows.rows.length) return res.status(404).json({ error: `No student matching "${studentName}" was found.` });
      if (studentRows.rows.length > 1) return res.status(409).json({ error: `More than one student matches "${studentName}"; be more specific.` });
      studentId = studentRows.rows[0].student_id;
    }

    const fakeReq = {
      session: { organizationId, userId: req.body?.userId },
      body: { questionSetId, studentId, unlockAll, action, reshuffleQuestions: req.body?.reshuffleQuestions },
    };
    const fake = fakeJsonRes();
    await commonController.unlockAssessmentQuestionSetStudents(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to update student status." });
    return res.json({ ...fake.payload, className, subjectName, testTitle, studentName: studentName || null, unlockAll });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setStudentAssessmentStatusApi]", error);
    return res.status(500).json({ error: "Unable to update student status." });
  }
}

// GET /internal/api/assessments/question-sets/grade?...&studentName=
async function getAttemptForGradingApi(req, res) {
  try {
    try {
      await assertHasAnyPermissionQuery(req, [PERMISSIONS.MANAGE_ASSESSMENTS], "You don't have permission to grade question sets.");
    } catch (permissionError) {
      return sendPermissionError(res, permissionError);
    }
    const organizationId = parseInt(req.query.organizationId, 10);
    const className = String(req.query.className || "").trim();
    const subjectName = String(req.query.subjectName || "").trim();
    const testTitle = String(req.query.testTitle || "").trim();
    const studentName = String(req.query.studentName || "").trim();
    if (!Number.isInteger(organizationId) || !className || !subjectName || !testTitle || !studentName) {
      return res.status(400).json({ error: "organizationId, className, subjectName, testTitle, and studentName are required." });
    }
    const termId = req.query.termId ? parseInt(req.query.termId, 10) : await resolveTermId(organizationId, req.query.termName, req.query.yearLabel);
    const { assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);

    const attemptRows = await db.query(
      `SELECT saa.attempt_id FROM student_assessment_attempts saa
       JOIN students st ON st.student_id = saa.student_id AND st.organization_id = saa.organization_id
       WHERE saa.organization_id = $1 AND saa.assessment_id = $2 AND (st.first_name || ' ' || st.last_name) ILIKE $3
       ORDER BY saa.submitted_at DESC NULLS LAST, saa.updated_at DESC LIMIT 1`,
      [organizationId, assessmentId, `%${studentName}%`]
    );
    if (!attemptRows.rows.length) return res.status(404).json({ error: `No attempt found for a student matching "${studentName}" on this test.` });

    const fakeReq = { session: { organizationId }, query: { attemptId: String(attemptRows.rows[0].attempt_id) } };
    const fake = fakeJsonRes();
    await commonController.getAssessmentAttemptForGrading(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to load attempt." });
    return res.json(fake.payload);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getAttemptForGradingApi]", error);
    return res.status(500).json({ error: "Unable to load attempt for grading." });
  }
}

// POST /internal/api/assessments/question-sets/grade
// { ..., className, subjectName, testTitle, studentName, marks: {questionId: value, ...} }
async function saveAttemptGradeApi(req, res) {
  try {
    const organizationId = await assertCanSetAssessmentQuestions(req);
    const className = String(req.body?.className || "").trim();
    const subjectName = String(req.body?.subjectName || "").trim();
    const testTitle = String(req.body?.testTitle || "").trim();
    const studentName = String(req.body?.studentName || "").trim();
    const marks = req.body?.marks && typeof req.body.marks === "object" ? req.body.marks : null;
    if (!className || !subjectName || !testTitle || !studentName || !marks) {
      return res.status(400).json({ error: "className, subjectName, testTitle, studentName, and marks are required." });
    }

    const termId = await resolveTermId(organizationId, req.body?.termName, req.body?.yearLabel);
    const { assessmentId } = await resolveClassSubjectAssessment(organizationId, termId, className, subjectName, testTitle);

    const attemptRows = await db.query(
      `SELECT saa.attempt_id FROM student_assessment_attempts saa
       JOIN students st ON st.student_id = saa.student_id AND st.organization_id = saa.organization_id
       WHERE saa.organization_id = $1 AND saa.assessment_id = $2 AND (st.first_name || ' ' || st.last_name) ILIKE $3
       ORDER BY saa.submitted_at DESC NULLS LAST, saa.updated_at DESC LIMIT 1`,
      [organizationId, assessmentId, `%${studentName}%`]
    );
    if (!attemptRows.rows.length) return res.status(404).json({ error: `No attempt found for a student matching "${studentName}" on this test.` });

    const fakeReq = { session: { organizationId }, body: { attemptId: attemptRows.rows[0].attempt_id, marks } };
    const fake = fakeJsonRes();
    await commonController.saveAssessmentAttemptGrade(fakeReq, fake.res, db);
    if (fake.statusCode >= 400) return res.status(fake.statusCode).json({ error: fake.payload?.error || "Unable to save grade." });
    return res.json({ ...fake.payload, className, subjectName, testTitle, studentName });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/saveAttemptGradeApi]", error);
    return res.status(500).json({ error: "Unable to save grade." });
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

// ============================================================
// Documents / Sheets - /documents ("Docs/Sheets"). Content is a single JSON
// blob per document, replaced wholesale on save - a Quill Delta
// (`{ops:[...]}`) for doc_type='document', or `{cells, colCount, rowCount}`
// (a sparse "A1"->value map) for doc_type='spreadsheet'. There is no
// cell-level or paragraph-level API server-side, so every write tool below
// fetches the current blob, merges the change in JS, and writes the whole
// thing back through the real saveDocument handler (delegated, not
// reimplemented) - same for permissions/class-assignments: updatePermissions
// is a destructive replace-all for each of document_permissions and
// document_class_assignments independently, so share/assign tools fetch the
// current list first and resend the full merged array, or they'd silently
// wipe every other share/assignment.
// Access has two independent layers, exactly mirrored from
// documentController.js's own logic (never guessed): the org-wide
// MANAGE_RECORDS permission (create/delete/edit-permissions/insert-class-
// data/see-all-org-docs), and a per-document permission_level ('view'/
// 'comment'/'edit') granted either directly (document_permissions) or via a
// class assignment the caller is a user_classes member of
// (document_class_assignments). A document's creator and any MANAGE_RECORDS
// holder always get 'edit' on every doc, permission table row or not.
// ============================================================

async function delegateToDocumentController(controllerFn, identity, body, params = {}) {
  // updatePermissions emails newly-assigned classes' teachers a link built
  // from req.protocol + req.get("host") (same pattern as createDriverPost
  // in the Transportation section) - without these the email send throws
  // and is silently swallowed by that handler's own try/catch, so the
  // notification just never goes out.
  const { protocol, host } = publicBaseUrlParts();
  const fakeReq = {
    session: { organizationId: identity.organizationId, userId: identity.userId, userRole: identity.userRole, accountType: identity.accountType },
    body,
    params,
    protocol,
    get(header) {
      return header === "host" ? host : undefined;
    },
  };
  let statusCode = 200;
  let payload = null;
  const fakeRes = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
  };
  await controllerFn(fakeReq, fakeRes, db);
  if (statusCode >= 400 || payload?.success === false) {
    const error = new Error(payload?.message || "The action failed.");
    error.status = statusCode >= 400 ? statusCode : 500;
    throw error;
  }
  return payload;
}

function docIdentity(req) {
  return {
    organizationId: Number(req.body?.organizationId ?? req.query?.organizationId) || null,
    userId: Number(req.body?.userId ?? req.query?.userId) || null,
    userRole: req.body?.userRole ?? req.query?.userRole,
    accountType: req.body?.accountType ?? req.query?.accountType,
  };
}

async function resolveDocument(organizationId, { documentId, title }) {
  await ensureDocumentsSchema(db);
  if (documentId) {
    const rows = await db.query(
      `SELECT d.*, u.first_name || ' ' || u.last_name AS created_by_name FROM documents d JOIN users u ON d.created_by = u.user_id WHERE d.id = $1 AND d.organization_id = $2 AND d.is_deleted = FALSE`,
      [documentId, organizationId]
    );
    if (!rows.rows.length) {
      const error = new Error(`No document with id ${documentId} was found.`);
      error.status = 404;
      throw error;
    }
    return rows.rows[0];
  }
  const trimmed = String(title || "").trim();
  if (!trimmed) {
    const error = new Error("A documentId or the document's title is required to identify it.");
    error.status = 400;
    throw error;
  }
  const rows = await db.query(
    `SELECT d.*, u.first_name || ' ' || u.last_name AS created_by_name FROM documents d JOIN users u ON d.created_by = u.user_id WHERE d.organization_id = $1 AND d.is_deleted = FALSE AND d.title ILIKE $2`,
    [organizationId, `%${trimmed}%`]
  );
  if (!rows.rows.length) {
    const error = new Error(`No document titled "${title}" was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one document is titled "${title}" - use list_documents to get the exact documentId.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

async function getDocumentPermissionLevel(organizationId, userId, userRole, doc) {
  const canManageRecords = await userHasPermission(db, { userId, userRole, organizationId }, PERMISSIONS.MANAGE_RECORDS);
  if (doc.created_by === userId || canManageRecords) return { level: "edit", canManageRecords };
  const permResult = await db.query(`SELECT permission_level FROM document_permissions WHERE document_id = $1 AND user_id = $2`, [doc.id, userId]);
  if (permResult.rows.length) return { level: permResult.rows[0].permission_level, canManageRecords };
  const classPermResult = await db.query(
    `SELECT dca.permission_level FROM document_class_assignments dca
     JOIN user_classes ce ON dca.class_id = ce.class_id
     JOIN classes c ON c.class_id = dca.class_id AND c.organization_id = $3
     WHERE dca.document_id = $1 AND ce.user_id = $2 LIMIT 1`,
    [doc.id, userId, organizationId]
  );
  if (classPermResult.rows.length) return { level: classPermResult.rows[0].permission_level, canManageRecords };
  return { level: null, canManageRecords };
}

async function assertDocumentAccess(organizationId, userId, userRole, doc, { requireEdit = false } = {}) {
  const { level, canManageRecords } = await getDocumentPermissionLevel(organizationId, userId, userRole, doc);
  if (!level) {
    const error = new Error(`You don't have access to "${doc.title}".`);
    error.status = 403;
    throw error;
  }
  if (requireEdit && level !== "edit") {
    const error = new Error(`You only have "${level}" access to "${doc.title}", not edit access.`);
    error.status = 403;
    throw error;
  }
  return { level, canManageRecords };
}

async function resolveClassByName(organizationId, className) {
  const trimmed = String(className || "").trim();
  if (!trimmed) {
    const error = new Error("A class name is required.");
    error.status = 400;
    throw error;
  }
  // Exact (case-insensitive) match first - a bare substring ILIKE is
  // genuinely ambiguous for real class-naming conventions like "SS 1" vs
  // "JSS 1" (the former is literally a trailing substring of the latter),
  // which made every "SS 1"/"SS 2"/"SS 3" lookup falsely 409 as ambiguous
  // against orgs that also have "JSS 1"/"JSS 2"/"JSS 3". Only fall back to
  // a substring search (for genuine typo-tolerance) when nothing matches
  // exactly.
  const exact = await db.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND LOWER(TRIM(class_name)) = LOWER(TRIM($2))`, [organizationId, trimmed]);
  if (exact.rows.length === 1) return exact.rows[0];
  if (exact.rows.length > 1) {
    const error = new Error(`More than one class is exactly named "${className}" - use list_students or get_class to pick by classId.`);
    error.status = 409;
    throw error;
  }
  const rows = await db.query(`SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND class_name ILIKE $2`, [organizationId, `%${trimmed}%`]);
  if (!rows.rows.length) {
    const error = new Error(`No class matching "${className}" was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one class matches "${className}" - use the exact class name.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

function parseSheetContent(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      cells: parsed.cells && typeof parsed.cells === "object" ? { ...parsed.cells } : {},
      colCount: Number.isInteger(parsed.colCount) ? parsed.colCount : 10,
      rowCount: Number.isInteger(parsed.rowCount) ? parsed.rowCount : 20,
    };
  } catch {
    return { cells: {}, colCount: 10, rowCount: 20 };
  }
}

function parseCellRef(ref) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(String(ref || "").trim());
  if (!match) return null;
  const [, colLetters, rowDigits] = match;
  let col = 0;
  for (const ch of colLetters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(rowDigits) };
}

// 1-indexed column number -> spreadsheet letters (1->A, 2->B, 27->AA), same
// base-26 scheme documentEditor.ejs's client-side colLabel() uses.
function colLabel(n) {
  let label = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    num = Math.floor((num - 1) / 26);
  }
  return label;
}

function extractPlainText(contentJson) {
  try {
    const delta = contentJson ? JSON.parse(contentJson) : { ops: [] };
    return (delta.ops || []).map((op) => (typeof op.insert === "string" ? op.insert : "")).join("");
  } catch {
    return "";
  }
}

function textToDelta(text) {
  const normalized = String(text || "");
  const withTrailingNewline = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  return JSON.stringify({ ops: [{ insert: withTrailingNewline }] });
}

// GET /internal/api/documents
async function listDocumentsApi(req, res) {
  try {
    const { organizationId, userId, userRole, accountType } = docIdentity(req);
    if (!organizationId) return res.status(400).json({ error: "organizationId is required." });
    await ensureDocumentsSchema(db);
    let classId = req.query.classId ? Number(req.query.classId) : null;
    if (!classId && req.query.className) {
      const cls = await resolveClassByName(organizationId, req.query.className);
      classId = cls.class_id;
    }
    const canManageRecords = await userHasPermission(db, { userId, userRole, organizationId, accountType }, PERMISSIONS.MANAGE_RECORDS);

    let rows;
    if (canManageRecords) {
      rows = await db.query(
        `SELECT d.id, d.title, d.doc_type, d.created_at, d.updated_at, d.created_by,
                u.first_name || ' ' || u.last_name AS created_by_name
         FROM documents d JOIN users u ON d.created_by = u.user_id
         WHERE d.organization_id = $1 AND d.is_deleted = FALSE
           ${classId ? "AND EXISTS (SELECT 1 FROM document_class_assignments dca WHERE dca.document_id = d.id AND dca.class_id = $2)" : ""}
         ORDER BY d.updated_at DESC`,
        classId ? [organizationId, classId] : [organizationId]
      );
    } else {
      rows = await db.query(
        `SELECT DISTINCT d.id, d.title, d.doc_type, d.created_at, d.updated_at, d.created_by,
                u.first_name || ' ' || u.last_name AS created_by_name
         FROM documents d
         JOIN users u ON d.created_by = u.user_id
         LEFT JOIN document_permissions dp ON d.id = dp.document_id AND dp.user_id = $2
         LEFT JOIN document_class_assignments dca ON d.id = dca.document_id
         LEFT JOIN user_classes ce ON ce.class_id = dca.class_id AND ce.user_id = $2
         WHERE d.organization_id = $1 AND d.is_deleted = FALSE
           AND (d.created_by = $2 OR dp.user_id IS NOT NULL OR ce.user_id IS NOT NULL)
           ${classId ? "AND EXISTS (SELECT 1 FROM document_class_assignments dca2 WHERE dca2.document_id = d.id AND dca2.class_id = $3)" : ""}
         ORDER BY d.updated_at DESC`,
        classId ? [organizationId, userId, classId] : [organizationId, userId]
      );
    }

    return res.json({
      documents: rows.rows.map((r) => ({
        documentId: r.id,
        title: r.title,
        docType: r.doc_type,
        createdBy: r.created_by_name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listDocumentsApi]", error);
    return res.status(500).json({ error: "Unable to load documents." });
  }
}

// GET /internal/api/documents/get?documentId= | title=
async function getDocumentApi(req, res) {
  try {
    const { organizationId, userId, userRole } = docIdentity(req);
    const doc = await resolveDocument(organizationId, { documentId: req.query.documentId, title: req.query.title });
    const { level } = await assertDocumentAccess(organizationId, userId, userRole, doc);

    const permsRows = await db.query(
      `SELECT dp.user_id, dp.permission_level, u.first_name || ' ' || u.last_name AS user_name
       FROM document_permissions dp JOIN users u ON dp.user_id = u.user_id
       WHERE dp.document_id = $1 AND u.organization_id = $2`,
      [doc.id, organizationId]
    );
    const classRows = await db.query(
      `SELECT dca.class_id, dca.permission_level, dca.include_students, dca.include_subjects, c.class_name
       FROM document_class_assignments dca JOIN classes c ON dca.class_id = c.class_id
       WHERE dca.document_id = $1 AND c.organization_id = $2`,
      [doc.id, organizationId]
    );

    const result = {
      documentId: doc.id,
      title: doc.title,
      docType: doc.doc_type,
      createdBy: doc.created_by_name,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      yourAccessLevel: level,
      sharedWith: permsRows.rows.map((r) => ({ userId: r.user_id, name: r.user_name, permissionLevel: r.permission_level })),
      assignedToClasses: classRows.rows.map((r) => ({
        classId: r.class_id,
        className: r.class_name,
        permissionLevel: r.permission_level,
        includeStudents: r.include_students,
        includeSubjects: r.include_subjects,
      })),
    };

    if (doc.doc_type === "spreadsheet") {
      const sheet = parseSheetContent(doc.content);
      result.rowCount = sheet.rowCount;
      result.colCount = sheet.colCount;
      result.cells = sheet.cells;
    } else {
      result.text = extractPlainText(doc.content);
    }

    return res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getDocumentApi]", error);
    return res.status(500).json({ error: "Unable to load the document." });
  }
}

// POST /internal/api/documents/create
async function createDocumentApi(req, res) {
  try {
    const identity = docIdentity(req);
    const title = String(req.body?.title || "").trim();
    const docType = req.body?.docType === "spreadsheet" ? "spreadsheet" : "document";
    const payload = await delegateToDocumentController(documentController.createDocument, identity, { title, doc_type: docType });
    return res.json({
      documentId: payload.documentId,
      title: title || (docType === "spreadsheet" ? "Untitled Spreadsheet" : "Untitled Document"),
      docType,
      message: "Document created.",
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createDocumentApi]", error);
    return res.status(500).json({ error: "Unable to create the document." });
  }
}

// POST /internal/api/documents/title/set
async function setDocumentTitleApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.currentTitle });
    await assertDocumentAccess(identity.organizationId, identity.userId, identity.userRole, doc, { requireEdit: true });
    const newTitle = String(req.body?.newTitle || "").trim();
    if (!newTitle) return res.status(400).json({ error: "newTitle is required." });
    await delegateToDocumentController(documentController.saveDocument, identity, { title: newTitle }, { id: doc.id });
    return res.json({ documentId: doc.id, title: newTitle, message: "Document renamed." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setDocumentTitleApi]", error);
    return res.status(500).json({ error: "Unable to rename the document." });
  }
}

// POST /internal/api/documents/text/set - doc_type='document' only
async function setDocumentTextApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    if (doc.doc_type !== "document") {
      const error = new Error(`"${doc.title}" is a spreadsheet, not a text document - use set_sheet_cells instead.`);
      error.status = 400;
      throw error;
    }
    await assertDocumentAccess(identity.organizationId, identity.userId, identity.userRole, doc, { requireEdit: true });
    const text = String(req.body?.text ?? "");
    const mode = req.body?.mode === "append" ? "append" : "replace";
    let finalText = text;
    if (mode === "append") {
      const existing = extractPlainText(doc.content);
      finalText = existing && !existing.endsWith("\n") ? `${existing}\n${text}` : `${existing}${text}`;
    }
    await delegateToDocumentController(documentController.saveDocument, identity, { content: textToDelta(finalText) }, { id: doc.id });
    return res.json({ documentId: doc.id, mode, message: "Document text updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setDocumentTextApi]", error);
    return res.status(500).json({ error: "Unable to update the document text." });
  }
}

// POST /internal/api/documents/sheet/cells/set - doc_type='spreadsheet' only
async function setSheetCellsApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    if (doc.doc_type !== "spreadsheet") {
      const error = new Error(`"${doc.title}" is a document, not a spreadsheet - use set_document_text instead.`);
      error.status = 400;
      throw error;
    }
    await assertDocumentAccess(identity.organizationId, identity.userId, identity.userRole, doc, { requireEdit: true });

    const sheet = parseSheetContent(doc.content);
    const cellsToSet = req.body?.cells && typeof req.body.cells === "object" ? req.body.cells : {};
    const cellsToClear = Array.isArray(req.body?.clearCells) ? req.body.clearCells : [];

    const invalidRefs = [];
    let maxCol = sheet.colCount;
    let maxRow = sheet.rowCount;
    for (const ref of [...Object.keys(cellsToSet), ...cellsToClear]) {
      const parsed = parseCellRef(ref);
      if (!parsed) { invalidRefs.push(ref); continue; }
      maxCol = Math.max(maxCol, parsed.col);
      maxRow = Math.max(maxRow, parsed.row);
    }
    if (invalidRefs.length) {
      const error = new Error(`Invalid cell reference(s): ${invalidRefs.join(", ")}. Use A1-style refs like "A1" or "C12".`);
      error.status = 400;
      throw error;
    }
    if (maxCol > 100 || maxRow > 500) {
      const error = new Error("That would grow the sheet beyond the 100-column / 500-row safety limit.");
      error.status = 400;
      throw error;
    }

    for (const [ref, value] of Object.entries(cellsToSet)) {
      const normalizedRef = ref.trim().toUpperCase();
      if (value === "" || value === null || value === undefined) delete sheet.cells[normalizedRef];
      else sheet.cells[normalizedRef] = String(value);
    }
    for (const ref of cellsToClear) {
      delete sheet.cells[String(ref).trim().toUpperCase()];
    }
    sheet.colCount = Math.max(sheet.colCount, maxCol);
    sheet.rowCount = Math.max(sheet.rowCount, maxRow);

    await delegateToDocumentController(documentController.saveDocument, identity, { content: JSON.stringify(sheet) }, { id: doc.id });
    return res.json({
      documentId: doc.id,
      cellsSet: Object.keys(cellsToSet).length,
      cellsCleared: cellsToClear.length,
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      message: "Sheet updated.",
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setSheetCellsApi]", error);
    return res.status(500).json({ error: "Unable to update the sheet." });
  }
}

// POST /internal/api/documents/sheet/resize - doc_type='spreadsheet' only, grow-only
async function resizeSheetApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    if (doc.doc_type !== "spreadsheet") {
      const error = new Error(`"${doc.title}" is a document, not a spreadsheet.`);
      error.status = 400;
      throw error;
    }
    await assertDocumentAccess(identity.organizationId, identity.userId, identity.userRole, doc, { requireEdit: true });
    const sheet = parseSheetContent(doc.content);
    const addRows = Number.isFinite(req.body?.addRows) ? Math.max(0, Math.trunc(req.body.addRows)) : 0;
    const addCols = Number.isFinite(req.body?.addCols) ? Math.max(0, Math.trunc(req.body.addCols)) : 0;
    if (!addRows && !addCols) return res.status(400).json({ error: "Specify addRows and/or addCols." });
    sheet.rowCount = Math.min(500, sheet.rowCount + addRows);
    sheet.colCount = Math.min(100, sheet.colCount + addCols);
    await delegateToDocumentController(documentController.saveDocument, identity, { content: JSON.stringify(sheet) }, { id: doc.id });
    return res.json({ documentId: doc.id, rowCount: sheet.rowCount, colCount: sheet.colCount, message: "Sheet resized." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/resizeSheetApi]", error);
    return res.status(500).json({ error: "Unable to resize the sheet." });
  }
}

// POST /internal/api/documents/sheet/insert-class-data - mirrors the editor's
// "Insert Students" (column A, one per row) / "Insert Subjects" (row 1
// starting column B) buttons exactly, including that both overwrite
// whatever was already in those cells.
async function insertClassDataIntoSheetApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    if (doc.doc_type !== "spreadsheet") {
      const error = new Error(`"${doc.title}" is a document, not a spreadsheet.`);
      error.status = 400;
      throw error;
    }
    await assertDocumentAccess(identity.organizationId, identity.userId, identity.userRole, doc, { requireEdit: true });
    const cls = await resolveClassByName(identity.organizationId, req.body?.className);
    const dataType = req.body?.dataType === "subjects" ? "subjects" : "students";

    const currentTerm = await getCurrentSchoolYearTerm(identity.organizationId);
    if (!currentTerm) {
      const error = new Error("This organization has no current school year/term set - can't resolve the active roster.");
      error.status = 409;
      throw error;
    }

    const fakeReq = {
      session: {
        organizationId: identity.organizationId,
        userId: identity.userId,
        userRole: identity.userRole,
        accountType: identity.accountType,
        currentTermId: currentTerm.term_id,
      },
      query: { classId: cls.class_id },
    };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(c) { statusCode = c; return this; },
      json(b) { payload = b; return this; },
    };
    await documentController.getClassData(fakeReq, fakeRes, db);
    if (statusCode >= 400 || payload?.success === false) {
      const error = new Error(payload?.message || "Unable to load class data.");
      error.status = statusCode >= 400 ? statusCode : 500;
      throw error;
    }

    const sheet = parseSheetContent(doc.content);
    let count = 0;
    if (dataType === "students") {
      payload.students.forEach((s, i) => {
        sheet.cells[`A${i + 1}`] = `${s.first_name} ${s.last_name}`;
      });
      count = payload.students.length;
      sheet.rowCount = Math.max(sheet.rowCount, count);
    } else {
      payload.subjects.forEach((s, i) => {
        sheet.cells[`${colLabel(i + 2)}1`] = s.subject_name;
      });
      count = payload.subjects.length;
      sheet.colCount = Math.max(sheet.colCount, count + 1);
    }

    await delegateToDocumentController(documentController.saveDocument, identity, { content: JSON.stringify(sheet) }, { id: doc.id });
    return res.json({
      documentId: doc.id,
      dataType,
      className: cls.class_name,
      count,
      message: `Inserted ${count} ${dataType} from ${cls.class_name}.`,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/insertClassDataIntoSheetApi]", error);
    return res.status(500).json({ error: "Unable to insert class data." });
  }
}

// POST /internal/api/documents/share/set - add or update one user's direct access
async function shareDocumentWithUserApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    const employee = await resolveEmployeeByIdentifier(identity.organizationId, { email: req.body?.userEmail, name: req.body?.userName });
    const level = ["view", "comment", "edit"].includes(req.body?.permissionLevel) ? req.body.permissionLevel : "view";

    const existing = await db.query(`SELECT user_id, permission_level FROM document_permissions WHERE document_id = $1`, [doc.id]);
    const merged = existing.rows
      .filter((r) => r.user_id !== employee.user_id)
      .map((r) => ({ user_id: r.user_id, permission_level: r.permission_level }));
    merged.push({ user_id: employee.user_id, permission_level: level });

    await delegateToDocumentController(documentController.updatePermissions, identity, { permissions: merged }, { id: doc.id });
    return res.json({
      documentId: doc.id,
      userId: employee.user_id,
      userName: `${employee.first_name} ${employee.last_name}`,
      permissionLevel: level,
      message: "Document shared.",
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/shareDocumentWithUserApi]", error);
    return res.status(500).json({ error: "Unable to share the document." });
  }
}

// POST /internal/api/documents/share/remove
async function removeDocumentShareApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    const employee = await resolveEmployeeByIdentifier(identity.organizationId, { email: req.body?.userEmail, name: req.body?.userName });

    const existing = await db.query(`SELECT user_id, permission_level FROM document_permissions WHERE document_id = $1`, [doc.id]);
    if (!existing.rows.some((r) => r.user_id === employee.user_id)) {
      return res.json({
        documentId: doc.id,
        userId: employee.user_id,
        alreadyRemoved: true,
        message: `${employee.first_name} ${employee.last_name} didn't have direct access to "${doc.title}".`,
      });
    }
    const merged = existing.rows
      .filter((r) => r.user_id !== employee.user_id)
      .map((r) => ({ user_id: r.user_id, permission_level: r.permission_level }));

    await delegateToDocumentController(documentController.updatePermissions, identity, { permissions: merged }, { id: doc.id });
    return res.json({ documentId: doc.id, userId: employee.user_id, message: "Access removed." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/removeDocumentShareApi]", error);
    return res.status(500).json({ error: "Unable to remove access." });
  }
}

// POST /internal/api/documents/class-assignment/set
async function assignDocumentToClassApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    const cls = await resolveClassByName(identity.organizationId, req.body?.className);
    const level = ["view", "comment", "edit"].includes(req.body?.permissionLevel) ? req.body.permissionLevel : "view";
    const includeStudents = req.body?.includeStudents === true;
    const includeSubjects = req.body?.includeSubjects === true;

    const existing = await db.query(
      `SELECT class_id, permission_level, include_students, include_subjects FROM document_class_assignments WHERE document_id = $1`,
      [doc.id]
    );
    const merged = existing.rows
      .filter((r) => r.class_id !== cls.class_id)
      .map((r) => ({ class_id: r.class_id, permission_level: r.permission_level, include_students: r.include_students, include_subjects: r.include_subjects }));
    merged.push({ class_id: cls.class_id, permission_level: level, include_students: includeStudents, include_subjects: includeSubjects });

    await delegateToDocumentController(documentController.updatePermissions, identity, { classAssignments: merged }, { id: doc.id });
    return res.json({
      documentId: doc.id,
      classId: cls.class_id,
      className: cls.class_name,
      permissionLevel: level,
      message: "Document assigned to class.",
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/assignDocumentToClassApi]", error);
    return res.status(500).json({ error: "Unable to assign the document to the class." });
  }
}

// POST /internal/api/documents/class-assignment/remove
async function unassignDocumentFromClassApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    const cls = await resolveClassByName(identity.organizationId, req.body?.className);

    const existing = await db.query(
      `SELECT class_id, permission_level, include_students, include_subjects FROM document_class_assignments WHERE document_id = $1`,
      [doc.id]
    );
    if (!existing.rows.some((r) => r.class_id === cls.class_id)) {
      return res.json({
        documentId: doc.id,
        classId: cls.class_id,
        alreadyRemoved: true,
        message: `"${doc.title}" wasn't assigned to ${cls.class_name}.`,
      });
    }
    const merged = existing.rows
      .filter((r) => r.class_id !== cls.class_id)
      .map((r) => ({ class_id: r.class_id, permission_level: r.permission_level, include_students: r.include_students, include_subjects: r.include_subjects }));

    await delegateToDocumentController(documentController.updatePermissions, identity, { classAssignments: merged }, { id: doc.id });
    return res.json({ documentId: doc.id, classId: cls.class_id, className: cls.class_name, message: "Class assignment removed." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/unassignDocumentFromClassApi]", error);
    return res.status(500).json({ error: "Unable to remove the class assignment." });
  }
}

// POST /internal/api/documents/delete
async function deleteDocumentApi(req, res) {
  try {
    const identity = docIdentity(req);
    const doc = await resolveDocument(identity.organizationId, { documentId: req.body?.documentId, title: req.body?.title });
    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        documentId: doc.id,
        title: doc.title,
        warning: `Deleting "${doc.title}" is permanent (soft-deleted server-side, but there's no restore feature anywhere in the app). Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }
    await delegateToDocumentController(documentController.deleteDocument, identity, {}, { id: doc.id });
    return res.json({ documentId: doc.id, title: doc.title, message: "Document deleted." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteDocumentApi]", error);
    return res.status(500).json({ error: "Unable to delete the document." });
  }
}

// ============================================================
// Integrations - /account/settings?section=integrations. VIEW-ONLY by
// design (explicit user requirement) - every function called below is a
// pure `get*IntegrationStatus(db, orgId)` status getter with no writes.
// Deliberately does NOT import any of the activate/connect/disconnect/
// save-settings/OAuth-token/webhook functions from these same utils
// modules, so there is no code path here that could ever activate, connect,
// or configure an integration - only read what's already there.
// ============================================================

// GET /internal/api/integrations
async function getIntegrationsStatusApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to view integrations.");
    const [google, whatsapp, studentPortal, transportation, sms, mira, recentActivity] = await Promise.all([
      getGoogleIntegrationStatus(db, organizationId),
      getWhatsappIntegrationStatus(db, organizationId),
      getStudentPortalIntegrationStatus(db, organizationId),
      getTransportationIntegrationStatus(db, organizationId),
      getSmsIntegrationStatus(db, organizationId),
      getMiraIntegrationStatus(db, organizationId),
      getLatestIntegrationActivity(db, organizationId, [
        "Student Portal", "Transportation", "Google Maps", "Maps", "Google Classroom",
        "WhatsApp", "Arkesel SMS", "Africa's Talking SMS", "Twilio SMS", "Mira",
      ]),
    ]);
    return res.json({ google, whatsapp, studentPortal, transportation, sms, mira, recentActivity });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getIntegrationsStatusApi]", error);
    return res.status(500).json({ error: "Unable to load integrations status." });
  }
}

// ============================================================
// Email Issues - /common/failedEmails. Neither this page nor Birthdays
// below is gated by a real PERMISSIONS.X key in the main app - both decide
// access with an inline role-name allowlist inside the controller. Rather
// than invent a permission key that doesn't exist (which could grant
// Mira either more or less access than the real page), these two sections
// reproduce that exact same inline check server-side.
// email_delivery_failures only tracks WHO has a broken address and WHY -
// there's no stored subject/body, so there's no generic "resend the
// original email" here. The one real write action (fixFailedEmailApi,
// delegated verbatim to commonController.updateFailedEmail) is a single
// fused operation: correct the person's real email address on their own
// record, then send a real verification email to prove it now works -
// clearing the failure record on success, or logging a fresh failure with
// the new address if it still bounces.
// ============================================================

const EMAIL_ISSUES_ALLOWED_ROLES = new Set(["organization", "admin", "mini admin", "supervisor", "superviser", "manager"]);

async function delegateToCommonController(controllerFn, identity, { body, params, query } = {}) {
  const fakeReq = {
    session: { organizationId: identity.organizationId, userRole: identity.userRole, accountType: identity.accountType },
    body: body || {},
    params: params || {},
    query: query || {},
  };
  let statusCode = 200;
  let payload = null;
  const fakeRes = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
  };
  await controllerFn(fakeReq, fakeRes, db);
  return { statusCode, payload };
}

// GET /internal/api/email-issues
async function listFailedEmailsApi(req, res) {
  try {
    const organizationId = Number(req.query.organizationId);
    if (!organizationId) return res.status(400).json({ error: "organizationId is required." });
    const role = String(req.query.userRole || req.query.accountType || "").trim().toLowerCase();
    if (!EMAIL_ISSUES_ALLOWED_ROLES.has(role)) {
      return res.status(403).json({ error: "You don't have permission to view email issues." });
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS email_delivery_failures (
        id              SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        user_id         INTEGER NOT NULL,
        user_type       TEXT NOT NULL DEFAULT 'staff',
        failed_email    TEXT NOT NULL,
        reason          TEXT NOT NULL DEFAULT 'unknown',
        failure_count   INTEGER NOT NULL DEFAULT 1,
        first_failed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_failed_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, user_id, user_type)
      )
    `).catch(() => {});

    const result = await db.query(
      `WITH grouped_failures AS (
         SELECT LOWER(TRIM(failed_email)) AS email_key, MAX(id) AS id,
           SUM(failure_count)::int AS failure_count,
           MIN(first_failed_at) AS first_failed_at, MAX(last_failed_at) AS last_failed_at
         FROM email_delivery_failures WHERE organization_id = $1
         GROUP BY LOWER(TRIM(failed_email))
       )
       SELECT f.id, f.user_id, f.user_type, f.failed_email, f.reason,
         grouped.failure_count, grouped.first_failed_at, grouped.last_failed_at,
         COALESCE(u.first_name, g.first_name, s.first_name, '') AS first_name,
         COALESCE(u.last_name, g.last_name, s.last_name, '') AS last_name,
         COALESCE(u.account_type::text, CASE WHEN f.user_type = 'student' THEN 'Student' ELSE 'guardian' END) AS account_type
       FROM grouped_failures grouped
       JOIN email_delivery_failures f ON f.id = grouped.id
       LEFT JOIN users u ON f.user_type = 'staff' AND u.user_id = f.user_id AND u.organization_id = f.organization_id
       LEFT JOIN guardians g ON f.user_type = 'guardian' AND g.guardian_id = f.user_id AND g.organization_id = f.organization_id
       LEFT JOIN students s ON f.user_type = 'student' AND s.student_id = f.user_id AND s.organization_id = f.organization_id
       ORDER BY grouped.last_failed_at DESC`,
      [organizationId]
    );

    return res.json({
      failures: result.rows.map((r) => ({
        failureId: r.id,
        userId: r.user_id,
        userType: r.user_type,
        name: `${r.first_name} ${r.last_name}`.trim(),
        accountType: r.account_type,
        failedEmail: r.failed_email,
        reason: r.reason,
        failureCount: r.failure_count,
        firstFailedAt: r.first_failed_at,
        lastFailedAt: r.last_failed_at,
      })),
    });
  } catch (error) {
    console.error("[internalApi/listFailedEmailsApi]", error);
    return res.status(500).json({ error: "Unable to load email issues." });
  }
}

// GET /internal/api/email-issues/check?email=&excludeFailureId=
async function checkEmailAvailabilityApi(req, res) {
  try {
    const organizationId = Number(req.query.organizationId);
    if (!organizationId) return res.status(400).json({ error: "organizationId is required." });
    const { statusCode, payload } = await delegateToCommonController(
      commonController.checkFailedEmail,
      { organizationId, userRole: req.query.userRole, accountType: req.query.accountType },
      { query: { email: req.query.email, excludeFailureId: req.query.excludeFailureId } }
    );
    return res.status(statusCode).json(payload);
  } catch (error) {
    console.error("[internalApi/checkEmailAvailabilityApi]", error);
    return res.status(500).json({ error: "Unable to check email availability." });
  }
}

// POST /internal/api/email-issues/fix - { organizationId, ..., failureId, newEmail }
async function fixFailedEmailApi(req, res) {
  try {
    const organizationId = Number(req.body?.organizationId);
    if (!organizationId) return res.status(400).json({ error: "organizationId is required." });
    const failureId = Number(req.body?.failureId);
    if (!failureId) return res.status(400).json({ error: "failureId is required (from list_failed_emails)." });
    const { statusCode, payload } = await delegateToCommonController(
      commonController.updateFailedEmail,
      { organizationId, userRole: req.body?.userRole, accountType: req.body?.accountType },
      { params: { id: failureId }, body: { email: req.body?.newEmail } }
    );
    return res.status(statusCode).json(payload);
  } catch (error) {
    console.error("[internalApi/fixFailedEmailApi]", error);
    return res.status(500).json({ error: "Unable to update the email address." });
  }
}

// ============================================================
// Birthdays - /common/birthdays. Read-only reporting, exactly matching the
// real page: a 7-day-ahead window (including the real app's Monday
// weekend-carryover rule for Sat/Sun birthdays), students and staff only
// (no guardians), with the same role-based scoping the real page uses -
// elevated roles (manager/supervisor/admin/mini admin/organization) see
// every student org-wide, everyone else only sees students in classes
// they're assigned to via user_classes (staff birthdays are visible to
// every viewer regardless of role, matching the real page).
// ============================================================

const BIRTHDAY_ELEVATED_ROLES = new Set(["manager", "supervisor", "admin", "mini admin", "organization"]);
const BIRTHDAY_WINDOW_DAYS = 7;

// GET /internal/api/birthdays
async function getUpcomingBirthdaysApi(req, res) {
  try {
    const organizationId = Number(req.query.organizationId);
    if (!organizationId) return res.status(400).json({ error: "organizationId is required." });
    const userId = Number(req.query.userId) || null;
    const role = String(req.query.userRole || req.query.accountType || "").trim().toLowerCase();
    const isElevated = BIRTHDAY_ELEVATED_ROLES.has(role);

    let classFilterSql = "";
    const params = [organizationId];
    if (!isElevated) {
      if (userId) {
        classFilterSql = `AND s.class_id IN (SELECT uc.class_id FROM user_classes uc WHERE uc.user_id = $2)`;
        params.push(userId);
      } else {
        classFilterSql = " AND 1 = 0";
      }
    }

    const studentsResult = await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.date_of_birth, s.class_id, c.class_name
       FROM students s JOIN classes c ON c.class_id = s.class_id
       WHERE s.organization_id = $1 AND s.class_id IS NOT NULL AND s.date_of_birth IS NOT NULL
         AND COALESCE(s.graduated, FALSE) = FALSE
         ${classFilterSql}
       ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name ASC, c.class_id ASC, s.last_name, s.first_name`,
      params
    );
    const birthdayStudents = buildUpcomingBirthdayCards(studentsResult.rows, BIRTHDAY_WINDOW_DAYS, { includeWeekendCarryover: true });

    const staffResult = await db.query(
      `SELECT user_id, first_name, last_name, date_of_birth, account_type
       FROM users WHERE organization_id = $1 AND COALESCE(on_hold, FALSE) = FALSE AND date_of_birth IS NOT NULL
       ORDER BY first_name, last_name`,
      [organizationId]
    );
    const birthdayStaff = staffResult.rows
      .map((staff) => {
        const info = getUpcomingBirthdayInfo(staff.date_of_birth, new Date(), { includeWeekendCarryover: true });
        if (!info || info.daysUntil > BIRTHDAY_WINDOW_DAYS) return null;
        const name = [staff.first_name, staff.last_name].filter(Boolean).join(" ").trim();
        return {
          userId: staff.user_id,
          isStaff: true,
          name,
          roleOrClass: staff.account_type || "Staff",
          daysUntil: info.daysUntil,
          isToday: info.daysUntil === 0,
          nextBirthdayLabel: info.label,
          turningAge: info.turningAge,
          timingLabel: info.daysUntil === 0 ? "Today" : info.daysUntil === 1 ? "Tomorrow" : `In ${info.daysUntil} days`,
        };
      })
      .filter(Boolean);

    const combined = [
      ...birthdayStudents.map((b) => ({
        studentId: b.studentId,
        isStaff: false,
        name: b.name,
        roleOrClass: b.className,
        daysUntil: b.daysUntil,
        isToday: b.isToday,
        nextBirthdayLabel: b.nextBirthdayLabel,
        turningAge: b.turningAge,
        timingLabel: b.timingLabel,
      })),
      ...birthdayStaff,
    ].sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));

    return res.json({ scope: isElevated ? "org-wide" : "your assigned classes", windowDays: BIRTHDAY_WINDOW_DAYS, birthdays: combined });
  } catch (error) {
    console.error("[internalApi/getUpcomingBirthdaysApi]", error);
    return res.status(500).json({ error: "Unable to load birthdays." });
  }
}

// ============================================================
// Admissions & Students - /common/allStudents (read), /common/addStudent
// (create), /common/admissionPending (review/approve/reject). Every write
// here delegates to the real controller functions (commonController.js's
// addStudentPost/checkStudentDuplicates/savePendingStudentChanges/
// approvePendingStudent/rejectPendingStudent, plus the real
// validateStudents middleware) through a fake req/res - Mira never
// reimplements the actual creation/approval SQL, so there's zero drift
// from what the real form does (custom student ID allocation, guardian
// fuzzy-matching/dedup, guardian portal account provisioning, duplicate
// detection, enrollment resolution) stays in exactly one place.
// A real, pre-existing bug was found and fixed while building this:
// rejectPendingStudent never scoped any of its queries by organization_id
// (pending_id is a globally-unique SERIAL across every org) - a staff
// member from any org could reject/delete another org's pending admission
// just by guessing/iterating the id. Fixed directly in commonController.js.
// Mira's own resolvePendingAdmission below still independently verifies
// organization_id ownership before ever calling reject/approve, as
// defense in depth on top of that fix.
// ============================================================

async function resolveGraduationYearGroupByName(organizationId, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const rows = await db.query(`SELECT id, name FROM graduation_year_groups WHERE organization_id = $1 AND LOWER(name) = LOWER($2)`, [organizationId, trimmed]);
  if (!rows.rows.length) {
    const error = new Error(`No graduation year group named "${name}" was found.`);
    error.status = 404;
    throw error;
  }
  return rows.rows[0];
}

// Subjects belong to exactly one class (subjects.class_id) - resolution is
// scoped to the student's class, matching how the real add-student form's
// subject checkboxes work. Not-found names are reported back as warnings
// rather than hard failures, since a subject typo shouldn't block creating
// the student - it's not required data.
async function resolveSubjectIdsForClass(organizationId, classId, subjectNames) {
  if (!Array.isArray(subjectNames) || !subjectNames.length) return { ids: [], notFound: [] };
  const rows = await db.query(`SELECT subject_id, subject_name FROM subjects WHERE organization_id = $1 AND class_id = $2`, [organizationId, classId]);
  const byName = new Map(rows.rows.map((r) => [normalizeName(r.subject_name), r]));
  const ids = [];
  const notFound = [];
  for (const name of subjectNames) {
    const row = byName.get(normalizeName(name));
    if (row) ids.push(row.subject_id);
    else notFound.push(name);
  }
  return { ids, notFound };
}

// GET /internal/api/students?organizationId&...&className?&graduated?
async function listStudentsApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_STUDENTS, "You don't have permission to view students.");
    const classFilter = req.query.className ? await resolveClassByName(organizationId, req.query.className) : null;
    const graduatedFilter = req.query.graduated === "true" ? true : req.query.graduated === "false" ? false : null;

    const rows = await db.query(
      `SELECT s.student_id, s.custom_student_id, s.first_name, s.last_name, s.email, s.gender,
              s.date_of_birth, s.date_of_birth_unknown, s.graduated,
              EXISTS(SELECT 1 FROM student_accounts sa WHERE sa.student_id = s.student_id) AS has_portal_access,
              c.class_name, c.class_id, g.name AS grad_year_group_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id
       LEFT JOIN graduation_year_groups g ON g.id = s.graduation_year_group_id
       WHERE s.organization_id = $1
         ${classFilter ? "AND s.class_id = $2" : ""}
         ${graduatedFilter !== null ? `AND COALESCE(s.graduated, FALSE) = ${graduatedFilter ? "TRUE" : "FALSE"}` : ""}
       ORDER BY c.class_name NULLS LAST, s.last_name, s.first_name`,
      classFilter ? [organizationId, classFilter.class_id] : [organizationId]
    );

    return res.json({
      students: rows.rows.map((r) => ({
        studentId: r.student_id,
        displayStudentId: r.custom_student_id || String(r.student_id),
        name: `${r.first_name} ${r.last_name}`,
        email: r.email,
        gender: r.gender,
        dateOfBirth: r.date_of_birth,
        dateOfBirthUnknown: r.date_of_birth_unknown,
        graduated: r.graduated,
        hasPortalAccess: r.has_portal_access,
        className: r.class_name,
        classId: r.class_id,
        graduationYearGroup: r.grad_year_group_name,
      })),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listStudentsApi]", error);
    return res.status(500).json({ error: "Unable to load students." });
  }
}

// POST /internal/api/students/check-duplicates - { organizationId, ..., students: [{className|classId, firstName, lastName, dateOfBirth, gender, hometown}] }
async function checkStudentDuplicatesApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_STUDENTS, "You don't have permission to check students.");
    const inputStudents = Array.isArray(req.body?.students) ? req.body.students : [];
    const resolved = [];
    for (const s of inputStudents) {
      let classId = Number(s.classId) || null;
      if (!classId && s.className) {
        const cls = await resolveClassByName(organizationId, s.className).catch(() => null);
        classId = cls?.class_id || null;
      }
      resolved.push({ classId, firstName: s.firstName, lastName: s.lastName, dateOfBirth: s.dateOfBirth, gender: s.gender, hometown: s.hometown });
    }

    const fakeReq = { session: { organizationId }, body: { students: resolved } };
    let payload = null;
    const fakeRes = {
      status() { return this; },
      json(b) { payload = b; return this; },
    };
    await commonController.checkStudentDuplicates(fakeReq, fakeRes, db);
    return res.json(payload);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/checkStudentDuplicatesApi]", error);
    return res.status(500).json({ error: "Unable to check for duplicate students." });
  }
}

// POST /internal/api/students/create - { organizationId, ..., students: [...], allowDuplicateSave? }
async function createStudentsApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_STUDENTS, "You don't have permission to add students.");
    const userId = Number(req.body?.userId) || null;
    const inputStudents = Array.isArray(req.body?.students) ? req.body.students : [];
    if (!inputStudents.length) return res.status(400).json({ error: "At least one student is required." });
    if (inputStudents.length > 50) return res.status(400).json({ error: "Add students in batches of 50 or fewer at a time." });

    const body = { allowDuplicateSave: req.body?.allowDuplicateSave === true ? "true" : "false" };
    const warnings = [];

    for (let i = 0; i < inputStudents.length; i++) {
      const s = inputStudents[i] || {};
      if (!s.firstName || !s.lastName) {
        return res.status(400).json({ error: `Student ${i + 1}: firstName and lastName are required.` });
      }
      if (!s.dateOfBirth && !s.dateOfBirthUnknown) {
        return res.status(400).json({ error: `Student ${i + 1}: dateOfBirth is required (YYYY-MM-DD), or set dateOfBirthUnknown: true.` });
      }
      if (!s.gender) {
        return res.status(400).json({ error: `Student ${i + 1}: gender is required.` });
      }
      if (!s.className) {
        return res.status(400).json({ error: `Student ${i + 1}: className is required.` });
      }

      const cls = await resolveClassByName(organizationId, s.className);

      body[`firstName_${i}`] = s.firstName;
      body[`lastName_${i}`] = s.lastName;
      if (s.dateOfBirthUnknown) {
        body[`dateOfBirthUnknown_${i}`] = "true";
      } else {
        body[`dateOfBirth_${i}`] = s.dateOfBirth;
      }
      body[`gender_${i}`] = s.gender;
      // The real form is always multipart/urlencoded, so every field the
      // controller and validateStudents middleware see is a string
      // (validateStudents calls .trim() on these unconditionally) - values
      // built here from resolved DB ids must be stringified the same way,
      // or validation throws on a bare number.
      body[`classId_${i}`] = String(cls.class_id);
      body[`hometown_${i}`] = s.hometown || "";
      body[`studentAddress_${i}`] = s.studentAddress || "";
      body[`studentEmail_${i}`] = s.studentEmail || "";
      body[`enrollmentType_${i}`] = s.enrollmentType === "future" ? "future" : "current";

      if (s.graduationYearGroupName) {
        const grad = await resolveGraduationYearGroupByName(organizationId, s.graduationYearGroupName);
        body[`graduationYearGroupId_${i}`] = String(grad.id);
      }

      if (body[`enrollmentType_${i}`] === "future") {
        if (!s.schoolYearLabel && !s.termName) {
          return res.status(400).json({ error: `Student ${i + 1}: enrollmentType "future" needs schoolYearLabel and/or termName.` });
        }
        const term = await getTermContext(organizationId, s.termName, s.schoolYearLabel);
        body[`schoolYearId_${i}`] = String(term.school_year_id);
        body[`termId_${i}`] = String(term.term_id);
      }

      if (Array.isArray(s.subjects) && s.subjects.length) {
        const { ids, notFound } = await resolveSubjectIdsForClass(organizationId, cls.class_id, s.subjects);
        body[`subjects_${i}`] = ids;
        if (notFound.length) warnings.push(`Student ${i + 1}: subject(s) not found for ${cls.class_name}: ${notFound.join(", ")}.`);
      }

      if (s.customStudentId) {
        body[`customStudentId_${i}`] = s.customStudentId;
        body[`customStudentIdMode_${i}`] = "manual";
      }

      if (Array.isArray(s.guardians)) {
        s.guardians.forEach((g, gIdx) => {
          if (!g || !g.firstName) return;
          body[`guardianFirstName_${i}_${gIdx}`] = g.firstName;
          body[`guardianLastName_${i}_${gIdx}`] = g.lastName || "";
          body[`guardianPhone_${i}_${gIdx}`] = g.phone || "";
          body[`guardianEmail_${i}_${gIdx}`] = g.email || "";
          body[`guardianAddress_${i}_${gIdx}`] = g.address || "";
          body[`guardianHometown_${i}_${gIdx}`] = g.hometown || "";
        });
      }
    }

    const capture = makeFlashCapture();
    const fakeReq = {
      session: { organizationId, userId, userRole: req.body?.userRole, accountType: req.body?.accountType },
      body,
      flash: capture.flash,
    };
    const fakeRes = { redirect() {}, status() { return this; } };

    // Run the exact same server-side validation middleware the real form
    // goes through before the controller ever sees the request.
    let validationPassed = false;
    commonValidation.validateStudents(fakeReq, fakeRes, () => { validationPassed = true; });
    if (!validationPassed) {
      const failed = capture.errorEntry();
      return res.status(400).json({ error: failed?.msg || "Validation failed." });
    }

    const beforeMax = await db.query(`SELECT COALESCE(MAX(student_id), 0) AS max_id FROM students WHERE organization_id = $1`, [organizationId]);

    await commonController.addStudentPost(fakeReq, fakeRes, db);
    const errorEntry = capture.errorEntry();
    if (errorEntry) {
      const err = new Error(errorEntry.msg);
      err.status = errorEntry.msg.includes("Duplicate student detected") ? 409 : 422;
      throw err;
    }

    const created = await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, s.custom_student_id, c.class_name
       FROM students s LEFT JOIN classes c ON c.class_id = s.class_id
       WHERE s.organization_id = $1 AND s.student_id > $2
       ORDER BY s.student_id ASC`,
      [organizationId, beforeMax.rows[0].max_id]
    );

    return res.json({
      message: capture.successEntry()?.msg || "Student(s) saved.",
      created: created.rows.map((r) => ({
        studentId: r.student_id,
        name: `${r.first_name} ${r.last_name}`,
        customStudentId: r.custom_student_id,
        className: r.class_name,
      })),
      warnings,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/createStudentsApi]", error);
    return res.status(500).json({ error: "Unable to create student(s)." });
  }
}

async function resolvePendingAdmission(organizationId, { pendingId, studentName }) {
  if (pendingId) {
    const rows = await db.query(
      `SELECT ps.*, c.class_name, g.name AS graduation_group
       FROM pending_students ps
       LEFT JOIN classes c ON ps.class_id = c.class_id
       LEFT JOIN graduation_year_groups g ON ps.graduation_year_group_id = g.id
       WHERE ps.pending_id = $1 AND ps.organization_id = $2`,
      [pendingId, organizationId]
    );
    if (!rows.rows.length) {
      const error = new Error(`No pending admission with id ${pendingId} was found.`);
      error.status = 404;
      throw error;
    }
    return rows.rows[0];
  }
  const trimmed = String(studentName || "").trim();
  if (!trimmed) {
    const error = new Error("A pendingId or the applicant's name is required to identify it.");
    error.status = 400;
    throw error;
  }
  const rows = await db.query(
    `SELECT ps.*, c.class_name, g.name AS graduation_group
     FROM pending_students ps
     LEFT JOIN classes c ON ps.class_id = c.class_id
     LEFT JOIN graduation_year_groups g ON ps.graduation_year_group_id = g.id
     WHERE ps.organization_id = $1 AND (ps.first_name || ' ' || ps.last_name) ILIKE $2`,
    [organizationId, `%${trimmed}%`]
  );
  if (!rows.rows.length) {
    const error = new Error(`No pending admission matching "${studentName}" was found.`);
    error.status = 404;
    throw error;
  }
  if (rows.rows.length > 1) {
    const error = new Error(`More than one pending admission matches "${studentName}" - use list_pending_admissions to get the exact pendingId.`);
    error.status = 409;
    throw error;
  }
  return rows.rows[0];
}

// GET /internal/api/admissions/pending
async function listPendingAdmissionsApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.APPROVE_ADMISSIONS, "You don't have permission to view pending admissions.");
    const rows = await db.query(
      `SELECT ps.*, c.class_name, g.name AS graduation_group
       FROM pending_students ps
       LEFT JOIN classes c ON ps.class_id = c.class_id
       LEFT JOIN graduation_year_groups g ON ps.graduation_year_group_id = g.id
       WHERE ps.organization_id = $1
       ORDER BY ps.submitted_at DESC`,
      [organizationId]
    );
    return res.json({
      pending: rows.rows.map((r) => ({
        pendingId: r.pending_id,
        name: `${r.first_name} ${r.last_name}`,
        dateOfBirth: r.date_of_birth,
        gender: r.gender,
        email: r.email,
        hometown: r.hometown,
        className: r.class_name,
        graduationYearGroup: r.graduation_group,
        enrollmentType: r.enrollment_type,
        submittedAt: r.submitted_at,
        paymentPending: r.payment_pending,
        paymentVerified: r.stripe_payment_verified,
      })),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listPendingAdmissionsApi]", error);
    return res.status(500).json({ error: "Unable to load pending admissions." });
  }
}

// GET /internal/api/admissions/pending/get?pendingId= | studentName=
async function getPendingAdmissionDetailsApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.APPROVE_ADMISSIONS, "You don't have permission to view pending admissions.");
    const pending = await resolvePendingAdmission(organizationId, { pendingId: req.query.pendingId, studentName: req.query.studentName });

    const subjects = await db.query(
      `SELECT s.subject_id, s.subject_name FROM pending_student_subjects pss JOIN subjects s ON s.subject_id = pss.subject_id WHERE pss.pending_student_id = $1`,
      [pending.pending_id]
    );
    const guardians = await db.query(`SELECT * FROM pending_guardians WHERE pending_id = $1`, [pending.pending_id]);

    return res.json({
      pendingId: pending.pending_id,
      firstName: pending.first_name,
      lastName: pending.last_name,
      dateOfBirth: pending.date_of_birth,
      gender: pending.gender,
      email: pending.email,
      hometown: pending.hometown,
      className: pending.class_name,
      classId: pending.class_id,
      graduationYearGroup: pending.graduation_group,
      enrollmentType: pending.enrollment_type,
      schoolYearId: pending.school_year_id,
      termId: pending.term_id,
      submittedAt: pending.submitted_at,
      paymentPending: pending.payment_pending,
      paymentVerified: pending.stripe_payment_verified,
      subjects: subjects.rows.map((r) => ({ subjectId: r.subject_id, subjectName: r.subject_name })),
      guardians: guardians.rows.map((r) => ({ firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email, address: r.address, hometown: r.hometown })),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getPendingAdmissionDetailsApi]", error);
    return res.status(500).json({ error: "Unable to load the pending admission." });
  }
}

// POST /internal/api/admissions/pending/update - only pass fields that are changing;
// subjects/guardians (if provided at all) REPLACE the whole list, matching the real
// handler's replace-all semantics - omitted entirely, they're left untouched.
async function updatePendingAdmissionApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.APPROVE_ADMISSIONS, "You don't have permission to edit pending admissions.");
    const pending = await resolvePendingAdmission(organizationId, { pendingId: req.body?.pendingId, studentName: req.body?.studentName });

    const currentSubjects = await db.query(`SELECT subject_id FROM pending_student_subjects WHERE pending_student_id = $1`, [pending.pending_id]);
    const currentGuardians = await db.query(`SELECT first_name, last_name, phone, email, hometown FROM pending_guardians WHERE pending_id = $1`, [pending.pending_id]);

    let classId = pending.class_id;
    if (req.body?.className !== undefined) {
      const cls = await resolveClassByName(organizationId, req.body.className);
      classId = cls.class_id;
    }
    let gradGroupId = pending.graduation_year_group_id;
    if (req.body?.graduationYearGroupName !== undefined) {
      const grad = req.body.graduationYearGroupName ? await resolveGraduationYearGroupByName(organizationId, req.body.graduationYearGroupName) : null;
      gradGroupId = grad ? grad.id : null;
    }

    const enrollmentType = req.body?.enrollmentType || pending.enrollment_type || "current";
    let schoolYearId = pending.school_year_id;
    let termId = pending.term_id;
    if (enrollmentType === "future" && (req.body?.schoolYearLabel || req.body?.termName)) {
      const term = await getTermContext(organizationId, req.body.termName, req.body.schoolYearLabel);
      schoolYearId = term.school_year_id;
      termId = term.term_id;
    }

    const body = {
      first_name: req.body?.firstName !== undefined ? req.body.firstName : pending.first_name,
      last_name: req.body?.lastName !== undefined ? req.body.lastName : pending.last_name,
      date_of_birth: req.body?.dateOfBirth !== undefined ? req.body.dateOfBirth : pending.date_of_birth,
      gender: req.body?.gender !== undefined ? req.body.gender : pending.gender,
      hometown: req.body?.hometown !== undefined ? req.body.hometown : pending.hometown,
      student_email: req.body?.studentEmail !== undefined ? req.body.studentEmail : pending.email,
      class_id: classId,
      graduation_year_group_id: gradGroupId,
      enrollmentType,
      schoolYearId,
      termId,
    };

    let subjectIds = currentSubjects.rows.map((r) => r.subject_id);
    if (Array.isArray(req.body?.subjects)) {
      const { ids, notFound } = await resolveSubjectIdsForClass(organizationId, classId, req.body.subjects);
      if (notFound.length) {
        const error = new Error(`Subject(s) not found for this class: ${notFound.join(", ")}.`);
        error.status = 400;
        throw error;
      }
      subjectIds = ids;
    }
    body.subjects = subjectIds;

    const guardiansList = Array.isArray(req.body?.guardians) ? req.body.guardians : currentGuardians.rows;
    guardiansList.forEach((g, i) => {
      body[`guardianFirstName${i}`] = g.firstName || g.first_name || "";
      body[`guardianLastName${i}`] = g.lastName || g.last_name || "";
      body[`guardianPhone${i}`] = g.phone || "";
      body[`guardianEmail${i}`] = g.email || "";
      body[`guardianHometown${i}`] = g.hometown || "";
    });

    const fakeReq = { params: { id: pending.pending_id }, session: { organizationId }, body };
    let payload = null;
    let statusCode = 200;
    const fakeRes = {
      status(c) { statusCode = c; return this; },
      json(b) { payload = b; return this; },
    };
    await commonController.savePendingStudentChanges(fakeReq, fakeRes, db);
    if (statusCode >= 400 || payload?.success === false) {
      const error = new Error(payload?.error || "Unable to save changes.");
      error.status = statusCode >= 400 ? statusCode : 500;
      throw error;
    }

    return res.json({ pendingId: pending.pending_id, message: "Pending admission updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/updatePendingAdmissionApi]", error);
    return res.status(500).json({ error: "Unable to update the pending admission." });
  }
}

// POST /internal/api/admissions/pending/approve - { organizationId, ..., pendingId|studentName, confirm }
async function approvePendingAdmissionApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.APPROVE_ADMISSIONS, "You don't have permission to approve admissions.");
    const pending = await resolvePendingAdmission(organizationId, { pendingId: req.body?.pendingId, studentName: req.body?.studentName });

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        pendingId: pending.pending_id,
        name: `${pending.first_name} ${pending.last_name}`,
        warning: `Approving "${pending.first_name} ${pending.last_name}" creates a real student record and permanently deletes this pending application - there's no undo. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { params: { id: pending.pending_id }, session: { organizationId }, body: {}, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };

    const beforeMax = await db.query(`SELECT COALESCE(MAX(student_id), 0) AS max_id FROM students WHERE organization_id = $1`, [organizationId]);
    await commonController.approvePendingStudent(fakeReq, fakeRes, db);
    const errorEntry = capture.errorEntry();
    if (errorEntry) {
      const err = new Error(errorEntry.msg);
      err.status = 500;
      throw err;
    }

    const created = await db.query(
      `SELECT student_id FROM students WHERE organization_id = $1 AND student_id > $2 ORDER BY student_id DESC LIMIT 1`,
      [organizationId, beforeMax.rows[0].max_id]
    );

    return res.json({
      pendingId: pending.pending_id,
      studentId: created.rows[0]?.student_id || null,
      message: `Approved. ${pending.first_name} ${pending.last_name} is now a real student.`,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/approvePendingAdmissionApi]", error);
    return res.status(500).json({ error: "Unable to approve the admission." });
  }
}

// POST /internal/api/admissions/pending/reject - { organizationId, ..., pendingId|studentName, confirm }
async function rejectPendingAdmissionApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.APPROVE_ADMISSIONS, "You don't have permission to reject admissions.");
    const pending = await resolvePendingAdmission(organizationId, { pendingId: req.body?.pendingId, studentName: req.body?.studentName });

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        pendingId: pending.pending_id,
        name: `${pending.first_name} ${pending.last_name}`,
        warning: `Rejecting "${pending.first_name} ${pending.last_name}" permanently deletes this pending application - there's no undo. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { params: { id: pending.pending_id }, session: { organizationId }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.rejectPendingStudent(fakeReq, fakeRes, db);

    return res.json({ pendingId: pending.pending_id, message: `Rejected. "${pending.first_name} ${pending.last_name}"'s application was removed.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/rejectPendingAdmissionApi]", error);
    return res.status(500).json({ error: "Unable to reject the admission." });
  }
}

// ============================================================
// Organization Statistics - /stats/organization. Read-only. The real page
// has no PERMISSIONS.X gate at all (only a plan-feature check, not a role
// permission) - MANAGE_RECORDS is used here as the closest fit, matching
// the same "broad admin visibility" permission Docs/Sheets uses, since
// nothing in the real app specifies which permission this should require.
// Charts: Mira's chat UI has no native chart-rendering capability, so
// every chart here is built as a QuickChart.io image URL (a public,
// no-API-key chart-rendering service) embedded via markdown image syntax
// (`![alt](url)`) - the chat renderer was extended to support that syntax,
// restricted to quickchart.io specifically (see mira-chat.js) so this
// doesn't become a general "render any external image" capability. Only
// aggregate counts/percentages/class names are ever sent to build a chart
// URL - never individual student names/PII.
// The numbers come from the Organization Stats page's own code
// (controllers/statsController), so Mira and the page always agree.
// ============================================================

function buildQuickChartUrl(chartConfig, { width = 600, height = 350 } = {}) {
  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?width=${width}&height=${height}&backgroundColor=white&c=${encoded}`;
}

// A short QuickChart link (about 60 characters instead of hundreds), so
// replies stay small and the link is copied exactly. Falls back to the
// self-contained long link if QuickChart doesn't answer quickly.
async function shortChartUrl(chartConfig, { width = 600, height = 350 } = {}) {
  try {
    const response = await fetch("https://quickchart.io/chart/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart: chartConfig, width, height, backgroundColor: "white" }),
      signal: AbortSignal.timeout(4000),
    });
    const body = await response.json();
    if (response.ok && body.success && body.url) return body.url;
  } catch (_) {
    // fall through to the long link
  }
  return buildQuickChartUrl(chartConfig, { width, height });
}

// Resolves { name: { config, width, height } } to { name: url } in parallel.
async function shortChartUrls(specs) {
  const entries = await Promise.all(
    Object.entries(specs).map(async ([name, spec]) => [name, await shortChartUrl(spec.config, spec)])
  );
  return Object.fromEntries(entries);
}


// Charts use one colour per chart (a single series) so they read the same as
// the Organization Stats page.
const CHART_BLUE = "#2a78d6";

function horizontalBarChart(title, labels, values, { max } = {}) {
  return {
    config: {
      type: "horizontalBar",
      data: { labels, datasets: [{ label: title, backgroundColor: CHART_BLUE, data: values }] },
      options: {
        legend: { display: false },
        title: { display: true, text: title },
        scales: { xAxes: [{ ticks: { beginAtZero: true, ...(max ? { suggestedMax: max } : {}) } }] },
      },
    },
    width: 600,
    height: Math.max(220, labels.length * 34 + 80),
  };
}

// GET /internal/api/stats/organization?organizationId&...&termName?&schoolYearLabel?
// The same numbers as the Organization Stats page (controllers/statsController
// buildOrganizationStats): term-scoped, enrollment-based, one result per
// student per subject. When the term has no scores yet, the academic figures
// come from the latest term with results and are labelled as such.
async function getOrganizationStatisticsApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_RECORDS, "You don't have permission to view organization statistics.");
    const requestedTerm = req.query.termName || req.query.schoolYearLabel
      ? await getTermContext(organizationId, req.query.termName, req.query.schoolYearLabel)
      : null;
    const { currentTerm, stats } = await statsController.buildOrganizationStats(organizationId, requestedTerm?.term_id);
    if (!stats) {
      return res.status(404).json({ error: "No statistics yet - nothing has been saved for any term." });
    }

    const k = stats.kpis;
    const a = stats.academic;
    const { protocol, host } = publicBaseUrlParts();
    const pageUrl = `${protocol}://${host}/stats/organization?selectedTermId=${currentTerm.term_id}`;
    const entryByClass = new Map(stats.scoreEntry.map((row) => [row.class_name, row]));
    const academicByClass = new Map((a?.classes || []).map((row) => [row.class_name, row]));

    const chartSpecs = {};
    if (a?.classes.length) chartSpecs.averageScoreByClass = horizontalBarChart("Average score by class (%)", a.classes.map((c) => c.class_name), a.classes.map((c) => c.average_score), { max: 100 });
    if (a?.subjects.length) chartSpecs.subjectPerformance = horizontalBarChart("Average score by subject (%)", a.subjects.slice(0, 12).map((s) => s.subject_name), a.subjects.slice(0, 12).map((s) => s.average_score), { max: 100 });
    const attendanceClasses = stats.classes.filter((c) => c.attendance_rate !== null);
    if (attendanceClasses.length) chartSpecs.attendanceByClass = horizontalBarChart("Attendance rate by class (%)", attendanceClasses.map((c) => c.class_name), attendanceClasses.map((c) => c.attendance_rate), { max: 100 });
    if (stats.enrollmentTrend.length > 1) {
      chartSpecs.enrollmentOverTerms = {
        config: {
          type: "line",
          data: { labels: stats.enrollmentTrend.map((t) => t.label), datasets: [{ label: "Enrolled students", borderColor: CHART_BLUE, backgroundColor: CHART_BLUE, fill: false, data: stats.enrollmentTrend.map((t) => t.enrolled) }] },
          options: { legend: { display: false }, title: { display: true, text: "Enrolled students by term" }, scales: { yAxes: [{ ticks: { beginAtZero: true } }] } },
        },
        width: 600,
        height: 320,
      };
    }
    const charts = await shortChartUrls(chartSpecs);

    return res.json({
      term: { termName: currentTerm.term_name, yearLabel: currentTerm.year_label, isCurrent: !!currentTerm.current },
      academicResultsTerm: a ? { label: a.term.label, isLatestResultsFromEarlierTerm: a.isFallback } : null,
      passMark: statsController.PASS_MARK,
      summary: {
        enrolledStudents: k.enrolled,
        changeFromPreviousTerm: k.enrolledChange,
        previousTerm: k.previousTermLabel,
        averageScore: a ? a.averageScore : null,
        passRate: a ? a.passRate : null,
        studentsWithScores: a ? a.studentsWithScores : 0,
        studentsNeedingSupport: a ? a.needsSupportCount : null,
        attendanceRate: k.attendanceRate,
        studentsBelowAttendanceThreshold: k.lowAttendance,
        attendanceThreshold: statsController.LOW_ATTENDANCE_RATE,
        scoreEntryRate: k.scoreEntryRate,
        scoresEntered: k.scoresEntered,
        scoresExpected: k.scoresExpected,
        activeClasses: k.activeClasses,
        totalClasses: k.totalClasses,
        staff: k.staff,
        teachers: k.teachers,
      },
      classes: stats.classes.map((c) => {
        const academic = academicByClass.get(c.class_name);
        const entry = entryByClass.get(c.class_name);
        return {
          className: c.class_name,
          enrolled: c.enrolled,
          averageScore: academic ? academic.average_score : null,
          passRate: academic ? academic.pass_rate : null,
          attendanceRate: c.attendance_rate,
          scoreEntryRate: entry ? entry.rate : null,
        };
      }),
      subjects: (a?.subjects || []).map((sub) => ({ subjectName: sub.subject_name, averageScore: sub.average_score, passRate: sub.pass_rate, results: sub.results })),
      scoreDistribution: a?.distribution || [],
      topStudents: (a?.topStudents || []).slice(0, 5).map((st) => ({ name: st.name, className: st.class_name, averageScore: st.average_score })),
      studentsNeedingSupport: (a?.needsSupport || []).map((st) => ({ name: st.name, className: st.class_name, averageScore: st.average_score, subjects: st.subjects })),
      enrollmentByTerm: stats.enrollmentTrend.map((t) => ({ term: t.label, enrolled: t.enrolled })),
      gender: stats.gender,
      staffByRole: stats.staff,
      charts,
      pageUrl,
      downloads: {
        pdf: `${protocol}://${host}/stats/organization/pdf?selectedTermId=${currentTerm.term_id}`,
        excel: `${protocol}://${host}/stats/organization/export?selectedTermId=${currentTerm.term_id}`,
      },
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getOrganizationStatisticsApi]", error);
    return res.status(500).json({ error: "Unable to load organization statistics." });
  }
}

// GET /internal/api/stats/compare-classes?organizationId&...&classNames=A,B,C&termName?&schoolYearLabel?
// Same figures as the page's Compare classes panel, for one term (default
// the current term).
async function compareClassesApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_RECORDS, "You don't have permission to view organization statistics.");
    const classNames = String(req.query.classNames || "").split(",").map((n) => n.trim()).filter(Boolean);
    if (classNames.length < 2) return res.status(400).json({ error: "Give at least 2 class names to compare." });

    const classes = await resolveClassesByNames(organizationId, classNames);
    const term = await getTermContext(organizationId, req.query.termName, req.query.schoolYearLabel);
    const rows = await statsController.compareClasses(organizationId, term.term_id, classes.map((c) => c.class_id));

    const metrics = [["Average score (%)", "average_score"], ["Pass rate (%)", "pass_rate"], ["Attendance (%)", "attendance_rate"]];
    const chartUrl = await shortChartUrl({
      type: "bar",
      data: {
        labels: rows.map((r) => r.class_name),
        datasets: metrics.map(([label, key], i) => ({ label, backgroundColor: ["#2a78d6", "#eb6834", "#1baf7a"][i], data: rows.map((r) => r[key] ?? 0) })),
      },
      options: { title: { display: true, text: `${term.term_name} (${term.year_label})` }, scales: { yAxes: [{ ticks: { beginAtZero: true, suggestedMax: 100 } }] } },
    });

    return res.json({
      termName: term.term_name,
      yearLabel: term.year_label,
      passMark: statsController.PASS_MARK,
      classes: rows.map((r) => ({
        className: r.class_name,
        enrolled: r.enrolled,
        averageScore: r.average_score,
        passRate: r.pass_rate,
        attendanceRate: r.attendance_rate,
      })),
      note: "A null value means nothing has been saved for that class in this term yet.",
      chartUrl,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/compareClassesApi]", error);
    return res.status(500).json({ error: "Unable to compare classes." });
  }
}

// ============================================================
// Report Settings - /print/reportSettings?classId=&termId=. The real page
// has no PERMISSIONS.X gate at all (only isAuthenticated + a plan-feature
// check) - MANAGE_REPORTS is used here as the closest real fit ("Manage
// Reports/Printing" in the permission catalog), since nothing in the app
// specifies which permission this page should require.
// This is genuinely the most complex settings surface in the app
// (nested JSONB display_settings with cross-class grade-presentation
// propagation, a locking system on grade/remark ranges, bulk row-based
// promotion settings) - rather than reimplement any of that, every write
// here delegates to the real controller functions (through a fake
// req/res), and read-modify-write only ever touches the specific field
// the tool exposes, passing everything else through completely unchanged
// so the real normalization logic re-derives it exactly as a real "just
// resubmit without touching this" would.
// ============================================================

async function resolveClassAndTermForReports(organizationId, className, termName, yearLabel) {
  const cls = await resolveClassByName(organizationId, className);
  const term = await getTermContext(organizationId, termName, yearLabel);
  return { cls, term };
}

async function delegateToPrintController(controllerFn, session, { query, body, params } = {}) {
  const capture = makeFlashCapture();
  let statusCode = 200;
  let payload = null;
  const fakeReq = {
    session,
    query: query || {},
    body: body || {},
    params: params || {},
    flash: capture.flash,
    get() { return undefined; },
  };
  const fakeRes = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
    redirect() {},
  };
  await controllerFn(fakeReq, fakeRes);
  if (payload) {
    if (statusCode >= 400 || payload.success === false) {
      const error = new Error(payload.message || payload.error || "The action failed.");
      error.status = statusCode >= 400 ? statusCode : 422;
      throw error;
    }
    return payload;
  }
  const errorEntry = capture.errorEntry();
  if (errorEntry) {
    const error = new Error(errorEntry.msg);
    error.status = 422;
    throw error;
  }
  return { message: capture.successEntry()?.msg || "Done." };
}

// GET /internal/api/report-settings?organizationId&...&className&termName&schoolYearLabel?
async function getReportSettingsApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to view report settings.");
    const { cls, term } = await resolveClassAndTermForReports(organizationId, req.query.className, req.query.termName, req.query.schoolYearLabel);

    const statusRow = (await db.query(
      `SELECT promoted_class, repeated_class, activate_promotion, cut_off_point, promotion_basis, school_reopen_date, term_end_date
       FROM status_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
      [organizationId, cls.class_id, term.term_id]
    )).rows[0] || null;

    let promotedClassName = null, repeatedClassName = null;
    if (statusRow?.promoted_class) {
      const r = await db.query(`SELECT class_name FROM classes WHERE organization_id = $1 AND class_id = $2`, [organizationId, Number(statusRow.promoted_class)]);
      promotedClassName = r.rows[0]?.class_name || null;
    }
    if (statusRow?.repeated_class) {
      const r = await db.query(`SELECT class_name FROM classes WHERE organization_id = $1 AND class_id = $2`, [organizationId, Number(statusRow.repeated_class)]);
      repeatedClassName = r.rows[0]?.class_name || null;
    }

    const scoreRemarks = (await db.query(
      `SELECT id, grade_label, remark, from_percentage, to_percentage FROM score_remarks
       WHERE organization_id = $1 AND class_id = $2 AND term_id = $3
       ORDER BY from_percentage DESC NULLS LAST`,
      [organizationId, cls.class_id, term.term_id]
    )).rows;

    const reportSettingsRow = (await db.query(
      `SELECT display_settings, signature_name, signature_title FROM report_settings
       WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
      [organizationId, cls.class_id, term.term_id]
    )).rows[0] || {};
    const displaySettings = reportSettingsRow.display_settings || {};
    const columns = displaySettings.columns || {};
    const sections = displaySettings.sections || {};

    return res.json({
      className: cls.class_name,
      termName: term.term_name,
      yearLabel: term.year_label,
      promotion: statusRow ? {
        promotedClassName, repeatedClassName,
        activatePromotion: statusRow.activate_promotion,
        cutOffPoint: statusRow.cut_off_point,
        promotionBasis: statusRow.promotion_basis,
        schoolReopenDate: statusRow.school_reopen_date,
        termEndDate: statusRow.term_end_date,
      } : null,
      gradingScale: scoreRemarks.map((r) => ({ id: r.id, gradeLabel: r.grade_label, remark: r.remark, fromPercentage: r.from_percentage !== null ? Number(r.from_percentage) : null, toPercentage: r.to_percentage !== null ? Number(r.to_percentage) : null })),
      displayOptions: {
        showClassScore: columns.classScore !== false,
        showExamsScore: columns.examsScore !== false,
        showOtherScore: columns.otherScore !== false,
        showTotalScore: columns.totalScore !== false,
        showScaledScore: columns.scaledScore !== false,
        showTotalPercentage: columns.totalPercentage !== false,
        showGrade: columns.grade !== false,
        showPosition: columns.position !== false,
        showRemarksColumn: columns.remarksCol !== false,
        showTeacherRemarks: sections.teacherRemarks !== false,
        showConductRemarks: sections.conductRemarks !== false,
        showAttitudeRemarks: sections.attitudeRemarks !== false,
        showInterestRemarks: sections.interestRemarks !== false,
        showAttendance: sections.attendance !== false,
        showGradeKey: sections.gradeKey !== false,
        showPromotion: sections.promotion !== false,
      },
      signatureName: reportSettingsRow.signature_name || null,
      signatureTitle: reportSettingsRow.signature_title || null,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getReportSettingsApi]", error);
    return res.status(500).json({ error: "Unable to load report settings." });
  }
}

const REPORT_DISPLAY_TOGGLE_MAP = {
  showClassScore: ["columns", "classScore"],
  showExamsScore: ["columns", "examsScore"],
  showOtherScore: ["columns", "otherScore"],
  showTotalScore: ["columns", "totalScore"],
  showScaledScore: ["columns", "scaledScore"],
  showTotalPercentage: ["columns", "totalPercentage"],
  showGrade: ["columns", "grade"],
  showPosition: ["columns", "position"],
  showRemarksColumn: ["columns", "remarksCol"],
  showTeacherRemarks: ["sections", "teacherRemarks"],
  showConductRemarks: ["sections", "conductRemarks"],
  showAttitudeRemarks: ["sections", "attitudeRemarks"],
  showInterestRemarks: ["sections", "interestRemarks"],
  showAttendance: ["sections", "attendance"],
  showGradeKey: ["sections", "gradeKey"],
  showPromotion: ["sections", "promotion"],
};

// POST /internal/api/report-settings/display-options - only the given toggles change; every
// other existing field (including complex nested paygira/grade-presentation config) is passed
// through completely unchanged, letting the real handler's own normalization re-derive it.
async function setReportCardDisplayOptionsApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to change report settings.");
    const { cls, term } = await resolveClassAndTermForReports(organizationId, req.body?.className, req.body?.termName, req.body?.schoolYearLabel);

    const existing = (await db.query(
      `SELECT display_settings FROM report_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
      [organizationId, cls.class_id, term.term_id]
    )).rows[0]?.display_settings || {};
    const merged = JSON.parse(JSON.stringify(existing));
    merged.columns = merged.columns || {};
    merged.sections = merged.sections || {};

    let changedAny = false;
    for (const [toggleKey, [group, field]] of Object.entries(REPORT_DISPLAY_TOGGLE_MAP)) {
      if (req.body?.[toggleKey] !== undefined) {
        merged[group][field] = req.body[toggleKey] === true;
        changedAny = true;
      }
    }
    if (!changedAny) return res.status(400).json({ error: "No display options were given to change." });

    await delegateToPrintController(printController.saveDisplaySettings, { organizationId }, {
      query: { classId: String(cls.class_id), termId: String(term.term_id) },
      body: merged,
    });

    return res.json({ className: cls.class_name, termName: term.term_name, message: "Report card display options updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setReportCardDisplayOptionsApi]", error);
    return res.status(500).json({ error: "Unable to update report card display options." });
  }
}

// POST /internal/api/report-settings/grading-scale/set - one grade band per call
async function setGradingScaleBandApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to change the grading scale.");
    const { cls, term } = await resolveClassAndTermForReports(organizationId, req.body?.className, req.body?.termName, req.body?.schoolYearLabel);
    const { fromPercentage, toPercentage, gradeLabel, remark } = req.body || {};
    if (fromPercentage === undefined || toPercentage === undefined || !gradeLabel) {
      return res.status(400).json({ error: "fromPercentage, toPercentage, and gradeLabel are required." });
    }

    const result = await delegateToPrintController(printController.saveScoreRemarksAjax, { organizationId }, {
      body: {
        from_percentage: fromPercentage,
        to_percentage: toPercentage,
        grade_label: gradeLabel,
        remark: remark || "",
        termId: term.term_id,
        selectedClasses: [cls.class_id],
        entryType: "grade",
        action: "bulkUpsert",
      },
    });

    return res.json({ className: cls.class_name, termName: term.term_name, fromPercentage, toPercentage, gradeLabel, message: result.message || "Grading band saved." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setGradingScaleBandApi]", error);
    return res.status(500).json({ error: "Unable to save the grading band." });
  }
}

// POST /internal/api/report-settings/grading-scale/delete
async function deleteGradingScaleBandApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to change the grading scale.");
    const bandId = Number(req.body?.gradingScaleId);
    if (!bandId) return res.status(400).json({ error: "gradingScaleId is required (from get_report_settings)." });

    const row = (await db.query(`SELECT id, term_id, class_id FROM score_remarks WHERE id = $1 AND organization_id = $2`, [bandId, organizationId])).rows[0];
    if (!row) return res.status(404).json({ error: `No grading band with id ${bandId} was found.` });

    await delegateToPrintController(printController.deleteScoreRemark, { organizationId }, {
      params: { id: bandId },
      query: { termId: String(row.term_id), classId: String(row.class_id) },
    });

    return res.json({ gradingScaleId: bandId, message: "Grading band deleted." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteGradingScaleBandApi]", error);
    return res.status(500).json({ error: "Unable to delete the grading band." });
  }
}

// POST /internal/api/report-settings/promotion/set - only pass fields that are changing
async function setPromotionSettingsApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to change promotion settings.");
    const { cls, term } = await resolveClassAndTermForReports(organizationId, req.body?.className, req.body?.termName, req.body?.schoolYearLabel);

    const existing = (await db.query(
      `SELECT promoted_class, repeated_class, cut_off_point, promotion_basis, school_reopen_date FROM status_settings WHERE organization_id = $1 AND class_id = $2 AND term_id = $3`,
      [organizationId, cls.class_id, term.term_id]
    )).rows[0] || {};

    let promotedClassId = existing.promoted_class ? Number(existing.promoted_class) : "";
    if (req.body?.promotedClassName !== undefined) {
      const promotedCls = req.body.promotedClassName ? await resolveClassByName(organizationId, req.body.promotedClassName) : null;
      promotedClassId = promotedCls ? promotedCls.class_id : "";
    }
    let repeatedClassId = existing.repeated_class ? Number(existing.repeated_class) : "";
    if (req.body?.repeatedClassName !== undefined) {
      const repeatedCls = req.body.repeatedClassName ? await resolveClassByName(organizationId, req.body.repeatedClassName) : null;
      repeatedClassId = repeatedCls ? repeatedCls.class_id : "";
    }
    const cutOffPoint = req.body?.cutOffPoint !== undefined ? req.body.cutOffPoint : (existing.cut_off_point ?? "");
    const schoolReopenDate = req.body?.schoolReopenDate !== undefined ? req.body.schoolReopenDate : (existing.school_reopen_date || "");

    await delegateToPrintController(printController.savePromotionSettings, { organizationId }, {
      body: {
        classId: String(cls.class_id),
        termId: String(term.term_id),
        responseMode: "json",
        statusRowClassId: [String(cls.class_id)],
        statusRowPromotedClass: [String(promotedClassId)],
        statusRowRepeatedClass: [String(repeatedClassId)],
        statusRowCutOffPoint: [String(cutOffPoint)],
        statusRowSchoolReopenDate: [String(schoolReopenDate)],
        selectedStatusClasses: [String(cls.class_id)],
        activatePromotion: req.body?.activatePromotion === true ? "on" : undefined,
      },
    });

    return res.json({ className: cls.class_name, termName: term.term_name, message: "Promotion settings updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setPromotionSettingsApi]", error);
    return res.status(500).json({ error: "Unable to update promotion settings." });
  }
}

// GET /internal/api/report-settings/remarks?organizationId&...&remarkType?
async function listRemarksApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to view the remarks bank.");
    const remarkType = req.query.remarkType ? String(req.query.remarkType).trim().toLowerCase() : null;
    const rows = (await db.query(
      `SELECT id, remark, remark_type FROM remarks WHERE organization_id = $1 ${remarkType ? "AND remark_type = $2" : ""} ORDER BY remark_type, id`,
      remarkType ? [organizationId, remarkType] : [organizationId]
    )).rows;
    return res.json({ remarks: rows.map((r) => ({ remarkId: r.id, remark: r.remark, remarkType: r.remark_type })) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listRemarksApi]", error);
    return res.status(500).json({ error: "Unable to load the remarks bank." });
  }
}

// POST /internal/api/report-settings/remarks/add
async function addRemarkApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to edit the remarks bank.");
    const remarkText = String(req.body?.remark || "").trim();
    const remarkType = String(req.body?.remarkType || "teacher").trim().toLowerCase();
    if (!remarkText) return res.status(400).json({ error: "remark text is required." });

    await delegateToPrintController(printController.saveRemarks, { organizationId }, {
      query: { classId: "", termId: "" },
      body: { "remarks[]": [remarkText], "remarkType[]": [remarkType] },
    });

    return res.json({ remark: remarkText, remarkType, message: "Remark added." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/addRemarkApi]", error);
    return res.status(500).json({ error: "Unable to add the remark." });
  }
}

// POST /internal/api/report-settings/remarks/delete
async function deleteRemarkApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to edit the remarks bank.");
    const remarkId = Number(req.body?.remarkId);
    if (!remarkId) return res.status(400).json({ error: "remarkId is required (from list_remarks)." });

    const row = (await db.query(`SELECT id FROM remarks WHERE id = $1 AND organization_id = $2`, [remarkId, organizationId])).rows[0];
    if (!row) return res.status(404).json({ error: `No remark with id ${remarkId} was found.` });

    await delegateToPrintController(printController.deleteRemark, { organizationId }, {
      params: { id: remarkId },
      query: { classId: "", termId: "" },
    });

    return res.json({ remarkId, message: "Remark deleted." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/deleteRemarkApi]", error);
    return res.status(500).json({ error: "Unable to delete the remark." });
  }
}

// ============================================================
// Close Graduation Year Group - /common/closeGraduationYearGroup +
// /common/archivedStudents. Real, exact PERMISSIONS.X gates exist for
// this pair (unlike Stats/Report Settings above): MANAGE_SCHOOL_YEAR_TERMS
// to close/archive, MANAGE_STUDENTS to view/unarchive. "Closing" a group
// only ever does two things to a student: insert a row into
// archived_student_info, and set students.graduated = TRUE - no
// enrollment/grades/class-assignment rows are touched, and it's fully
// reversible via unarchive (the exact inverse). The real page has no
// server-side confirmation and no prerequisite validation at all (no
// check that a student even belongs to the named group) - Mira adds its
// own confirm-then-execute flow on top, and only ever archives students
// who are actually currently members of the named group.
// ============================================================

// GET /internal/api/graduation-year-groups/close-candidates?organizationId&...&groupName
async function getCloseGroupCandidatesApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS, "You don't have permission to view graduation year groups.");
    const group = await resolveGraduationYearGroupByName(organizationId, req.query.groupName);
    const students = (await db.query(
      `SELECT student_id, first_name, last_name, graduated FROM students
       WHERE organization_id = $1 AND graduation_year_group_id = $2
       ORDER BY graduated ASC, first_name, last_name`,
      [organizationId, group.id]
    )).rows;
    return res.json({
      groupId: group.id,
      groupName: group.name,
      students: students.map((s) => ({ studentId: s.student_id, name: `${s.first_name} ${s.last_name}`, graduated: s.graduated })),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getCloseGroupCandidatesApi]", error);
    return res.status(500).json({ error: "Unable to load this graduation year group's students." });
  }
}

// POST /internal/api/graduation-year-groups/close - { organizationId, ..., groupName,
// studentNames?: string[] (omit + allInGroup:true to archive every non-graduated member), confirm }
async function closeGraduationYearGroupApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS, "You don't have permission to close a graduation year group.");
    const group = await resolveGraduationYearGroupByName(organizationId, req.body?.groupName);

    let targetStudents;
    if (req.body?.allInGroup === true) {
      targetStudents = (await db.query(
        `SELECT student_id, first_name, last_name FROM students WHERE organization_id = $1 AND graduation_year_group_id = $2 AND COALESCE(graduated, FALSE) = FALSE`,
        [organizationId, group.id]
      )).rows;
    } else {
      const names = Array.isArray(req.body?.studentNames) ? req.body.studentNames : [];
      if (!names.length) {
        const error = new Error("Give studentNames, or allInGroup: true to archive every non-graduated member of this group.");
        error.status = 400;
        throw error;
      }
      targetStudents = [];
      for (const name of names) {
        const student = await resolveStudentByName(organizationId, name);
        const check = await db.query(`SELECT graduation_year_group_id FROM students WHERE student_id = $1`, [student.student_id]);
        if (Number(check.rows[0]?.graduation_year_group_id) !== group.id) {
          const error = new Error(`${student.first_name} ${student.last_name} isn't currently a member of "${group.name}".`);
          error.status = 409;
          throw error;
        }
        targetStudents.push(student);
      }
    }

    if (!targetStudents.length) {
      return res.json({ groupId: group.id, groupName: group.name, archived: [], message: "No non-graduated students in this group to archive." });
    }

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        groupName: group.name,
        studentCount: targetStudents.length,
        students: targetStudents.map((s) => `${s.first_name} ${s.last_name}`),
        warning: `Closing "${group.name}" for ${targetStudents.length} student(s) marks them graduated and archives them. Reversible via unarchive_students. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { students: targetStudents.map((s) => s.student_id), action: "archive" }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.closeGraduationYearGroupPost(fakeReq, fakeRes, db);

    return res.json({
      groupId: group.id,
      groupName: group.name,
      archived: targetStudents.map((s) => ({ studentId: s.student_id, name: `${s.first_name} ${s.last_name}` })),
      message: `Archived ${targetStudents.length} student(s) under "${group.name}".`,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/closeGraduationYearGroupApi]", error);
    return res.status(500).json({ error: "Unable to close the graduation year group." });
  }
}

// GET /internal/api/archived-students?organizationId&...&groupName?
async function listArchivedStudentsApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_STUDENTS, "You don't have permission to view archived students.");
    let groupFilter = null;
    if (req.query.groupName) {
      const group = await resolveGraduationYearGroupByName(organizationId, req.query.groupName);
      groupFilter = group.id;
    }
    const rows = (await db.query(
      `SELECT s.student_id, s.first_name, s.last_name, a.graduation_year_group_id, g.name AS group_name, a.archived_at
       FROM students s JOIN archived_student_info a ON s.student_id = a.student_id
       LEFT JOIN graduation_year_groups g ON g.id = a.graduation_year_group_id
       WHERE a.organization_id = $1 ${groupFilter ? "AND a.graduation_year_group_id = $2" : ""}
       ORDER BY g.name, s.first_name, s.last_name`,
      groupFilter ? [organizationId, groupFilter] : [organizationId]
    )).rows;
    return res.json({
      archivedStudents: rows.map((r) => ({ studentId: r.student_id, name: `${r.first_name} ${r.last_name}`, groupName: r.group_name, archivedAt: r.archived_at })),
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listArchivedStudentsApi]", error);
    return res.status(500).json({ error: "Unable to load archived students." });
  }
}

// POST /internal/api/archived-students/unarchive - { organizationId, ..., studentNames, confirm }
async function unarchiveStudentsApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_STUDENTS, "You don't have permission to unarchive students.");
    const names = Array.isArray(req.body?.studentNames) ? req.body.studentNames : [];
    if (!names.length) {
      const error = new Error("studentNames is required - at least one archived student's name.");
      error.status = 400;
      throw error;
    }

    const targetStudents = [];
    for (const name of names) {
      const student = await resolveStudentByName(organizationId, name);
      const archived = await db.query(`SELECT 1 FROM archived_student_info WHERE student_id = $1 AND organization_id = $2`, [student.student_id, organizationId]);
      if (!archived.rows.length) {
        const error = new Error(`${student.first_name} ${student.last_name} isn't currently archived.`);
        error.status = 409;
        throw error;
      }
      targetStudents.push(student);
    }

    if (req.body?.confirm !== true) {
      return res.json({
        status: "confirmation_required",
        studentCount: targetStudents.length,
        students: targetStudents.map((s) => `${s.first_name} ${s.last_name}`),
        warning: `Unarchiving ${targetStudents.length} student(s) marks them not-graduated again and removes their archive record. Ask the user to explicitly confirm before calling again with confirm=true.`,
      });
    }

    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { students: targetStudents.map((s) => s.student_id) }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await commonController.unarchiveStudents(fakeReq, fakeRes, db);

    return res.json({
      unarchived: targetStudents.map((s) => ({ studentId: s.student_id, name: `${s.first_name} ${s.last_name}` })),
      message: `Unarchived ${targetStudents.length} student(s).`,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/unarchiveStudentsApi]", error);
    return res.status(500).json({ error: "Unable to unarchive students." });
  }
}

// ============================================================
// Report Card / Merit Sheet PDF generation & delivery -
// /common/closeSchoolYear -> /common/termDetails/:termId ->
// /print/printStudentReport (report cards) & /print/meritSheetPage (merit
// sheets). Mira does NOT edit report card content/settings here - that's
// the separate Report Settings section above (grading scale, promotion
// rules, display toggles, remarks bank). This section only ever GENERATES
// and DELIVERS the final PDF, exactly as the user asked: "you do not do
// anything except a few actions on the report card... you will only
// provide the PDF of the report to them."
//
// The real page has no PERMISSIONS.X gate on any of this either (only
// /common/closeSchoolYear itself has one, MANAGE_SCHOOL_YEAR_TERMS - every
// downstream page/action, including the entire delivery surface, is
// isAuthenticated-only) - MANAGE_REPORTS is used here for consistency with
// the Report Settings section, since generating/emailing grades is at
// least as sensitive as changing display toggles.
//
// Architecture note: every PDF in the app is produced by utils/pdfService,
// which renders the real printStudentReport/generateMeritSheet page as the
// signed-in user, so the exact same rendering pipeline (including the
// global EJS layout via express-ejs-layouts, which nothing here opts out
// of) produces the PDF a human would get. Mira has no browser session to
// hand over - it's called service-to-service with only a bearer token, not
// a cookie - so rather than risk a subtly-wrong hand-rolled re-render, the
// same real HTTP+cookie pipeline is used: a short-lived (10-minute) real
// session is minted server-side in the exact same `user_sessions` Postgres
// store express-session itself uses, scoped to the exact identity Mira
// already validated for this conversation (never a different user), handed
// to pdfService as its cookie, and explicitly destroyed
// again once the PDF is captured - deliberately narrow and short-lived,
// not a general impersonation mechanism.
// ============================================================

function internalBaseUrlParts() {
  const base = process.env.MAIN_APP_INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
  try {
    const u = new URL(base);
    return { protocol: u.protocol.replace(":", ""), host: u.host };
  } catch {
    return { protocol: "http", host: "localhost:4000" };
  }
}

async function mintPuppeteerSession(identity) {
  const store = getSessionStore();
  const sid = crypto.randomBytes(24).toString("hex");
  const ttlMs = 10 * 60 * 1000;
  const sessionData = {
    cookie: { originalMaxAge: ttlMs, expires: new Date(Date.now() + ttlMs), httpOnly: true, path: "/" },
    userId: identity.userId,
    organizationId: identity.organizationId,
    accountType: identity.accountType,
    userRole: identity.userRole,
    user: { user_id: identity.userId, email: identity.userEmail, account_type: identity.accountType },
  };
  await new Promise((resolve, reject) => {
    store.set(sid, sessionData, (err) => (err ? reject(err) : resolve()));
  });
  const signed = cookieSignature.sign(sid, process.env.SESSION_SECRET || "YourSecret");
  return { sid, cookieValue: `s:${signed}` };
}

async function destroyPuppeteerSession(sid) {
  const store = getSessionStore();
  const destroyOnce = () => new Promise((resolve) => store.destroy(sid, () => resolve()));
  await destroyOnce();
  // The main app's own session-touch middleware (setCurrentTerm, feature-
  // access, idle-timeout tracking) runs as part of finishing the HTTP
  // response Puppeteer's page.goto() triggered, in a *separate* process
  // (the real running server) - that middleware's own store.set() can
  // still be in flight when this immediate destroy runs, "resurrecting"
  // the row a moment later with the extra fields it added (confirmed via
  // testing: the row reappeared with currentTermId/allowedFeatures/etc.
  // that were never part of the minted session). A short delayed re-
  // destroy closes that race without blocking the caller on it - this is
  // best-effort cleanup on top of the session's own short (10-minute) TTL,
  // not the only thing bounding its lifetime.
  setTimeout(() => { destroyOnce().catch(() => {}); }, 3000).unref();
}

// Runs a PDF render (utils/pdfService) as the identity Mira already
// validated, using a freshly minted, short-lived session that is always
// destroyed afterwards.
async function withMintedSession(identity, render) {
  const { protocol, host } = internalBaseUrlParts();
  const { sid, cookieValue } = await mintPuppeteerSession(identity);
  try {
    return await render({ baseUrl: `${protocol}://${host}`, sessionCookie: cookieValue });
  } finally {
    await destroyPuppeteerSession(sid).catch(() => {});
  }
}

function safeFileNameSegment(value, fallback) {
  const cleaned = String(value || fallback).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

// Report card PDFs for Mira: always rendered fresh from the real report page
// (the same output as Download on the website), so they reflect the latest
// scores and settings. They are stored under their own "mira-reports" prefix
// and never written to posted_report_cards - that table is what guardians
// see in the portal, and only the website's "Post Report" action publishes.
// All requested students come from one page load.
async function renderFreshReportCardPdfs(identity, { classId, termId, students }) {
  const results = new Map();
  await withMintedSession(identity, (session) =>
    renderReportCardsPerStudent(
      { ...session, classId, termId, studentIds: students.map((student) => student.student_id) },
      {
        onReport: async (studentId, buffer) => {
          results.set(Number(studentId), { buffer });
        },
        onError: async (studentId, error) => {
          results.set(Number(studentId), { error: error.userMessage || "The report card could not be generated." });
        },
      }
    )
  );

  const reports = [];
  for (const student of students) {
    const studentName = `${student.first_name} ${student.last_name}`;
    const outcome = results.get(Number(student.student_id));
    if (!outcome || !outcome.buffer) {
      reports.push({ studentId: student.student_id, studentName, error: outcome?.error || "The report card could not be generated." });
      continue;
    }
    const safeStudentName = safeFileNameSegment(studentName, `student_${student.student_id}`);
    const pdfKey = `mira-reports/org_${identity.organizationId}/term_${termId}/class_${classId}/student_${student.student_id}_${Date.now()}_${safeStudentName}.pdf`;
    const pdfUrl = await storePdf(pdfKey, outcome.buffer);
    reports.push({ studentId: student.student_id, studentName, pdfUrl, buffer: outcome.buffer });
  }
  return reports;
}

// Same enrolled-student scoping query downloadReports uses.
async function resolveEnrolledStudentIds(organizationId, classId, termId, restrictToIds) {
  const rows = (await db.query(
    `SELECT DISTINCT es.student_id, s.first_name, s.last_name
     FROM enrolled_students es
     JOIN enrollments e ON e.enrollment_id = es.enrollment_id
     JOIN students s ON s.student_id = es.student_id AND s.organization_id = e.organization_id
     WHERE es.class_id = $1 AND e.term_id = $2 AND e.organization_id = $3
       AND ($4::int[] IS NULL OR es.student_id = ANY($4::int[]))
     ORDER BY s.last_name, s.first_name`,
    [classId, termId, organizationId, restrictToIds && restrictToIds.length ? restrictToIds : null]
  )).rows;
  return rows;
}

async function resolveClassAndTermForPrint(organizationId, className, termName, yearLabel) {
  const cls = await resolveClassByName(organizationId, className);
  const term = await getTermContext(organizationId, termName, yearLabel);
  return { cls, term };
}

// Which enrolled students a report request is about: allInClass, or each of
// studentNames matched (partial, case-insensitive) to exactly one student.
function pickReportStudents(enrolled, body, cls, term) {
  if (body?.allInClass === true) return enrolled;
  const names = Array.isArray(body?.studentNames) ? body.studentNames : [];
  if (!names.length) {
    const error = new Error("Give studentNames, or allInClass: true.");
    error.status = 400;
    throw error;
  }
  const targets = [];
  for (const name of names) {
    const trimmed = String(name || "").trim().toLowerCase();
    const matches = enrolled.filter((s) => `${s.first_name} ${s.last_name}`.toLowerCase().includes(trimmed) || `${s.last_name} ${s.first_name}`.toLowerCase().includes(trimmed));
    if (!matches.length) {
      const error = new Error(`No student matching "${name}" is enrolled in ${cls.class_name} for ${term.term_name}.`);
      error.status = 404;
      throw error;
    }
    if (matches.length > 1) {
      const error = new Error(`More than one student in ${cls.class_name} matches "${name}" - be more specific.`);
      error.status = 409;
      throw error;
    }
    if (!targets.some((t) => t.student_id === matches[0].student_id)) targets.push(matches[0]);
  }
  return targets;
}

// GET/POST /internal/api/reports/generate - { organizationId, ..., className, termName?,
// schoolYearLabel?, studentNames?: string[], allInClass?: bool } - caps at 10 students per call.
async function generateReportPdfApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to generate report cards.");
    const identity = { organizationId, userId: Number(req.body?.userId) || null, userRole: req.body?.userRole, accountType: req.body?.accountType, userEmail: req.body?.userEmail };
    const { cls, term } = await resolveClassAndTermForPrint(organizationId, req.body?.className, req.body?.termName, req.body?.schoolYearLabel);

    let enrolled = await resolveEnrolledStudentIds(organizationId, cls.class_id, term.term_id, null);
    if (!enrolled.length) {
      const error = new Error(`No students are enrolled in ${cls.class_name} for ${term.term_name} (${term.year_label}).`);
      error.status = 404;
      throw error;
    }

    const targets = pickReportStudents(enrolled, req.body, cls, term);

    if (targets.length > 10) {
      return res.status(400).json({ error: `That's ${targets.length} students in one call - generate at most 10 at a time (ask for allInClass in smaller groups, or specific students).` });
    }

    const rendered = await renderFreshReportCardPdfs(identity, { classId: cls.class_id, termId: term.term_id, students: targets });
    const reports = rendered.map(({ studentName, pdfUrl, error }) => (error ? { studentName, error } : { studentName, pdfUrl }));
    if (!reports.some((report) => report.pdfUrl)) {
      const error = new Error(reports[0]?.error || "The report cards could not be generated.");
      error.status = 502;
      throw error;
    }

    return res.json({ className: cls.class_name, termName: term.term_name, yearLabel: term.year_label, reports });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/generateReportPdfApi]", error);
    return res.status(500).json({ error: "Unable to generate the report card PDF." });
  }
}

// ---- Report cards: post to the parent portal and/or send to guardians ----
// One request covers what the website's Send Report modal does:
//   post      - publish to the parent portal using the website's own Post
//               Report Cards action (always freshly generated; guardians get
//               the portal notification and "report card ready" email it sends)
//   channels  - send directly: email attaches the PDF; text/WhatsApp send a
//               short link to a freshly generated PDF. Only channels the
//               school has turned on can be used (Email is always on).
// Without confirm it returns a preview (who gets what) for the user to
// approve; nothing is posted or sent until confirm=true.
const REPORT_CHANNEL_LABELS = { email: "Email", sms: "Text (SMS)", whatsapp: "WhatsApp" };
const DEFAULT_REPORT_MESSAGE = "Hi {{guardianTitleLastName}}, {{schoolName}}: {{studentName}}'s {{className}} report card ({{term}}) is ready. View: {{shortLink}}";
const MAX_REPORT_STUDENTS_PER_SEND = 60;

function normalizeChannels(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  const aliases = { text: "sms", texts: "sms", sms: "sms", whatsapp: "whatsapp", "whats app": "whatsapp", email: "email", mail: "email", "e-mail": "email" };
  return [...new Set(list.map((c) => aliases[String(c || "").trim().toLowerCase()]).filter(Boolean))];
}

function availableChannelList(channelStatus) {
  return Object.keys(REPORT_CHANNEL_LABELS).filter((c) => channelStatus[c]?.ready);
}

// Starts the website's own Post Report Cards action as the caller. Posting
// runs in the background there; the short-lived session it renders with is
// removed once the job finishes.
async function startReportCardPosting(identity, { classId, termId, studentIds }) {
  const { protocol, host } = internalBaseUrlParts();
  const { sid, cookieValue } = await mintPuppeteerSession(identity);
  let statusCode = 200;
  let payload = null;
  const fakeReq = {
    session: { organizationId: identity.organizationId, userId: identity.userId, user: { user_id: identity.userId } },
    body: { classId, termId, studentIds },
    protocol,
    get: (header) => (String(header).toLowerCase() === "host" ? host : undefined),
    headers: { cookie: `connect.sid=${cookieValue}` },
  };
  const fakeRes = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };
  await printController.postReportCards(fakeReq, fakeRes);

  const startedAt = Date.now();
  const timer = setInterval(async () => {
    let jobStatus = "unknown";
    await printController.getReportPostJobStatus(
      { session: { organizationId: identity.organizationId }, query: { classId, termId } },
      { status() { return this; }, json(body) { jobStatus = body?.status || "unknown"; return this; } }
    ).catch(() => {});
    if (!["queued", "running"].includes(jobStatus) || Date.now() - startedAt > 15 * 60 * 1000) {
      clearInterval(timer);
      destroyPuppeteerSession(sid).catch(() => {});
    }
  }, 5000);
  timer.unref();

  return { statusCode, payload };
}

// POST /internal/api/reports/send - { organizationId, ..., className, termName?, schoolYearLabel?,
// studentNames?: string[] | allInClass?: bool, post?: bool, channels?: ["email","sms","whatsapp"],
// message?: string (text/WhatsApp only; {{placeholders}} as the website), confirm?: bool }
async function sendReportCardsApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to post or send report cards.");
    const identity = { organizationId, userId: Number(req.body?.userId) || null, userRole: req.body?.userRole, accountType: req.body?.accountType, userEmail: req.body?.userEmail };
    const { cls, term } = await resolveClassAndTermForPrint(organizationId, req.body?.className, req.body?.termName, req.body?.schoolYearLabel);

    const post = req.body?.post === true;
    const channels = normalizeChannels(req.body?.channels);
    if (!post && !channels.length) {
      return res.status(400).json({ error: "Say whether to post the report cards to the parent portal, send them (by email, text or WhatsApp), or both." });
    }

    const channelStatus = await getMessagingChannelStatus(db, organizationId);
    const available = availableChannelList(channelStatus);
    const unavailable = channels.filter((c) => !available.includes(c));
    if (unavailable.length) {
      return res.status(409).json({
        error: `${unavailable.map((c) => REPORT_CHANNEL_LABELS[c]).join(" and ")} ${unavailable.length === 1 ? "isn't" : "aren't"} set up for this school. Available: ${available.map((c) => REPORT_CHANNEL_LABELS[c]).join(", ")}.`,
      });
    }

    const enrolled = await resolveEnrolledStudentIds(organizationId, cls.class_id, term.term_id, null);
    if (!enrolled.length) {
      return res.status(404).json({ error: `No students are enrolled in ${cls.class_name} for ${term.term_name} (${term.year_label}).` });
    }
    const targets = pickReportStudents(enrolled, req.body, cls, term);
    if (targets.length > MAX_REPORT_STUDENTS_PER_SEND) {
      return res.status(400).json({ error: `That's ${targets.length} students - send at most ${MAX_REPORT_STUDENTS_PER_SEND} at a time.` });
    }
    const targetIds = targets.map((t) => t.student_id);
    const studentName = (t) => `${t.first_name} ${t.last_name}`.trim();

    // Guardian contacts per student (same lookup as the website's Send Report).
    const guardians = await guardianMessaging.getGuardiansForSelectedStudents(db, organizationId, targetIds, cls.class_id, term.term_id);
    const contactsByStudent = new Map(targetIds.map((id) => [Number(id), []]));
    guardians.forEach((g) => contactsByStudent.get(Number(g.studentId))?.push(g));
    const reach = {};
    const missing = {};
    channels.forEach((channel) => {
      const field = channel === "email" ? "email" : "phone";
      reach[channel] = new Set(guardians.filter((g) => g[field]).map((g) => `${g.studentId}|${String(g[field]).toLowerCase()}`)).size;
      missing[channel] = targets.filter((t) => !(contactsByStudent.get(Number(t.student_id)) || []).some((g) => g[field])).map(studentName);
    });
    const alreadyPosted = Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM posted_report_cards WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND student_id = ANY($4::int[])`,
      [organizationId, cls.class_id, term.term_id, targetIds]
    )).rows[0]?.n || 0);

    const message = String(req.body?.message || "").trim();
    const textMessage = message ? (/\{\{\s*shortLink\s*\}\}/.test(message) ? message : `${message} View: {{shortLink}}`) : DEFAULT_REPORT_MESSAGE;

    if (req.body?.confirm !== true) {
      const steps = [];
      if (post) steps.push(`post ${targets.length} report card${targets.length === 1 ? "" : "s"} to the parent portal (freshly generated; guardians are notified in the portal and by email)${alreadyPosted ? ` - ${alreadyPosted} ${alreadyPosted === 1 ? "is" : "are"} already posted and will be replaced with the latest version` : ""}`);
      channels.forEach((channel) => {
        steps.push(channel === "email"
          ? `email the report card PDF to ${reach.email} guardian address${reach.email === 1 ? "" : "es"}`
          : `send a ${REPORT_CHANNEL_LABELS[channel]} message with a link to the report card to ${reach[channel]} guardian number${reach[channel] === 1 ? "" : "s"}`);
      });
      return res.json({
        status: "confirmation_required",
        className: cls.class_name,
        termName: term.term_name,
        yearLabel: term.year_label,
        studentCount: targets.length,
        students: targets.slice(0, 15).map(studentName),
        post,
        channels,
        availableChannels: available.map((c) => REPORT_CHANNEL_LABELS[c]),
        alreadyPosted,
        guardiansReached: reach,
        studentsWithoutContact: missing,
        textMessagePreview: channels.some((c) => c !== "email") ? textMessage : undefined,
        warning: `This will ${steps.join("; and ")}. ${Object.entries(missing).filter(([, list]) => list.length).map(([c, list]) => `${list.length} student${list.length === 1 ? " has" : "s have"} no guardian ${c === "email" ? "email" : "phone number"} for ${REPORT_CHANNEL_LABELS[c]}.`).join(" ")} Ask the user to confirm before calling again with confirm=true.`.replace(/\s+/g, " ").trim(),
      });
    }

    const result = { className: cls.class_name, termName: term.term_name, yearLabel: term.year_label, studentCount: targets.length };

    if (post) {
      const { statusCode, payload } = await startReportCardPosting(identity, { classId: cls.class_id, termId: term.term_id, studentIds: targetIds });
      result.posting = statusCode < 400 && payload?.success !== false
        ? { started: true, message: payload?.message || "Posting started." }
        : { started: false, message: payload?.message || "Posting could not be started." };
    }

    if (channels.length) {
      const rendered = await renderFreshReportCardPdfs(identity, { classId: cls.class_id, termId: term.term_id, students: targets });
      const pdfByStudent = new Map(rendered.filter((r) => r.pdfUrl).map((r) => [Number(r.studentId), r]));
      const schoolName = await guardianMessaging.getSchoolName(db, organizationId);
      const actorName = await guardianMessaging.getActorName(organizationId, identity.userId);
      const batchId = `mira_${Date.now()}`;
      const { protocol: publicProtocol, host: publicHost } = publicBaseUrlParts();
      const { sendEmailSafely, renderCleanEmail } = require("../utils/emailHelper");
      result.sent = {};
      result.failed = {};
      result.notGenerated = rendered.filter((r) => !r.pdfUrl).map((r) => r.studentName);

      const logSent = async (channel, student, contact) => {
        await recordMessageSent(db, { organizationId, context: "report", contextKey: `${cls.class_id}:${term.term_id}:${student.student_id}`, channel, recipient: contact }).catch(() => {});
        await recordDeliveryAuditRow(db, {
          organizationId, eventDomain: channel, eventName: "report_notify_sent", classId: cls.class_id, termId: term.term_id,
          studentId: student.student_id, studentName: studentName(student), actorUserId: identity.userId, actorName,
          recipient: contact, status: "sent", batchId, metadata: { source: "mira" },
        }).catch(() => {});
      };

      for (const channel of channels) {
        let sent = 0;
        const failures = [];
        if (channel === "email") {
          for (const student of targets) {
            const pdf = pdfByStudent.get(Number(student.student_id));
            if (!pdf) continue;
            const emails = [...new Set((contactsByStudent.get(Number(student.student_id)) || []).map((g) => String(g.email || "").trim().toLowerCase()).filter(Boolean))];
            for (const email of emails) {
              const allowed = await isEmailEnabledForRecipient(db, email, "report_card_email").catch(() => true);
              if (!allowed) { failures.push(`${email} (turned off report card emails)`); continue; }
              const html = renderCleanEmail({
                title: "Report Card",
                greeting: "Dear Parent/Guardian,",
                paragraphs: [`Please find attached ${studentName(student)}'s report card for ${term.term_name} (${term.year_label}), ${cls.class_name}.`],
                details: [
                  { label: "Student", value: studentName(student) },
                  { label: "Class", value: cls.class_name },
                  { label: "Term", value: `${term.term_name} (${term.year_label})` },
                  { label: "School", value: schoolName },
                ],
                note: "This report is confidential and intended only for the student's parent/guardian.",
                noReply: true,
              });
              const ok = await sendEmailSafely({
                to: email,
                subject: `Report Card - ${studentName(student)} | ${schoolName}`,
                html,
                attachments: [{ filename: `${safeFileNameSegment(studentName(student), "report")}_Report.pdf`, content: pdf.buffer, contentType: "application/pdf" }],
              }, "Mira-ReportCardEmail");
              if (ok) { sent += 1; await logSent("email", student, email); } else failures.push(email);
            }
          }
        } else {
          const recipients = [];
          for (const student of targets) {
            const pdf = pdfByStudent.get(Number(student.student_id));
            if (!pdf) continue;
            const shortLink = await createShortLink(db, { targetUrl: pdf.pdfUrl, organizationId, baseUrl: `${publicProtocol}://${publicHost}` });
            const seen = new Set();
            (contactsByStudent.get(Number(student.student_id)) || []).forEach((g) => {
              const digits = String(g.phone || "").replace(/\D/g, "");
              if (!digits || seen.has(digits)) return;
              seen.add(digits);
              recipients.push({ ...g, student, className: cls.class_name, term: term.term_name, shortLink });
            });
          }
          if (recipients.length) {
            const results = await sendGuardianMessages(db, organizationId, { channel, recipients, messageTemplate: textMessage, schoolName })
              .catch((error) => recipients.map((r) => ({ success: false, phone: r.phone, error: error.message })));
            for (const [index, outcome] of results.entries()) {
              if (outcome.success) { sent += 1; await logSent(channel, recipients[index].student, outcome.phone || recipients[index].phone); }
              else failures.push(`${outcome.phone || recipients[index].phone}${outcome.error ? ` (${outcome.error})` : ""}`);
            }
          }
        }
        result.sent[channel] = sent;
        if (failures.length) result.failed[channel] = failures.slice(0, 20);
      }
    }

    result.message = [
      result.posting ? (result.posting.started ? "Posting to the parent portal has started - it finishes in the background and guardians are notified when it's done." : `Posting failed: ${result.posting.message}`) : null,
      result.sent ? Object.entries(result.sent).map(([c, n]) => `${REPORT_CHANNEL_LABELS[c]}: sent to ${n}`).join("; ") : null,
    ].filter(Boolean).join(" ");
    return res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/sendReportCardsApi]", error);
    return res.status(500).json({ error: "Unable to post or send the report cards." });
  }
}

// ---- Messages to guardians (the Mailroom) ----
// POST /internal/api/messages/send - { organizationId, ..., audience: { all?: bool, classNames?: string[],
// studentNames?: string[], guardianNames?: string[] }, channels: [...], message, emailSubject?, confirm? }
// Uses the Mailroom's own directory, access rules (class-restricted staff
// only reach their classes' guardians) and sending, so messages appear in
// Mailroom history. Preview first; nothing is sent until confirm=true.
async function sendMessagesApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MAILROOM, "You don't have permission to send messages (Mailroom).");
    const userId = Number(req.body?.userId) || null;
    const message = String(req.body?.message || "").trim();
    const emailSubject = String(req.body?.emailSubject || "").trim().slice(0, 150);
    const channels = normalizeChannels(req.body?.channels);
    const audience = req.body?.audience || {};
    if (!message) return res.status(400).json({ error: "What should the message say?" });
    if (!channels.length) return res.status(400).json({ error: "Which channel - email, text (SMS) or WhatsApp?" });

    const channelStatus = await getMessagingChannelStatus(db, organizationId);
    const available = availableChannelList(channelStatus);
    const unavailable = channels.filter((c) => !available.includes(c));
    if (unavailable.length) {
      return res.status(409).json({
        error: `${unavailable.map((c) => REPORT_CHANNEL_LABELS[c]).join(" and ")} ${unavailable.length === 1 ? "isn't" : "aren't"} set up for this school. Available: ${available.map((c) => REPORT_CHANNEL_LABELS[c]).join(", ")}.`,
      });
    }

    const restrictedClassIds = await guardianMessaging.getMailroomAllowedClassIdsFor({
      orgId: organizationId, userId, userRole: req.body?.userRole, accountType: req.body?.accountType,
    });
    const directory = await guardianMessaging.loadMailroomDirectory(organizationId, restrictedClassIds);

    const lower = (value) => String(value || "").trim().toLowerCase();
    const classNames = (Array.isArray(audience.classNames) ? audience.classNames : []).map(lower).filter(Boolean);
    const studentNames = (Array.isArray(audience.studentNames) ? audience.studentNames : []).map(lower).filter(Boolean);
    const guardianNames = (Array.isArray(audience.guardianNames) ? audience.guardianNames : []).map(lower).filter(Boolean);
    if (!audience.all && !classNames.length && !studentNames.length && !guardianNames.length) {
      return res.status(400).json({ error: "Who should get it - all guardians, the guardians of certain classes, or of certain students?" });
    }
    const contacts = audience.all ? directory : directory.filter((c) =>
      c.classNames.some((n) => classNames.includes(lower(n))) ||
      c.studentNames.some((n) => studentNames.some((wanted) => lower(n).includes(wanted))) ||
      guardianNames.some((wanted) => lower(c.guardianName).includes(wanted))
    );
    if (!contacts.length) {
      return res.status(404).json({
        error: restrictedClassIds !== null
          ? "No guardian contacts match that within your Mailroom access (you can only message the guardians of your assigned classes)."
          : "No guardian contacts match that.",
      });
    }

    const perChannel = channels.map((channel) => {
      const field = channel === "email" ? "email" : "phone";
      const seen = new Set();
      const recipients = [];
      contacts.forEach((c) => {
        const value = String(c[field] || "").trim();
        const key = field === "email" ? value.toLowerCase() : value.replace(/\D/g, "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        recipients.push({ phone: field === "phone" ? value : "", email: field === "email" ? value : "", guardianName: c.guardianName, guardianTitleLastName: c.guardianName, studentName: c.studentNames[0] || "" });
      });
      return { channel, recipients, withoutContact: contacts.length - recipients.length };
    });

    if (req.body?.confirm !== true) {
      const smsInfo = channels.includes("sms") ? countSmsSegments(sanitizeForSms(message)) : null;
      return res.json({
        status: "confirmation_required",
        contactCount: contacts.length,
        sample: contacts.slice(0, 10).map((c) => `${c.guardianName} (${c.studentNames.slice(0, 2).join(", ") || "no linked student"})`),
        perChannel: perChannel.map((p) => ({ channel: REPORT_CHANNEL_LABELS[p.channel], recipients: p.recipients.length, withoutContactInfo: p.withoutContact })),
        availableChannels: available.map((c) => REPORT_CHANNEL_LABELS[c]),
        smsMessagesPerRecipient: smsInfo ? smsInfo.segments : undefined,
        restrictedToYourClasses: restrictedClassIds !== null,
        warning: `This sends the message to ${perChannel.map((p) => `${p.recipients.length} guardian${p.recipients.length === 1 ? "" : "s"} by ${REPORT_CHANNEL_LABELS[p.channel]}`).join(" and ")}. Show the user the message and the counts, and ask them to confirm before calling again with confirm=true.`,
      });
    }

    const actorName = await guardianMessaging.getActorName(organizationId, userId);
    const sending = [];
    for (const entry of perChannel) {
      if (!entry.recipients.length) continue;
      await guardianMessaging.dispatchMailroomSend({ orgId: organizationId, actorUserId: userId, actorName, channel: entry.channel, recipients: entry.recipients, message, emailSubject });
      sending.push(`${entry.recipients.length} by ${REPORT_CHANNEL_LABELS[entry.channel]}`);
    }
    return res.json({
      status: "sending",
      message: `Sending to ${sending.join(" and ")}. It goes out in the background; delivery results appear in Mailroom history (ask me to check them).`,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/sendMessagesApi]", error);
    return res.status(500).json({ error: "Unable to send the message." });
  }
}

// GET /internal/api/messages/history?organizationId&...&limit?&channel?&status?
// Recent Mailroom sends and their delivery status. Class-restricted staff
// see only their own sends, as on the Mailroom page.
async function listSentMessagesApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MAILROOM, "You don't have permission to view Mailroom history.");
    const userId = Number(req.query.userId) || null;
    const restricted = (await guardianMessaging.getMailroomAllowedClassIdsFor({
      orgId: organizationId, userId, userRole: req.query.userRole, accountType: req.query.accountType,
    })) !== null;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const channel = normalizeChannels(req.query.channel)[0] || null;
    const status = ["sent", "failed", "pending"].includes(String(req.query.status || "").toLowerCase()) ? String(req.query.status).toLowerCase() : null;
    const rows = (await db.query(
      `SELECT event_domain, recipient_emails, status, actor_name, metadata, COALESCE(updated_at, created_at) AS at
       FROM delivery_audit_history
       WHERE organization_id = $1 AND event_name = 'mailroom_send'
         AND ($2::int IS NULL OR actor_user_id = $2)
         AND ($3::text IS NULL OR event_domain = $3)
         AND ($4::text IS NULL OR status = $4)
       ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
       LIMIT $5`,
      [organizationId, restricted ? userId : null, channel, status, limit]
    )).rows;
    return res.json({
      messages: rows.map((r) => ({
        channel: REPORT_CHANNEL_LABELS[r.event_domain] || r.event_domain,
        to: r.metadata?.guardianName && r.metadata.guardianName !== "Guardian" ? `${r.metadata.guardianName} (${(r.recipient_emails || [])[0] || ""})` : (r.recipient_emails || [])[0] || "",
        status: r.status,
        message: String(r.metadata?.message || "").slice(0, 160),
        subject: r.metadata?.emailSubject || undefined,
        error: r.status === "failed" ? r.metadata?.error || undefined : undefined,
        sentBy: r.actor_name,
        at: r.at,
      })),
      onlyYourOwnSends: restricted,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/listSentMessagesApi]", error);
    return res.status(500).json({ error: "Unable to load Mailroom history." });
  }
}

// POST /internal/api/merit-sheets/generate - { organizationId, ..., className, termName?,
// schoolYearLabel?, subjectNames?: string[] (default: all subjects for the class),
// assessmentTitles?: string[] (default: every assessment for those subjects/class/term) }
async function resolveMeritSheetSelections(organizationId, cls, term, subjectNames, assessmentTitles) {
  let subjectIds;
  const warnings = [];
  if (Array.isArray(subjectNames) && subjectNames.length) {
    const { ids, notFound } = await resolveSubjectIdsForClass(organizationId, cls.class_id, subjectNames);
    subjectIds = ids;
    if (notFound.length) warnings.push(`Subject(s) not found for ${cls.class_name}: ${notFound.join(", ")}.`);
  } else {
    subjectIds = (await db.query(`SELECT subject_id FROM subjects WHERE organization_id = $1 AND class_id = $2`, [organizationId, cls.class_id])).rows.map((r) => r.subject_id);
  }
  if (!subjectIds.length) {
    const error = new Error(`${cls.class_name} has no subjects to include on a merit sheet.`);
    error.status = 409;
    throw error;
  }

  let assessmentIds;
  if (Array.isArray(assessmentTitles) && assessmentTitles.length) {
    const rows = (await db.query(
      `SELECT assessment_id, title FROM assessments WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND subject_id = ANY($4::int[])`,
      [organizationId, cls.class_id, term.term_id, subjectIds]
    )).rows;
    const byTitle = new Map(rows.map((r) => [normalizeName(r.title), r.assessment_id]));
    assessmentIds = [];
    for (const title of assessmentTitles) {
      const id = byTitle.get(normalizeName(title));
      if (id) assessmentIds.push(id);
      else warnings.push(`Assessment "${title}" not found for ${cls.class_name} in ${term.term_name}.`);
    }
  } else {
    assessmentIds = (await db.query(
      `SELECT assessment_id FROM assessments WHERE organization_id = $1 AND class_id = $2 AND term_id = $3 AND subject_id = ANY($4::int[])`,
      [organizationId, cls.class_id, term.term_id, subjectIds]
    )).rows.map((r) => r.assessment_id);
  }
  if (!assessmentIds.length) {
    const error = new Error(`No assessments found for ${cls.class_name} in ${term.term_name} for the selected subject(s).`);
    error.status = 409;
    throw error;
  }

  return { subjectIds, assessmentIds, warnings };
}

// GET /internal/api/merit-sheets - the ranked table data (no PDF), computed by
// the same code as the merit sheet page (utils/meritSheetData), so Mira's
// totals, grades and positions always match the page and its PDF.
// columns: optional comma list of merit sheet column keys (same as the page).
async function getMeritSheetApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to view merit sheets.");
    const { cls, term } = await resolveClassAndTermForPrint(organizationId, req.query.className, req.query.termName, req.query.schoolYearLabel);
    const subjectNames = req.query.subjectNames ? String(req.query.subjectNames).split(",").map((s) => s.trim()).filter(Boolean) : null;
    const assessmentTitles = req.query.assessmentTitles ? String(req.query.assessmentTitles).split(",").map((s) => s.trim()).filter(Boolean) : null;
    const columnKeys = parseMeritSheetColumns(req.query.columns || undefined);
    const includeAssessmentScores = String(req.query.includeAssessmentScores || "") === "true";
    const { subjectIds, assessmentIds, warnings } = await resolveMeritSheetSelections(organizationId, cls, term, subjectNames, assessmentTitles);

    const orgRow = (await db.query(`SELECT name_display_format FROM organizations WHERE organization_id = $1`, [organizationId])).rows[0];
    const data = await buildMeritSheetData(db, {
      organizationId,
      classId: cls.class_id,
      termId: term.term_id,
      subjectIds,
      assessmentIds,
      nameDisplayFormat: orgRow?.name_display_format,
    });
    if (!data.classDetails) {
      return res.status(404).json({ error: `${cls.class_name} or ${term.term_name} could not be found.` });
    }

    // One compact markdown table (a row per student) instead of nested JSON:
    // the same data at a fraction of the size, ready to show as-is.
    // Subject totals are always shown; individual assessment scores (and
    // their grades) only when asked for, since they make the table very wide.
    const show = new Set(columnKeys);
    const perAssessment = includeAssessmentScores;
    const cell = (value) => String(value === null || value === undefined || value === "" ? "-" : value).replace(/\|/g, "/");
    const header = [];
    if (show.has("position")) header.push("Pos");
    header.push("Student");
    if (show.has("studentId")) header.push("Student ID");
    if (show.has("gender")) header.push("Gender");
    data.subjects.forEach((subject) => {
      if (perAssessment) subject.assessments.forEach((assessment) => header.push(`${subject.subject_name}: ${assessment.title}`));
      header.push(perAssessment ? `${subject.subject_name} total` : subject.subject_name);
    });
    if (show.has("total")) header.push("Total");
    if (show.has("average")) header.push("Average");
    if (show.has("percentage")) header.push("%");
    if (show.has("overallGrade")) header.push("Grade");
    if (show.has("remark")) header.push("Remark");

    const rows = data.meritSheet.map((row) => {
      const cells = [];
      if (show.has("position")) cells.push(row.position);
      cells.push(row.name);
      if (show.has("studentId")) cells.push(row.studentId);
      if (show.has("gender")) cells.push(row.gender);
      row.scores.forEach((subject) => {
        if (perAssessment) {
          subject.assessments.forEach((assessment) => {
            cells.push(show.has("grade") && assessment.grade && assessment.grade !== "-" ? `${assessment.score} (${assessment.grade})` : assessment.score);
          });
        }
        cells.push(Number(subject.totalScore.toFixed(2)));
      });
      if (show.has("total")) cells.push(row.totalScore);
      if (show.has("average")) cells.push(row.averageScore);
      if (show.has("percentage")) cells.push(row.percentage);
      if (show.has("overallGrade")) cells.push(row.overallGrade);
      if (show.has("remark")) cells.push(row.remark);
      return `| ${cells.map(cell).join(" | ")} |`;
    });
    const table = [`| ${header.map(cell).join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows].join("\n");

    return res.json({
      className: data.classDetails.class_name,
      termName: data.classDetails.term_name,
      yearLabel: data.classDetails.year_label,
      columns: columnKeys,
      subjectNames: data.subjects.map((s) => s.subject_name),
      studentCount: data.meritSheet.length,
      hasScores: data.hasAnyRecordedScore,
      table,
      note: data.hasAnyRecordedScore
        ? "Sorted by total (ties share a position). Subject columns are each subject's total score."
        : "No scores have been saved for this class and term yet.",
      warnings,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getMeritSheetApi]", error);
    return res.status(500).json({ error: "Unable to load the merit sheet." });
  }
}

async function generateMeritSheetPdfApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_REPORTS, "You don't have permission to generate merit sheets.");
    const identity = { organizationId, userId: Number(req.body?.userId) || null, userRole: req.body?.userRole, accountType: req.body?.accountType, userEmail: req.body?.userEmail };
    const { cls, term } = await resolveClassAndTermForPrint(organizationId, req.body?.className, req.body?.termName, req.body?.schoolYearLabel);
    const { subjectIds, assessmentIds, warnings } = await resolveMeritSheetSelections(organizationId, cls, term, req.body?.subjectNames, req.body?.assessmentTitles);

    const columnKeys = parseMeritSheetColumns(req.body?.columns || undefined);
    const buffer = await withMintedSession(identity, (session) =>
      renderMeritSheetPdf({
        ...session,
        classId: cls.class_id,
        termId: term.term_id,
        subjectIds,
        assessmentIds,
        columns: columnKeys,
      })
    );

    const safeClassName = safeFileNameSegment(cls.class_name, `class_${cls.class_id}`);
    const safeTermName = safeFileNameSegment(term.term_name, `term_${term.term_id}`);
    const pdfKey = `merit-sheets/org_${organizationId}/term_${term.term_id}/class_${cls.class_id}/${safeClassName}_${safeTermName}_${Date.now()}.pdf`;
    const pdfUrl = await storePdf(pdfKey, buffer);

    return res.json({ className: cls.class_name, termName: term.term_name, yearLabel: term.year_label, columns: columnKeys, pdfUrl, warnings });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/generateMeritSheetPdfApi]", error);
    return res.status(500).json({ error: "Unable to generate the merit sheet." });
  }
}

// ============================================================
// Account Settings - Notifications, Feedback, Customize School
// (/account/settings). School Theme (publicDashboardTheme) is NOT
// duplicated here - it's the exact same backend call as the existing
// School Website `set_website_theme` tool, just shown on a second tab.
// Notifications' routes have no real PERMISSIONS.X gate in the main app
// (only isAuthenticated) - the per-user toggle needs none here either
// (it's the caller's own preference), but the org-wide toggle affects
// every guardian invite going forward, so Mira self-imposes a
// MANAGE_SETTINGS check even though the real route doesn't require one.
// Feedback has no gate either (any staff role can submit) - matched as-is.
// Customize School's routes ARE all really gated with MANAGE_SETTINGS in
// the main app, matched here directly.
// ============================================================

const { getStaffPreferencesForRole, getOrgPreferences, getUserPreferenceMap, setUserPreferences, getOrgPreferenceMap, setOrgPreferences } = require("../utils/emailPreferences");

// GET /internal/api/notifications/preferences
async function getNotificationPreferencesApi(req, res) {
  try {
    const organizationId = Number(req.query.organizationId);
    const userId = Number(req.query.userId);
    if (!organizationId || !userId) return res.status(400).json({ error: "organizationId and userId are required." });

    const staffPrefs = getStaffPreferencesForRole(req.query.userRole);
    const savedUser = await getUserPreferenceMap(db, userId);
    const orgPrefs = getOrgPreferences();
    const savedOrg = await getOrgPreferenceMap(db, organizationId);

    return res.json({
      personal: staffPrefs.map((p) => ({ key: p.key, label: p.label, description: p.description, enabled: savedUser[p.key] !== undefined ? savedUser[p.key] : true })),
      organizationWide: orgPrefs.map((p) => ({ key: p.key, label: p.label, description: p.description, enabled: savedOrg[p.key] !== undefined ? savedOrg[p.key] : true })),
    });
  } catch (error) {
    console.error("[internalApi/getNotificationPreferencesApi]", error);
    return res.status(500).json({ error: "Unable to load notification preferences." });
  }
}

// POST /internal/api/notifications/preferences/set - { organizationId, userId, userRole, ...,
// preferences: { key: true|false, ... } } - the caller's own preferences, only the keys given change.
async function setNotificationPreferencesApi(req, res) {
  try {
    const organizationId = Number(req.body?.organizationId);
    const userId = Number(req.body?.userId);
    if (!organizationId || !userId) return res.status(400).json({ error: "organizationId and userId are required." });

    const allowed = getStaffPreferencesForRole(req.body?.userRole).map((p) => p.key);
    if (!allowed.length) return res.status(400).json({ error: "No toggleable notification preferences exist for this role." });

    const updates = req.body?.preferences;
    if (!updates || typeof updates !== "object" || Array.isArray(updates) || !Object.keys(updates).length) {
      return res.status(400).json({ error: "preferences is required - a map of preference key to true/false." });
    }
    const unknown = Object.keys(updates).filter((k) => !allowed.includes(k));
    if (unknown.length) return res.status(400).json({ error: `Unknown preference key(s) for your role: ${unknown.join(", ")}. Use get_notification_preferences to see valid keys.` });

    const current = await getUserPreferenceMap(db, userId);
    const enabledKeys = allowed.filter((k) => (Object.prototype.hasOwnProperty.call(updates, k) ? updates[k] === true : (current[k] !== undefined ? current[k] : true)));
    await setUserPreferences(db, userId, allowed, enabledKeys);

    return res.json({ updated: updates, message: "Notification preferences updated." });
  } catch (error) {
    console.error("[internalApi/setNotificationPreferencesApi]", error);
    return res.status(500).json({ error: "Unable to update notification preferences." });
  }
}

// POST /internal/api/notifications/preferences/organization/set - { organizationId, ...,
// preferences: { key: true|false, ... } }
async function setOrgNotificationPreferencesApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to change organization-wide notification settings.");
    const allowed = getOrgPreferences().map((p) => p.key);
    const updates = req.body?.preferences;
    if (!updates || typeof updates !== "object" || Array.isArray(updates) || !Object.keys(updates).length) {
      return res.status(400).json({ error: "preferences is required - a map of preference key to true/false." });
    }
    const unknown = Object.keys(updates).filter((k) => !allowed.includes(k));
    if (unknown.length) return res.status(400).json({ error: `Unknown preference key(s): ${unknown.join(", ")}. Use get_notification_preferences to see valid keys.` });

    const current = await getOrgPreferenceMap(db, organizationId);
    const enabledKeys = allowed.filter((k) => (Object.prototype.hasOwnProperty.call(updates, k) ? updates[k] === true : (current[k] !== undefined ? current[k] : true)));
    await setOrgPreferences(db, organizationId, allowed, enabledKeys);

    return res.json({ updated: updates, message: "Organization-wide notification settings updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setOrgNotificationPreferencesApi]", error);
    return res.status(500).json({ error: "Unable to update organization-wide notification settings." });
  }
}

// POST /internal/api/feedback/submit - { organizationId, userId, userRole, accountType,
// feedbackType, area, subject, message, rating?, priority? }
async function submitFeedbackApi(req, res) {
  try {
    const organizationId = Number(req.body?.organizationId);
    const userId = Number(req.body?.userId);
    if (!organizationId || !userId) return res.status(400).json({ error: "organizationId and userId are required." });

    const fakeReq = {
      session: { organizationId, userId, userRole: req.body?.userRole, accountType: req.body?.accountType },
      body: {
        feedbackType: req.body?.feedbackType,
        area: req.body?.area,
        subject: req.body?.subject,
        message: req.body?.message,
        rating: req.body?.rating,
        priority: req.body?.priority,
      },
      xhr: true,
      get(header) { return header === "accept" ? "application/json" : undefined; },
    };
    let statusCode = 200;
    let payload = null;
    const fakeRes = {
      status(c) { statusCode = c; return this; },
      json(b) { payload = b; return this; },
    };
    await commonController.feedbackPost(fakeReq, fakeRes, db);
    if (statusCode >= 400 || payload?.success === false) {
      return res.status(statusCode >= 400 ? statusCode : 400).json({ error: payload?.error || "Unable to submit feedback." });
    }
    return res.json({ feedbackId: payload.feedbackId, message: payload.message });
  } catch (error) {
    console.error("[internalApi/submitFeedbackApi]", error);
    return res.status(500).json({ error: "Unable to submit feedback." });
  }
}

const SCHOOL_FONT_OPTIONS = new Set([
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Raleway",
  "Work Sans", "Source Sans Pro", "Ubuntu", "Noto Sans", "PT Serif", "Merriweather", "Playfair Display",
]);

// GET /internal/api/school-customization
async function getSchoolCustomizationApi(req, res) {
  try {
    const organizationId = await assertHasPermissionQuery(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to view school customization settings.");
    const org = (await db.query(
      `SELECT organization_name, organization_address, organization_country, organization_province, organization_currency,
              font_style, name_display_format, date_display_format, nickname_display,
              use_custom_student_id, student_id_prefix, student_id_auto_generate, student_id_start_number
       FROM organizations WHERE organization_id = $1`,
      [organizationId]
    )).rows[0];
    if (!org) return res.status(404).json({ error: "Organization not found." });

    return res.json({
      schoolName: org.organization_name,
      address: org.organization_address,
      country: org.organization_country,
      province: org.organization_province,
      currency: org.organization_currency,
      font: org.font_style,
      nameDisplayFormat: org.name_display_format,
      dateDisplayFormat: org.date_display_format,
      nickname: org.nickname_display,
      studentId: {
        useCustomStudentId: org.use_custom_student_id,
        prefix: org.student_id_prefix,
        autoGenerate: org.student_id_auto_generate,
        startingNumber: org.student_id_start_number,
      },
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/getSchoolCustomizationApi]", error);
    return res.status(500).json({ error: "Unable to load school customization settings." });
  }
}

// POST /internal/api/school-customization/profile - { organizationId, ..., schoolName,
// address?, country (2-letter code), province? } - name and country are always required by the
// real handler (it overwrites all fields together), so both must be given even if only address changes.
async function updateSchoolProfileApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to change the school profile.");
    const current = (await db.query(`SELECT organization_name, organization_address, organization_country, organization_province FROM organizations WHERE organization_id = $1`, [organizationId])).rows[0];

    const capture = makeFlashCapture();
    const fakeReq = {
      session: { organizationId },
      body: {
        orgName: req.body?.schoolName !== undefined ? req.body.schoolName : current?.organization_name,
        orgAddress: req.body?.address !== undefined ? req.body.address : current?.organization_address,
        orgCountry: req.body?.country !== undefined ? req.body.country : current?.organization_country,
        orgProvince: req.body?.province !== undefined ? req.body.province : current?.organization_province,
      },
      flash: capture.flash,
    };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updateOrgNamePost(fakeReq, fakeRes, db);
    const errorEntry = capture.errorEntry();
    if (errorEntry) return res.status(400).json({ error: errorEntry.msg });

    return res.json({ message: capture.successEntry()?.msg || "School profile updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/updateSchoolProfileApi]", error);
    return res.status(500).json({ error: "Unable to update the school profile." });
  }
}

// POST /internal/api/school-customization/font/set - { organizationId, ..., font }
async function setSchoolFontApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to change the school font.");
    const font = String(req.body?.font || "").trim();
    if (!SCHOOL_FONT_OPTIONS.has(font)) {
      return res.status(400).json({ error: `font must be one of: ${[...SCHOOL_FONT_OPTIONS].join(", ")}.` });
    }
    const capture = makeFlashCapture();
    const fakeReq = { session: { organizationId }, body: { font }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updateFontPost(fakeReq, fakeRes, db);
    const errorEntry = capture.errorEntry();
    if (errorEntry) return res.status(400).json({ error: errorEntry.msg });
    return res.json({ font, message: "School font updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setSchoolFontApi]", error);
    return res.status(500).json({ error: "Unable to update the school font." });
  }
}

// POST /internal/api/school-customization/display-preferences/set - { organizationId, ...,
// nameDisplayFormat?: "first_last"|"last_first", dateDisplayFormat?: "dd_mm_yyyy"|"mm_dd_yyyy"|"yyyy_mm_dd" }
async function setDisplayPreferencesApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to change display preferences.");
    const current = (await db.query(`SELECT name_display_format, date_display_format FROM organizations WHERE organization_id = $1`, [organizationId])).rows[0];
    const capture = makeFlashCapture();
    const fakeReq = {
      session: { organizationId },
      body: {
        nameDisplayFormat: req.body?.nameDisplayFormat !== undefined ? req.body.nameDisplayFormat : current?.name_display_format,
        dateDisplayFormat: req.body?.dateDisplayFormat !== undefined ? req.body.dateDisplayFormat : current?.date_display_format,
      },
      flash: capture.flash,
    };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updateDisplayPreferencesPost(fakeReq, fakeRes, db);
    const errorEntry = capture.errorEntry();
    if (errorEntry) return res.status(400).json({ error: errorEntry.msg });
    return res.json({ message: "Display preferences updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setDisplayPreferencesApi]", error);
    return res.status(500).json({ error: "Unable to update display preferences." });
  }
}

// POST /internal/api/school-customization/nickname/set - { organizationId, ..., nickname }
// (this only updates the human-readable display label, NOT the locked .managira.com subdomain)
async function setSchoolNicknameApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to change the school nickname.");
    if (!req.body?.nickname) return res.status(400).json({ error: "nickname is required." });
    const capture = makeFlashCapture();
    // updateNicknamePost calls req.session.save(callback) on success (unlike
    // the other Customize School handlers) - without a real express-session
    // object providing that method, the call throws, which the handler's
    // own try/catch mistakes for the update itself failing (flashing an
    // error even though the DB write already succeeded).
    const fakeReq = { session: { organizationId, save(cb) { if (typeof cb === "function") cb(); } }, body: { orgNickName: req.body.nickname }, flash: capture.flash };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updateNicknamePost(fakeReq, fakeRes, db);
    const errorEntry = capture.errorEntry();
    if (errorEntry) return res.status(400).json({ error: errorEntry.msg });
    return res.json({ nickname: req.body.nickname, message: "School nickname updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setSchoolNicknameApi]", error);
    return res.status(500).json({ error: "Unable to update the school nickname." });
  }
}

// POST /internal/api/school-customization/student-id/set - { organizationId, ...,
// useCustomStudentId?, prefix?, autoGenerate?, startingNumber? } - only pass what's changing.
async function setStudentIdSettingsApi(req, res) {
  try {
    const organizationId = await assertHasPermission(req, PERMISSIONS.MANAGE_SETTINGS, "You don't have permission to change student ID settings.");
    const current = (await db.query(
      `SELECT use_custom_student_id, student_id_prefix, student_id_auto_generate, student_id_start_number FROM organizations WHERE organization_id = $1`,
      [organizationId]
    )).rows[0] || {};
    const useCustomStudentId = req.body?.useCustomStudentId !== undefined ? req.body.useCustomStudentId === true : current.use_custom_student_id;
    const autoGenerate = req.body?.autoGenerate !== undefined ? req.body.autoGenerate === true : current.student_id_auto_generate;
    const prefix = req.body?.prefix !== undefined ? req.body.prefix : current.student_id_prefix;
    const startingNumber = req.body?.startingNumber !== undefined ? req.body.startingNumber : current.student_id_start_number;

    const capture = makeFlashCapture();
    const fakeReq = {
      session: { organizationId },
      body: {
        useCustomStudentId: useCustomStudentId ? "on" : "off",
        studentIdAutoGenerate: autoGenerate ? "on" : "off",
        studentIdPrefix: prefix,
        startingNumber,
      },
      flash: capture.flash,
    };
    const fakeRes = { redirect() {}, status() { return this; } };
    await accountController.updateStudentIdSettingsPost(fakeReq, fakeRes, db);
    const errorEntry = capture.errorEntry();
    if (errorEntry) return res.status(400).json({ error: errorEntry.msg });
    return res.json({ message: "Student ID settings updated." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error("[internalApi/setStudentIdSettingsApi]", error);
    return res.status(500).json({ error: "Unable to update student ID settings." });
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
  listEnrollmentsApi,
  getEnrollmentRosterApi,
  setEnrollmentRosterApi,
  deleteEnrollmentApi,
  listPromotionSchedulesApi,
  getPromotionPreviewApi,
  schedulePromotionApi,
  applyScheduledPromotionApi,
  cancelScheduledPromotionApi,
  reverseAppliedPromotionApi,
  deleteReversedPromotionApi,
  listEmployeesApi,
  createEmployeeApi,
  setEmployeeHoldApi,
  getGuardianDetailsApi,
  listTransportBusesApi,
  listTransportDriversApi,
  listTransportRoutesApi,
  listTransportStopsApi,
  listTransportSchedulesApi,
  getStudentTransportationApi,
  getTransportationLiveStatusApi,
  createTransportBusApi,
  setTransportBusStatusApi,
  deleteTransportBusApi,
  createTransportRouteApi,
  setTransportRouteStatusApi,
  deleteTransportRouteApi,
  createTransportStopApi,
  deleteTransportStopApi,
  createTransportDriverApi,
  setTransportDriverStatusApi,
  deleteTransportDriverApi,
  createTransportScheduleApi,
  setTransportScheduleStatusApi,
  deleteTransportScheduleApi,
  assignStudentTransportationApi,
  removeStudentTransportationApi,
  listEventsApi,
  listSchoolAnnouncementsApi,
  createEventApi,
  updateEventApi,
  deleteEventApi,
  createSchoolAnnouncementApi,
  updateSchoolAnnouncementApi,
  deleteSchoolAnnouncementApi,
  listWebsiteImagesApi,
  listWebsiteArticlesApi,
  getWebsiteAboutUsApi,
  getWebsiteSettingsApi,
  saveWebsiteSectionApi,
  uploadWebsiteSectionImageApi,
  listWebsiteMessagesApi,
  uploadWebsiteImageApi,
  updateWebsiteImageApi,
  deleteWebsiteImageApi,
  createWebsiteArticleApi,
  updateWebsiteArticleApi,
  deleteWebsiteArticleApi,
  updateWebsiteAboutUsApi,
  setWebsiteLayoutApi,
  setWebsiteThemeApi,
  setWebsiteSelfEnrollmentApi,
  listAssessments,
  createTest,
  modifyTest,
  getAssessmentDeleteImpact,
  deleteTest,
  setTestControl,
  setTestDateWindow,
  listQuestionSets,
  listQuestionSetsOverview,
  setTestQuestions,
  getQuestionSetDeleteImpact,
  deleteQuestionSetApi,
  reviewQuestionSetApi,
  reuseQuestionSetApi,
  listQuestionSetStudents,
  postQuestionSetScoresApi,
  unpostQuestionSetScoresApi,
  setStudentAssessmentStatusApi,
  getAttemptForGradingApi,
  saveAttemptGradeApi,
  listDocumentsApi,
  getDocumentApi,
  createDocumentApi,
  setDocumentTitleApi,
  setDocumentTextApi,
  setSheetCellsApi,
  resizeSheetApi,
  insertClassDataIntoSheetApi,
  shareDocumentWithUserApi,
  removeDocumentShareApi,
  assignDocumentToClassApi,
  unassignDocumentFromClassApi,
  deleteDocumentApi,
  getIntegrationsStatusApi,
  getMiraActivationStatusApi,
  listFailedEmailsApi,
  checkEmailAvailabilityApi,
  fixFailedEmailApi,
  getUpcomingBirthdaysApi,
  listStudentsApi,
  checkStudentDuplicatesApi,
  createStudentsApi,
  listPendingAdmissionsApi,
  getPendingAdmissionDetailsApi,
  updatePendingAdmissionApi,
  approvePendingAdmissionApi,
  rejectPendingAdmissionApi,
  getOrganizationStatisticsApi,
  compareClassesApi,
  getReportSettingsApi,
  setReportCardDisplayOptionsApi,
  setGradingScaleBandApi,
  deleteGradingScaleBandApi,
  setPromotionSettingsApi,
  listRemarksApi,
  addRemarkApi,
  deleteRemarkApi,
  getCloseGroupCandidatesApi,
  closeGraduationYearGroupApi,
  listArchivedStudentsApi,
  unarchiveStudentsApi,
  generateReportPdfApi,
  sendReportCardsApi,
  sendMessagesApi,
  listSentMessagesApi,
  getMeritSheetApi,
  generateMeritSheetPdfApi,
  getNotificationPreferencesApi,
  setNotificationPreferencesApi,
  setOrgNotificationPreferencesApi,
  submitFeedbackApi,
  getSchoolCustomizationApi,
  updateSchoolProfileApi,
  setSchoolFontApi,
  setDisplayPreferencesApi,
  setSchoolNicknameApi,
  setStudentIdSettingsApi,
  logActivity,
};
