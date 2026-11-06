// Who may touch shards: a platform super admin, checked against the database on every
// request, on the control shard, who has confirmed their password in the last 30 minutes.
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const registry = require("../utils/shards/registry");

const FRESH_MS = 30 * 60 * 1000;
const SUPER_ADMIN_TYPES = ["Admin", "super_admin"];

const wantsJson = (req) => /application\/json/.test(req.headers.accept || "") || req.xhr;
const userIdOf = (req) => req.session?.userId || req.session?.user?.user_id || null;

function refuse(req, res) {
  if (wantsJson(req)) return res.status(403).json({ success: false, message: "Not allowed." });
  req.flash("error", "You do not have permission to access this page.");
  return res.redirect("/admin");
}

async function requireSuperAdmin(req, res, next) {
  try {
    const session = req.session || {};
    if (!SUPER_ADMIN_TYPES.includes(session.accountType) || session.superAdminOrgSwitch) return refuse(req, res);
    const { rows } = await db.query(
      "SELECT email FROM users WHERE user_id = $1 AND organization_id IS NULL AND account_type::text = ANY($2::text[]) AND COALESCE(on_hold, FALSE) = FALSE",
      [userIdOf(req), SUPER_ADMIN_TYPES]
    );
    if (!rows.length) return refuse(req, res);
    req.shardActor = rows[0].email;
    const me = await registry.thisShard();
    if (me && !me.is_control) return res.status(404).end();
    return next();
  } catch (error) {
    return next(error);
  }
}

const safeNext = (value) => (/^\/admin\/shards(\/[\w/-]*)?(\?[\w=&-]*)?$/.test(String(value || "")) ? value : "/admin/shards");

function requireFreshPassword(req, res, next) {
  if (Date.now() - Number(req.session.shardConfirmedAt || 0) < FRESH_MS) return next();
  if (wantsJson(req) || req.method !== "GET") {
    if (wantsJson(req)) return res.status(401).json({ success: false, message: "Confirm your password first.", confirm: "/admin/shards/confirm" });
    return res.redirect("/admin/shards/confirm");
  }
  return res.redirect(`/admin/shards/confirm?next=${encodeURIComponent(req.originalUrl)}`);
}

function confirmPage(req, res) {
  res.render("admin/shards/confirm", { title: "Confirm password", next: safeNext(req.query.next) });
}

async function confirmPassword(req, res, next) {
  const back = safeNext(req.body.next);
  try {
    const { rows } = await db.query("SELECT password FROM users WHERE user_id = $1 AND organization_id IS NULL", [userIdOf(req)]);
    const matches = rows[0]?.password && await bcrypt.compare(String(req.body.password || ""), rows[0].password);
    if (!matches) {
      registry.audit(req, "password_check_failed");
      req.flash("error", "That password isn't right.");
      return res.redirect(`/admin/shards/confirm?next=${encodeURIComponent(back)}`);
    }
    req.session.shardConfirmedAt = Date.now();
    return res.redirect(back);
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireSuperAdmin, requireFreshPassword, confirmPage, confirmPassword };
