// While a school's data migration sandbox is open (utils/dataMigration.js), its live account
// takes no new data: staff see a banner, and anything that would save (POST, PUT, PATCH,
// DELETE) is refused, except the migration itself, signing in and out, and reading
// notifications. The state is read once per school every 30 seconds.
const db = require("../config/db");
const migration = require("../utils/dataMigration");

const OPEN = [/^\/common\/migration(\/|$)/, /^\/account\//, /^\/notifications\//, /^\/common\/ui-preferences\//, /^\/admin(\/|$)/, /^\/logout/];
const isOrgAdmin = (session) => {
  const role = String(session.userRole || session.user?.account_type || "").toLowerCase();
  return String(session.accountType || "").toLowerCase() === "organization" || role === "manager";
};

module.exports = async function migrationLock(req, res, next) {
  const session = req.session || {};
  const organizationId = session.organizationId;
  res.locals.migrationState = null;
  // Staff only: parents and students, and Managira's own staff, are never held back here.
  if (!organizationId || session.guardianId || session.studentId || session.hubId) return next();
  try {
    if (!migration.featureOn(organizationId)) return next();
    const state = await migration.stateFor(db, organizationId);
    if (!state) return next();
    res.locals.migrationState = { ...state, isAdmin: isOrgAdmin(session) };
    if (!state.locked || ["GET", "HEAD", "OPTIONS"].includes(req.method) || OPEN.some((rule) => rule.test(req.path))) return next();
    const message = "Your school's data is moving to Managira. Nothing new can be saved until the move is finished.";
    if ((req.headers.accept || "").includes("application/json") || req.xhr) return res.status(423).json({ success: false, error: message, message });
    req.flash("error", message);
    return res.redirect(req.get("Referer") || "/");
  } catch (error) {
    return next(); // The lock never stops a page if its state can't be read.
  }
};
module.exports.isOrgAdmin = isOrgAdmin;
