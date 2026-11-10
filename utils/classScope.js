"use strict";

// A teacher opens only what the class dashboard offers them: the classes they're assigned to
// (user_classes) and, in a class, the subjects they teach (user_subjects) — or every subject of
// a class they are the main teacher of. Managers, supervisors and other staff aren't limited
// here: their permissions decide. Route middleware for the gradebook and report cards, so a
// teacher can't read or change another class's scores by typing its number in the address.

const isTeacher = (req) => String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "")
  .trim().toLowerCase() === "teacher";

const idOf = (value) => {
  const id = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// The teacher's classes and subjects in this school, or null when the person isn't a teacher.
async function teacherScope(db, req) {
  if (!isTeacher(req)) return null;
  const userId = Number(req.session.userId || req.session.user?.user_id || 0);
  const organizationId = Number(req.session.organizationId);
  const scope = { classes: new Set(), mainClasses: new Set(), subjects: new Set() };
  if (!userId || !organizationId) return scope;
  const [classes, subjects] = await Promise.all([
    db.query(
      `SELECT uc.class_id, COALESCE(uc.main, FALSE) AS main
         FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id
        WHERE uc.user_id = $1 AND c.organization_id = $2`,
      [userId, organizationId]
    ),
    db.query(
      `SELECT s.subject_id, s.class_id
         FROM user_subjects us JOIN subjects s ON s.subject_id = us.subject_id
        WHERE us.user_id = $1 AND s.organization_id = $2`,
      [userId, organizationId]
    ),
  ]);
  classes.rows.forEach((row) => {
    scope.classes.add(Number(row.class_id));
    if (row.main) scope.mainClasses.add(Number(row.class_id));
  });
  subjects.rows.forEach((row) => {
    scope.subjects.add(Number(row.subject_id));
    if (row.class_id) scope.classes.add(Number(row.class_id));
  });
  return scope;
}

// Whether this teacher may work on the class and subject a request names (either may be absent).
async function withinScope(db, organizationId, scope, { classId, subjectId }) {
  if (classId && !scope.classes.has(classId)) return false;
  if (subjectId && !scope.subjects.has(subjectId)) {
    const { rows } = await db.query("SELECT class_id FROM subjects WHERE subject_id = $1 AND organization_id = $2", [subjectId, organizationId]);
    // A subject of another school, or one that no longer exists, names nothing here: the page answers "not found".
    if (rows[0] && !scope.mainClasses.has(Number(rows[0].class_id))) return false;
  }
  return true;
}

function requireClassScope(db) {
  return async (req, res, next) => {
    try {
      // Sandbox schools first: released from Admin › Shards › Releases (teacher_class_scope).
      if (!require("./shards/features").isOn("teacher_class_scope", { organizationId: req.session?.organizationId })) return next();
      const scope = await teacherScope(db, req);
      if (!scope) return next();
      const source = { ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) };
      const named = { classId: idOf(source.classId ?? source.class_id), subjectId: idOf(source.subjectId ?? source.subject_id) };
      if (await withinScope(db, Number(req.session.organizationId), scope, named)) return next();
      const message = "You can only open the classes and subjects you teach.";
      const wantsJson = req.xhr || /json/i.test(req.get("accept") || "") || /json/i.test(req.get("content-type") || "");
      if (wantsJson) return res.status(403).json({ success: false, error: message, message });
      if (req.session && typeof req.flash === "function") req.flash("error", message);
      return res.redirect("/common/orgDashboard");
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { teacherScope, withinScope, requireClassScope };
