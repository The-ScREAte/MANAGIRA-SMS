// A school's data migration sandbox (utils/dataMigration.js). Once Managira gives a school its
// sandbox, the school's managers turn it on or off from the header menu. While it's on, staff see
// a thin line along the top of the header, managers see Data migration, and the live account
// takes no new data: anything that would save (POST, PUT, PATCH, DELETE) is refused, except the
// migration itself (and its switch), signing in and out, and reading notifications. The state is
// read once per school every 30 seconds.
const db = require("../config/db");
const migration = require("../utils/dataMigration");
require("../utils/migration/tasks").wakeAfterStart(db);

const OPEN = [/^\/common\/migration(\/|$)/, /^\/account\//, /^\/notifications\//, /^\/common\/ui-preferences\//, /^\/admin(\/|$)/, /^\/logout/];
const isOrgAdmin = (session) => {
  const role = String(session.userRole || session.user?.account_type || "").toLowerCase();
  return String(session.accountType || "").toLowerCase() === "organization" || role === "manager";
};

module.exports = async function migrationLock(req, res, next) {
  const session = req.session || {};
  const organizationId = session.organizationId;
  res.locals.migrationState = null;
  res.locals.migrationOffered = false; // Managers see Data migration (a request until Managira opens it).
  // Staff only: parents and students, and Managira's own staff, are never held back here.
  if (!organizationId || session.guardianId || session.studentId || session.hubId) return next();
  try {
    if (!migration.featureOn(organizationId)) return next();
    const state = await migration.stateFor(db, organizationId);
    // No sandbox, or Managira turned it off: managers see the request form in Management.
    if (!state || !state.allowed) {
      res.locals.migrationOffered = isOrgAdmin(session) && (await migration.ready(db));
      return next();
    }
    res.locals.migrationState = { ...state, isAdmin: isOrgAdmin(session) };
    if (!state.locked || ["GET", "HEAD", "OPTIONS"].includes(req.method) || OPEN.some((rule) => rule.test(req.path))) return next();
    const message = "Your school's sandbox is on: nothing new can be saved while it is. A manager can turn it off from the menu.";
    if ((req.headers.accept || "").includes("application/json") || req.xhr) return res.status(423).json({ success: false, error: message, message });
    req.flash("error", message);
    return res.redirect(req.get("Referer") || "/");
  } catch (error) {
    return next(); // The lock never stops a page if its state can't be read.
  }
};
module.exports.isOrgAdmin = isOrgAdmin;
