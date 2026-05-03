const db = require('../config/db');
(async () => {
  try {
    const users = await db.query(
      "SELECT user_id, email, first_name, last_name, account_type, organization_id FROM users WHERE account_type IN ('Admin','Mini Admin','Internal Worker') AND organization_id IS NULL ORDER BY user_id"
    );
    console.log('--- Admin-side users ---');
    console.table(users.rows);

    const total = await db.query('SELECT COUNT(*)::int AS c FROM user_sessions');
    console.log('Total session rows:', total.rows[0].c);

    const withUser = await db.query(
      "SELECT sid, expire, sess::text AS sess_text FROM user_sessions WHERE sess::jsonb ? 'userId' ORDER BY expire DESC LIMIT 30"
    );
    console.log('--- Sessions WITH userId ---', withUser.rows.length);
    for (const r of withUser.rows) {
      const j = JSON.parse(r.sess_text);
      console.log({
        sid: r.sid,
        userId: j.userId,
        accountType: j.accountType,
        userRole: j.userRole,
        organizationId: j.organizationId,
        expires: j.cookie && j.cookie.expires,
      });
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
})();
