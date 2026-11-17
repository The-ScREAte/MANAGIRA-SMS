"use strict";

// Where a student's page opens: never on its own, always inside the app's workspaces.
//  - their class's workspace, as a tab: /common/classDashboard/<class>/student/<id>
//    (a teacher only for a class they're assigned to, as the classroom itself allows);
//  - otherwise Admissions › All Students, with the student's page in the panel.
// Used by the student page when it's opened directly, and by the person card's "Open student page".
async function studentHome(db, req, studentId, { termId = null, classId = null } = {}) {
  const organizationId = Number(req.session && req.session.organizationId);
  const id = Number(studentId);
  if (!organizationId || !Number.isInteger(id) || id <= 0) return null;
  const { rows } = await db.query("SELECT class_id FROM students WHERE student_id = $1 AND organization_id = $2", [id, organizationId]);
  if (!rows[0]) return null;
  // The class the link named (the term's class), if it's this school's; else the student's class now.
  let klass = Number(classId) || null;
  if (klass) {
    const ok = await db.query("SELECT 1 FROM classes WHERE class_id = $1 AND organization_id = $2", [klass, organizationId]);
    if (!ok.rows.length) klass = null;
  }
  klass = klass || Number(rows[0].class_id) || null;
  const role = String(req.session.userRole || req.session.accountType || "").trim().toLowerCase();
  if (klass && role === "teacher") {
    const userId = Number(req.session.userId || (req.session.user && req.session.user.user_id) || 0);
    const mine = await db.query("SELECT 1 FROM user_classes WHERE user_id = $1 AND class_id = $2 LIMIT 1", [userId, klass]);
    if (!mine.rows.length) klass = null;
  }
  const term = termId ? `?termId=${encodeURIComponent(termId)}` : "";
  if (klass) return `/common/classDashboard/${klass}/student/${id}${term}`;
  const page = `/common/studentDetails?studentId=${id}${termId ? `&termId=${encodeURIComponent(termId)}` : ""}`;
  return `/common/admissions?panel=all-students&page=${encodeURIComponent(page)}&label=${encodeURIComponent("All Students")}`;
}

module.exports = { studentHome };
