// Activities for families: parents see their children's (the whole school's, their classes'
// and those just for one of them); students see their own. From today, for 90 days.
const db = require("../config/db");
const features = require("../utils/shards/features");
const { listActivities } = require("../utils/classActivities");
const { childrenOf } = require("./parentHubController");

const DAY_MS = 86400000;
const dayKey = (date) => date.toISOString().slice(0, 10);

async function upcomingFor(organizationId, people) {
  const from = dayKey(new Date());
  const to = dayKey(new Date(Date.now() + 90 * DAY_MS));
  const classIds = [...new Set(people.map((p) => Number(p.classId)).filter(Boolean))];
  const list = await listActivities(db, organizationId, { classIds, studentIds: people.map((p) => Number(p.id)), from, to });
  // Whose activity it is, in words a family uses.
  return list.map((a) => {
    let who = "Whole school";
    if (a.studentId) who = (people.find((p) => Number(p.id) === a.studentId) || {}).name || a.studentName || "";
    else if (a.classId) {
      const kids = people.filter((p) => Number(p.classId) === a.classId).map((p) => p.name);
      who = kids.length && people.length > 1 ? kids.join(", ") : (a.className || "Class");
    }
    return { ...a, who };
  });
}

function render(res, view, { activities, calendarHref, title }) {
  return res.render("common/familyActivities", { title, activities, calendarHref, viewer: view });
}

module.exports = {
  // GET /guardian/activities
  guardianPage: async (req, res) => {
    const organizationId = Number(req.session.organizationId);
    if (!features.isOn("class_activities", { organizationId })) return res.redirect("/guardian/dashboard");
    try {
      const children = await childrenOf(db, organizationId, req.session.guardianId);
      const activities = children.length ? await upcomingFor(organizationId, children) : [];
      return render(res, "parent", { activities, calendarHref: "/guardian/calendar", title: "Activities" });
    } catch (error) {
      console.error("[Family activities] parent:", error.message);
      req.flash("error", "Activities could not load. Try again.");
      return res.redirect("/guardian/dashboard");
    }
  },

  // GET /student/activities
  studentPage: async (req, res) => {
    const organizationId = Number(req.session.organizationId);
    if (!features.isOn("class_activities", { organizationId })) return res.redirect("/student/dashboard");
    try {
      const me = (await db.query(
        "SELECT student_id, first_name, class_id FROM students WHERE organization_id = $1 AND student_id = $2",
        [organizationId, req.session.studentId]
      )).rows[0];
      const activities = me ? await upcomingFor(organizationId, [{ id: me.student_id, name: me.first_name, classId: me.class_id }]) : [];
      activities.forEach((a) => { if (a.studentId) a.who = "Just for you"; });
      return render(res, "student", { activities, calendarHref: "/student/calendar", title: "Activities" });
    } catch (error) {
      console.error("[Family activities] student:", error.message);
      req.flash("error", "Activities could not load. Try again.");
      return res.redirect("/student/dashboard");
    }
  },
};
