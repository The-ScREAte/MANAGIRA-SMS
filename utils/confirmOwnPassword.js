const { BoundedMap } = require("./boundedMap");
// "Enter your password to continue" for sensitive actions: checks the signed-in
// person's own password (a staff user, or the school's own account), with a
// limit on wrong tries (correct ones never count against it).
const bcrypt = require("./passwordHashing");
const db = require("../config/db");

const MAX_WRONG = 5;
const WINDOW_MS = 10 * 60 * 1000;
const wrongTries = new BoundedMap(5000, { keepUnderPressure: true });

async function confirmOwnPassword(req, password) {
  const key = req.sessionID || req.ip;
  const now = Date.now();
  const entry = wrongTries.get(key);
  if (entry && now - entry.start < WINDOW_MS && entry.count >= MAX_WRONG) {
    throw Object.assign(new Error("Too many wrong tries. Wait a few minutes and try again."), { status: 429 });
  }
  const typed = String(password || "");
  if (!typed) throw Object.assign(new Error("Enter your password."), { status: 400 });
  const session = req.session || {};
  const organizationId = Number(session.organizationId);
  const userId = Number(session.userId || (session.user && session.user.user_id)) || null;
  const { rows } = userId
    ? await db.query("SELECT password FROM users WHERE user_id = $1 AND organization_id = $2", [userId, organizationId])
    : await db.query("SELECT password FROM organizations WHERE organization_id = $1", [organizationId]);
  const hash = rows[0] && rows[0].password;
  if (!hash || !(await bcrypt.compare(typed, hash))) {
    if (!entry || now - entry.start >= WINDOW_MS) wrongTries.set(key, { start: now, count: 1 });
    else entry.count += 1;
    throw Object.assign(new Error("That password is not correct."), { status: 401 });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of wrongTries.entries()) if (now - entry.start > WINDOW_MS) wrongTries.delete(key);
}, 15 * 60 * 1000).unref();

module.exports = { confirmOwnPassword };
