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
  page: async (req, res, db) => {
    if (!isOn(req) || !res.locals.workspaceAccess().management.activities) {
      req.flash("error", "You do not have permission to access that page.");
      return res.redirect("/common/management");
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
    return { activities: classId ? list.filter((row) => row.classId === classId) : list };
  }),

  save: (req, res, db) => answer(res, async () => {
    refuseWhenOff(req);
    const organizationId = req.session.organizationId;
    const id = toId(req.body?.id);
    const classId = toId(req.body?.classId);
    const activity = activities.readActivity(req.body);
    if (classId) {
      const known = await db.query("SELECT 1 FROM classes WHERE organization_id = $1 AND class_id = $2", [organizationId, classId]);
      if (!known.rows.length) throw new activities.ActivityError("That class isn't part of this school.");
    }
    if (!(await canChange(db, req, res, classId))) throw new activities.ActivityError("You can only add activities for your own classes.", 403);
    if (id) {
      const current = await activities.findActivity(db, organizationId, id);
      if (!current) throw new activities.ActivityError("That activity no longer exists.", 404);
      if (!(await canChange(db, req, res, toId(current.class_id)))) throw new activities.ActivityError("You can only change activities for your own classes.", 403);
    }
    return { id: await activities.saveActivity(db, organizationId, actorOf(req), id, classId, activity) };
  }),

  remove: (req, res, db) => answer(res, async () => {
    refuseWhenOff(req);
    const organizationId = req.session.organizationId;
    const id = toId(req.params.id);
    const current = id ? await activities.findActivity(db, organizationId, id) : null;
    if (!current) throw new activities.ActivityError("That activity no longer exists.", 404);
    if (!(await canChange(db, req, res, toId(current.class_id)))) throw new activities.ActivityError("You can only change activities for your own classes.", 403);
    await activities.deleteActivity(db, organizationId, id);
    return {};
  }),
};
