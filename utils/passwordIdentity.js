"use strict";

// Who a password-reset or set-password link belongs to, so the new password can be checked against
// their own name and email (utils/passwordRules.js). Read-only; anything not found gives {}.
const attempt = async (query) => { try { return (await query()).rows[0] || null; } catch (_) { return null; } };

// The emailed reset link: the token is stored hashed (sha256) on users, organizations or hubs.
async function forResetToken(db, hashedToken) {
  const user = await attempt(() => db.query("SELECT email, first_name, last_name FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW() LIMIT 1", [hashedToken]));
  if (user) return { email: user.email, firstName: user.first_name, lastName: user.last_name };
  const org = await attempt(() => db.query("SELECT email, first_name, last_name, organization_name FROM organizations WHERE reset_password_token = $1 AND reset_password_expires > NOW() LIMIT 1", [hashedToken]));
  if (org) return { email: org.email, firstName: org.first_name, lastName: org.last_name, organizationName: org.organization_name };
  const hub = await attempt(() => db.query("SELECT hub_email AS email FROM managira_hubs WHERE reset_password_token = $1 AND reset_password_expires > NOW() LIMIT 1", [hashedToken]));
  return hub ? { email: hub.email } : {};
}

// The set-password link (password_reset_tokens.token): a parent, a student or a member of staff.
async function forSetPasswordToken(db, token) {
  const row = await attempt(() => db.query("SELECT user_id FROM password_reset_tokens WHERE token = $1", [token]));
  const id = row ? String(row.user_id || "") : "";
  if (!id) return {};
  if (id.startsWith("guardian_")) {
    const g = await attempt(() => db.query(
      `SELECT a.login_email AS email, p.first_name, p.last_name FROM guardian_accounts a
         LEFT JOIN guardian_profiles p ON p.guardian_id = a.guardian_id WHERE a.guardian_id = $1 LIMIT 1`, [id.replace("guardian_", "")]));
    return g ? { email: g.email, firstName: g.first_name, lastName: g.last_name } : {};
  }
  if (id.startsWith("student_")) {
    const s = await attempt(() => db.query(
      `SELECT a.login_email AS email, st.first_name, st.last_name FROM student_accounts a
         LEFT JOIN students st ON st.student_id = a.student_id WHERE a.student_id = $1 LIMIT 1`, [id.replace("student_", "")]));
    return s ? { email: s.email, firstName: s.first_name, lastName: s.last_name } : {};
  }
  const u = await attempt(() => db.query("SELECT email, first_name, last_name FROM users WHERE user_id::text = $1 LIMIT 1", [id]));
  return u ? { email: u.email, firstName: u.first_name, lastName: u.last_name } : {};
}

module.exports = { forResetToken, forSetPasswordToken };
