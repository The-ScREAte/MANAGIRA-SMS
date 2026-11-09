"use strict";

// Staff side of activities: a teacher's class tab and the Management Tools page.
const activities = require("../utils/classActivities");
const features = require("../utils/shards/features");

const MANAGERS = new Set(["organization", "admin", "mini admin", "manager", "supervisor", "superviser"]);
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const actorOf = (req) => ({
  userId: req.session.userId || req.session.user?.user_id || null,
  name: [req.session.firstName || req.session.user?.first_name, req.session.lastName || req.session.user?.last_name].filter(Boolean).join(" ").trim(),
});
const isOn = (req) => features.isOn("class_activities", { organizationId: req.session.organizationId });

// The whole school needs Events & Announcements; a class also opens to its own teachers.
async function canChange(db, req, res, classId) {
  const role = String(req.session.userRole || req.session.accountType || "").toLowerCase();
  const held = res.locals.userPermissions || [];
  if (MANAGERS.has(role) || held.includes("publish_events_announcements")) return true;
  if (!classId) return false;
  const { rows } = await db.query(
    "SELECT 1 FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id WHERE uc.user_id = $1 AND uc.class_id = $2 AND c.organization_id = $3 LIMIT 1",
    [actorOf(req).userId || 0, classId, req.session.organizationId]
  );
  return rows.length > 0;
}

async function answer(res, work) {
  try {
    return res.json({ success: true, ...(await work()) });
  } catch (error) {
    if (error instanceof activities.ActivityError) return res.status(error.status).json({ success: false, message: error.message });
    console.error("[Activities]", error.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Try again." });
  }
}

function refuseWhenOff(req) {
  if (!isOn(req)) throw new activities.ActivityError("Not available.", 404);
}

module.exports = {
  // Activities sit with events and announcements (one place): the old page opens that tab.
  page: async (req, res, db) => {
    if (!isOn(req) || !res.locals.workspaceAccess().management.activities) {
      req.flash("error", "You do not have permission to access that page.");
      return res.redirect("/common/management");
    }
    if (!req.query.standalone) {
      const embed = req.query.embed || (String(req.get("sec-fetch-dest") || "").toLowerCase() === "iframe" ? "workspace" : "");
      return res.redirect(`/common/manageEventsAnnouncements?tab=activities${embed ? `&embed=${encodeURIComponent(embed)}` : ""}`);
    }
    try {
      const { rows: classes } = await db.query(
        "SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY LOWER(class_name)",
        [req.session.organizationId]
      );
      return res.render("common/manageActivities", {
        title: "Activities",
        classes: classes.map((row) => ({ id: Number(row.class_id), name: row.class_name })),
      });
    } catch (error) {
      console.error("[Activities] page:", error.message);
      req.flash("error", "Activities could not load. Try again.");
      return res.redirect("/common/management");
    }
  },

  list: (req, res, db) => answer(res, async () => {
    refuseWhenOff(req);
    const classId = toId(req.query.classId);
    if (!(await canChange(db, req, res, classId))) throw new activities.ActivityError("You can only see your own classes.", 403);
    const list = await activities.listActivities(db, req.session.organizationId, { classIds: classId ? [classId] : null, from: req.query.from, to: req.query.to });
    // A class's tab: its own activities and those for one of its students.
    return { activities: classId ? list.filter((row) => row.classId === classId || row.studentId) : list, oneStudent: await activities.hasExtras(db) };
  }),

  // Where this person can add an activity, for the dashboard's New task dialog: the whole school
  // and every class (Events & Announcements), or a teacher's own classes.
  classes: (req, res, db) => answer(res, async () => {
    refuseWhenOff(req);
    const organizationId = req.session.organizationId;
    const wholeSchool = await canChange(db, req, res, null);
    const { rows } = wholeSchool
      ? await db.query("SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL ORDER BY LOWER(class_name)", [organizationId])
      : await db.query(
        `SELECT c.class_id, c.class_name FROM classes c
          WHERE c.organization_id = $2 AND c.obsolete_at IS NULL
            AND EXISTS (SELECT 1 FROM user_classes uc WHERE uc.class_id = c.class_id AND uc.user_id = $1)
          ORDER BY LOWER(c.class_name)`,
        [actorOf(req).userId || 0, organizationId]
      );
    return {
      wholeSchool,
      classes: rows.map((row) => ({ id: Number(row.class_id), name: row.class_name })),
      oneStudent: await activities.hasExtras(db),
    };
  }),

  // The students of a class, to pick one for an activity just for them.
  students: (req, res, db) => answer(res, async () => {
    refuseWhenOff(req);
    const classId = toId(req.query.classId);
    if (!classId) return { students: [] };
    if (!(await canChange(db, req, res, classId))) throw new activities.ActivityError("You can only see your own classes.", 403);
    const { rows } = await db.query(
      `SELECT student_id, first_name, last_name FROM students
        WHERE organization_id = $1 AND class_id = $2 AND COALESCE(graduated, FALSE) = FALSE
        ORDER BY LOWER(first_name), LOWER(last_name)`,
      [req.session.organizationId, classId]
    );
    return { students: rows.map((row) => ({ id: Number(row.student_id), name: [row.first_name, row.last_name].filter(Boolean).join(" ") })) };
  }),

  save: (req, res, db) => answer(res, async () => {
    refuseWhenOff(req);
    const organizationId = req.session.organizationId;
    const id = toId(req.body?.id);
    let classId = toId(req.body?.classId);
    const studentId = toId(req.body?.studentId);
    const activity = activities.readActivity(req.body);
    // For one student: their class decides who may add it, and the activity follows the student.
    if (studentId) {
      const student = (await db.query("SELECT class_id FROM students WHERE organization_id = $1 AND student_id = $2", [organizationId, studentId])).rows[0];
      if (!student) throw new activities.ActivityError("That student isn't part of this school.");
      classId = null;
      if (!(await canChange(db, req, res, toId(student.class_id)))) throw new activities.ActivityError("You can only add activities for students in your own classes.", 403);
    } else {
      if (classId) {
        const known = await db.query("SELECT 1 FROM classes WHERE organization_id = $1 AND class_id = $2", [organizationId, classId]);
        if (!known.rows.length) throw new activities.ActivityError("That class isn't part of this school.");
      }
      if (!(await canChange(db, req, res, classId))) throw new activities.ActivityError("You can only add activities for your own classes.", 403);
    }
    if (id) {
      const current = await activities.findActivity(db, organizationId, id);
      if (!current) throw new activities.ActivityError("That activity no longer exists.", 404);
      const owner = current.student_id ? toId(current.student_class_id) : toId(current.class_id);
      if (!(await canChange(db, req, res, owner))) throw new activities.ActivityError("You can only change activities for your own classes.", 403);
    }
    return { id: await activities.saveActivity(db, organizationId, actorOf(req), id, classId, activity, studentId) };
  }),

  remove: (req, res, db) => answer(res, async () => {
    refuseWhenOff(req);
    const organizationId = req.session.organizationId;
    const id = toId(req.params.id);
    const current = id ? await activities.findActivity(db, organizationId, id) : null;
    if (!current) throw new activities.ActivityError("That activity no longer exists.", 404);
    const owner = current.student_id ? toId(current.student_class_id) : toId(current.class_id);
    if (!(await canChange(db, req, res, owner))) throw new activities.ActivityError("You can only change activities for your own classes.", 403);
    await activities.deleteActivity(db, organizationId, id);
    return {};
  }),
};
