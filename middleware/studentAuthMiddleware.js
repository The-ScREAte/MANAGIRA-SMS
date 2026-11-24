const db = require("../config/db");
const { ensureStudentPortalSchema } = require("../utils/studentPortal");
const { createShortCache } = require("../utils/shortCache");

// The school's state and the student's own row, kept for a few seconds per school instead of
// two lookups on every page and autosave. Anything the school saves clears them straight away
// (utils/shortCache.js).
const schoolGate = createShortCache({ ttlMs: 15000, max: 20000 });
const studentRows = createShortCache({ ttlMs: 15000, max: 50000 });

async function isStudentAuthenticated(req, res, next) {
  const safeFlash = (type, message) => {
    try {
      if (req.session && typeof req.flash === "function") {
        req.flash(type, message);
      }
    } catch (_) {
    }
  };

  try {
    const destroyAndRedirect = (location) => {
      if (req.session && typeof req.session.destroy === "function") {
        return req.session.destroy(() => {
          res.redirect(location);
        });
      }

      return res.redirect(location);
    };

    if (!req.session || !req.session.studentId || req.session.userRole !== "Student") {
      // Nobody signed in any more: the login page says the session timed out.
      const ended = require("../utils/sessionTimeout");
      if (!ended.signedIn(req.session)) {
        res.set("X-Managira-Signed-Out", ended.endedReason(req) || "signed-out");
        return res.redirect(ended.endedLoginUrl(req));
      }
      safeFlash("error", "Please log in as a student.");
      return res.redirect("/account/student-login");
    }

    const organizationId = req.session.organizationId;
    if (!organizationId) {
      return destroyAndRedirect("/account/student-login?reason=session_invalid");
    }

    await ensureStudentPortalSchema(db);

    const orgRow = await schoolGate.get(organizationId, "student-gate", async () => {
      const orgResult = await db.query(
        "SELECT deleted, on_hold, student_portal_activated FROM organizations WHERE organization_id = $1 LIMIT 1",
        [organizationId]
      );
      return orgResult.rows[0] || null;
    });

    if (!orgRow || orgRow.deleted || orgRow.on_hold) {
      return destroyAndRedirect("/account/student-login?reason=school_inactive");
    }

    if (!Boolean(orgRow.student_portal_activated)) {
      return destroyAndRedirect("/account/student-login?reason=portal_inactive");
    }

    const studentRow = await studentRows.get(organizationId, `student:${req.session.studentId}`, async () => {
      const studentResult = await db.query(
        `SELECT s.student_id, s.organization_id, s.first_name, s.last_name
           FROM students s
           WHERE s.student_id = $1 AND s.organization_id = $2
           LIMIT 1`,
        [req.session.studentId, organizationId]
      );
      return studentResult.rows[0] || null;
    });

    if (!studentRow) {
      return destroyAndRedirect("/account/student-login?reason=student_not_found");
    }

    req.session.firstName = studentRow.first_name || req.session.firstName;
    req.session.lastName = studentRow.last_name || req.session.lastName;
    if (req.session.user && typeof req.session.user === "object") {
      req.session.user.first_name = studentRow.first_name || req.session.user.first_name;
      req.session.user.last_name = studentRow.last_name || req.session.user.last_name;
    }

    next();
  } catch (error) {
    // A busy database isn't a reason to sign anyone out: they get the "try again" page and stay signed in.
    if (require("./errorMiddleware").isDatabaseUnavailable(error)) return next(error);
    console.error("Student auth error:", error.message || error);
    return res.redirect("/account/student-login?reason=auth_error");
  }
}

module.exports = { isStudentAuthenticated };
