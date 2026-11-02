// "Enter your password to continue" for sensitive actions: checks the signed-in
// person's own password (a staff user, or the school's own account), with a
// limit on wrong tries.
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { checkRateLimit } = require("./rateLimiter");

async function confirmOwnPassword(req, password) {
  const limit = checkRateLimit(`confirm-password:${req.sessionID || req.ip}`, { max: 5, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) throw Object.assign(new Error("Too many tries. Wait a few minutes and try again."), { status: 429 });
  const typed = String(password || "");
  if (!typed) throw Object.assign(new Error("Enter your password."), { status: 400 });
  const session = req.session || {};
  const organizationId = Number(session.organizationId);
  const userId = Number(session.userId || (session.user && session.user.user_id)) || null;
  const { rows } = userId
    ? await db.query("SELECT password FROM users WHERE user_id = $1 AND organization_id = $2", [userId, organizationId])
    : await db.query("SELECT password FROM organizations WHERE organization_id = $1", [organizationId]);
  const hash = rows[0] && rows[0].password;
  if (!hash || !(await bcrypt.compare(typed, hash))) throw Object.assign(new Error("That password is not correct."), { status: 401 });
}

module.exports = { confirmOwnPassword };
