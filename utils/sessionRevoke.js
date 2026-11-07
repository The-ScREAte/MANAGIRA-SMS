"use strict";

// Signs an account out everywhere (deletes its rows in user_sessions), e.g.
// after a password change, so a stolen or forgotten session stops working.
// exceptSid keeps the current browser signed in when the user changed the
// password themselves.
async function revokeSessions(db, { userId, organizationOwnerId, studentId, guardianId, hubOwnerId, hubUserId, exceptSid } = {}) {
  const match = [];
  const params = [];
  const add = (sql, value) => {
    params.push(String(value));
    match.push(sql.replace("$?", `$${params.length}`));
  };
  if (userId) add("sess->>'userId' = $?", userId);
  if (organizationOwnerId) add("(sess->>'accountType' = 'Organization' AND sess->>'organizationId' = $?)", organizationOwnerId);
  if (studentId) add("(sess->>'accountType' = 'Student' AND sess->>'studentId' = $?)", studentId);
  if (guardianId) add("sess->>'guardianId' = $?", guardianId);
  if (hubOwnerId) add("(sess->>'accountType' = 'Hub' AND sess->>'hubId' = $? AND sess->>'hubUserId' IS NULL)", hubOwnerId);
  if (hubUserId) add("sess->>'hubUserId' = $?", hubUserId);
  if (!match.length) return 0;

  // A browser remembered for its sign-in code isn't trusted any more either.
  const keys = [
    userId && `user:${userId}`, organizationOwnerId && `owner:${organizationOwnerId}`, studentId && `student:${studentId}`,
    guardianId && `guardian:${guardianId}`, hubOwnerId && `hub:${hubOwnerId}`, hubUserId && `hubuser:${hubUserId}`,
  ].filter(Boolean);
  await db.query("DELETE FROM login_trusted_devices WHERE account_key = ANY($1::text[])", [keys]).catch(() => {});

  let sql = `DELETE FROM user_sessions WHERE (${match.join(" OR ")})`;
  if (exceptSid) {
    params.push(String(exceptSid));
    sql += ` AND sid <> $${params.length}`;
  }
  try {
    const result = await db.query(sql, params);
    return result.rowCount || 0;
  } catch (error) {
    console.error("[Sessions] Could not sign out other sessions:", error.message);
    return 0;
  }
}

module.exports = { revokeSessions };
