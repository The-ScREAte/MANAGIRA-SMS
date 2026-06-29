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
    if (!req.session || !req.session.studentId || req.session.userRole !== "Student") {
      safeFlash("error", "Please log in as a student.");
      return res.redirect("/account/student-login");
    }

    const organizationId = req.session.organizationId;
    if (!organizationId) {
      safeFlash("error", "Session is missing school information.");
      req.session.destroy(() => {});
      return res.redirect("/account/student-login");
    }

    const orgResult = await db.query(
      "SELECT deleted, on_hold FROM organizations WHERE organization_id = $1 LIMIT 1",
      [organizationId]
    );

    if (!orgResult.rows.length || orgResult.rows[0].deleted || orgResult.rows[0].on_hold) {
      safeFlash("error", "School account is not active.");
      req.session.destroy(() => {});
      return res.redirect("/account/student-login");
    }

    await ensureStudentPortalSchema(db);

    const studentResult = await db.query(
      `SELECT s.student_id, s.organization_id
         FROM students s
         WHERE s.student_id = $1 AND s.organization_id = $2
         LIMIT 1`,
      [req.session.studentId, organizationId]
    );

    if (!studentResult.rows.length) {
      safeFlash("error", "Student account not found.");
      req.session.destroy(() => {});
      return res.redirect("/account/student-login");
    }

    next();
  } catch (error) {
    console.error("Student auth error:", error.message || error);
    safeFlash("error", "Authentication error.");
    return res.redirect("/account/student-login");
  }
}

module.exports = { isStudentAuthenticated };
