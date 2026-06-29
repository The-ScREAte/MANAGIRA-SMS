const db = require("../config/db");
const { ensureStudentPortalSchema } = require("../utils/studentPortal");

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
      safeFlash("error", "Please log in as a student.");
      return res.redirect("/account/student-login");
    }

    const organizationId = req.session.organizationId;
    if (!organizationId) {
      return destroyAndRedirect("/account/student-login?reason=session_invalid");
    }

    await ensureStudentPortalSchema(db);

    const orgResult = await db.query(
      "SELECT deleted, on_hold, student_portal_activated FROM organizations WHERE organization_id = $1 LIMIT 1",
      [organizationId]
    );

    if (!orgResult.rows.length || orgResult.rows[0].deleted || orgResult.rows[0].on_hold) {
      return destroyAndRedirect("/account/student-login?reason=school_inactive");
    }

    if (!Boolean(orgResult.rows[0].student_portal_activated)) {
      return destroyAndRedirect("/account/student-login?reason=portal_inactive");
    }

    const studentResult = await db.query(
      `SELECT s.student_id, s.organization_id
         FROM students s
         WHERE s.student_id = $1 AND s.organization_id = $2
         LIMIT 1`,
      [req.session.studentId, organizationId]
    );

    if (!studentResult.rows.length) {
      return destroyAndRedirect("/account/student-login?reason=student_not_found");
    }

    next();
  } catch (error) {
    console.error("Student auth error:", error.message || error);
    return res.redirect("/account/student-login?reason=auth_error");
  }
}

module.exports = { isStudentAuthenticated };
