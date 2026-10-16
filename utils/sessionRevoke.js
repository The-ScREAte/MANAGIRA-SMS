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
