"use strict";

// A teacher opens only what the class dashboard offers them: the classes they're assigned to
// (user_classes) and, in a class, the subjects they teach (user_subjects) — or every subject of
// a class they are the main teacher or an assistant teacher of. Managers, supervisors and other staff aren't limited
// here: their permissions decide. Route middleware for the gradebook and report cards, so a
// teacher can't read or change another class's scores by typing its number in the address.

const isTeacher = (req) => String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "")
  .trim().toLowerCase() === "teacher";

// Only a plain positive whole number counts as an id ("0x9" or "9abc" don't): the controllers
// read the same value with Number() or SQL, which would understand a different number.
const idOf = (value) => {
  const raw = String(Array.isArray(value) ? value[0] : (value ?? "")).trim();
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
// A class or subject id was sent but isn't a plain id: refused rather than let through.
const malformed = (value) => value !== undefined && value !== null && String(Array.isArray(value) ? value[0] : value).trim() !== "" && idOf(value) === null;

// The teacher's classes and subjects in this school, or null when the person isn't a teacher.
async function teacherScope(db, req) {
  if (!isTeacher(req)) return null;
  const userId = Number(req.session.userId || req.session.user?.user_id || 0);
  const organizationId = Number(req.session.organizationId);
  const scope = { classes: new Set(), mainClasses: new Set(), subjects: new Set() };
  if (!userId || !organizationId) return scope;
  const whole = await require("./mainTeacher").wholeClassSql(db, "uc");
  const [classes, subjects] = await Promise.all([
    db.query(
      `SELECT uc.class_id, ${whole} AS main
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

// The classes a list may offer this person: a set for a teacher,
// null for everyone else. A page listing classes filters by it, so it never offers a class
// whose pages would refuse the teacher.
async function listScope(db, req) {
  const scope = await teacherScope(db, req);
  return scope ? scope.classes : null;
}

function requireClassScope(db) {
  return async (req, res, next) => {
    try {
      const scope = await teacherScope(db, req);
      if (!scope) return next();
      const source = { ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) };
      const named = { classId: idOf(source.classId ?? source.class_id), subjectId: idOf(source.subjectId ?? source.subject_id) };
      // The query and the body must name the same class and subject: the guard reads one, a
      // controller might read the other.
      const differ = (a, b) => a !== undefined && b !== undefined && String(a) !== String(b);
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const query = req.query || {};
      const split = ["classId", "class_id", "subjectId", "subject_id"].some((k) => differ(query[k], body[k]));
      const bad = ["classId", "class_id", "subjectId", "subject_id"].some((k) => malformed(source[k]));
      if (!split && !bad && await withinScope(db, Number(req.session.organizationId), scope, named)) return next();
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

// Attendance and lunch: a teacher works only on a class they lead (its main teacher or an
// assistant), the same classes the attendance page offers them. Everyone else: their permissions.
function requireLeadsClass(db) {
  return async (req, res, next) => {
    try {
      const scope = await teacherScope(db, req);
      if (!scope) return next();
      const source = { ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) };
      const classId = idOf(source.classId ?? source.class_id);
      const bad = malformed(source.classId) || malformed(source.class_id);
      if (!bad && (!classId || scope.mainClasses.has(classId))) return next();
      const message = "You can take attendance only for the classes you lead.";
      const wantsJson = req.method !== "GET" || req.xhr || /json/i.test(req.get("accept") || "") || /json/i.test(req.get("content-type") || "");
      if (wantsJson) return res.status(403).json({ success: false, error: message, message });
      if (req.session && typeof req.flash === "function") req.flash("error", message);
      return res.redirect("/common/orgDashboard");
    } catch (error) {
      return next(error);
    }
  };
}

// The classes a teacher or supervisor is assigned to here (a teacher's include the classes of the
// subjects they teach), or null for everyone else. The header search shows these two roles only
// their own classes' students and parents, so the pages behind it keep to the same classes.
async function assignedClasses(db, req) {
  const role = String(req.session?.userRole || req.session?.user?.account_type || req.session?.accountType || "").trim().toLowerCase();
  if (role === "teacher") return (await teacherScope(db, req)).classes;
  if (role !== "supervisor" && role !== "superviser") return null;
  const userId = Number(req.session.userId || req.session.user?.user_id || 0);
  const organizationId = Number(req.session.organizationId);
  if (!userId || !organizationId) return new Set();
  const { rows } = await db.query(
    "SELECT uc.class_id FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id WHERE uc.user_id = $1 AND c.organization_id = $2",
    [userId, organizationId]
  );
  return new Set(rows.map((row) => Number(row.class_id)));
}

// Which of these students belong to the given classes: by their class now, a class they're
// enrolled in (in the term asked for, when one is), or a subject of one of those classes they take.
async function studentsInClasses(db, organizationId, studentIds, classIds, termId = null) {
  const ids = [...new Set((studentIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const classes = [...(classIds || [])].map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length || !classes.length) return new Set();
  const { rows } = await db.query(
    `SELECT s.student_id
       FROM students s
      WHERE s.organization_id = $1 AND s.student_id = ANY($2::int[])
        AND (s.class_id = ANY($3::int[])
             OR EXISTS (SELECT 1 FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
                         WHERE es.student_id = s.student_id AND e.organization_id = $1 AND es.class_id = ANY($3::int[])
                           AND ($4::int IS NULL OR e.term_id = $4::int))
             OR EXISTS (SELECT 1 FROM student_subjects ss JOIN subjects sub ON sub.subject_id = ss.subject_id
                         WHERE ss.student_id = s.student_id AND ss.organization_id = $1 AND sub.class_id = ANY($3::int[])))`,
    [organizationId, ids, classes, idOf(termId)]
  );
  return new Set(rows.map((row) => Number(row.student_id)));
}

// Assessment actions that work on a whole group (lock, delete, edit its marks): a teacher only
// when every assessment of the group is a class and subject they teach, the same rule as the
// gradebook. A group a manager made across other classes is theirs to change.
function requireGroupScope(db) {
  return async (req, res, next) => {
    try {
      const scope = await teacherScope(db, req);
      if (!scope) return next();
      const source = { ...(req.query || {}), ...(req.body && typeof req.body === "object" ? req.body : {}) };
      const groupId = idOf(source.groupId ?? source.group_id);
      const organizationId = Number(req.session.organizationId);
      let ok = Boolean(groupId);
      if (ok) {
        const { rows } = await db.query("SELECT DISTINCT class_id, subject_id FROM assessments WHERE group_id = $1 AND organization_id = $2", [groupId, organizationId]);
        for (const row of rows) {
          if (!(await withinScope(db, organizationId, scope, { classId: Number(row.class_id) || null, subjectId: Number(row.subject_id) || null }))) { ok = false; break; }
        }
      }
      if (ok) return next();
      const message = "You can only change assessments of the classes and subjects you teach.";
      const wantsJson = req.xhr || /json/i.test(req.get("accept") || "") || /json/i.test(req.get("content-type") || "");
      if (wantsJson) return res.status(403).json({ success: false, error: message, message });
      if (req.session && typeof req.flash === "function") req.flash("error", message);
      return res.redirect("/common/orgDashboard");
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { teacherScope, withinScope, listScope, requireClassScope, requireLeadsClass, requireGroupScope, assignedClasses, studentsInClasses };
