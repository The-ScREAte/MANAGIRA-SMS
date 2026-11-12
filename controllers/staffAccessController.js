"use strict";
// "Your access" (utils/staffRoles.js): a member of staff's role, school, classes and what they
// can and can't do. Everyone sees their own (imported staff first see it when they open
// Managira); the school's admins can open anyone's, with their old-system role history and the
// log of changes to their role.
const staffRoles = require("../utils/staffRoles");
const { isOrgAdmin } = require("../middleware/migrationLock");

const toId = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

async function page(req, res, db) {
  const s = req.session || {};
  const organizationId = Number(s.organizationId);
  const self = toId(s.userId || (s.user && s.user.user_id));
  const admin = isOrgAdmin(s);
  const asked = toId(req.params.userId);
  if (!organizationId || s.guardianId || s.studentId || !(await staffRoles.on(db, organizationId))) return res.redirect("/");
  const schoolAccount = String(s.accountType || "").toLowerCase() === "organization";
  const userId = asked || (schoolAccount ? null : self);
  if (!userId || (asked && asked !== self && !admin)) {
    if (schoolAccount) { req.flash("info", "You're signed in as the school, which can do everything. Open a member of staff from Users to see their access."); return res.redirect("/common/orgDashboard"); }
    return res.status(404).send("Not found.");
  }
  const data = await staffRoles.accessPage(db, { organizationId, userId, admin, allowedFeatures: res.locals.planFeaturesKnown ? res.locals.allowedFeatures : null });
  if (!data) return res.status(404).send("Not found.");
  const own = userId === self;
  if (own) await staffRoles.markSeen(db, organizationId, userId);
  return res.render("common/myAccess", { title: own ? "Your access" : `Access: ${data.user.first_name} ${data.user.last_name}`, ...data, own, admin, first: own && req.query.first === "1", messages: req.flash() });
}

// Before the dashboard: an imported member of staff's first visit opens "Your access" (once a session is enough to ask).
async function firstVisit(req, res, db) {
  if (req.session.accessChecked) return false;
  req.session.accessChecked = true;
  if (!(await staffRoles.firstVisitDue(db, req).catch(() => false))) return false;
  res.redirect("/common/my-access?first=1");
  return true;
}

module.exports = {
  page: async (req, res, db) => { try { return await page(req, res, db); } catch (error) { console.error("[my-access]", error.message); req.flash("error", "That page couldn't open. Try again."); return res.redirect("/"); } },
  firstVisit,
};
