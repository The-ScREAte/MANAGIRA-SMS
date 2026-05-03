const db = require('../config/db');
(async () => {
  try {
    const r = await db.query(
      "SELECT sid, expire, sess::text AS sess_text FROM user_sessions ORDER BY expire DESC LIMIT 15"
    );
    console.log('rows:', r.rows.length);
    for (const row of r.rows) {
      console.log('---');
      console.log('sid:', row.sid);
      console.log('expire:', row.expire);
      console.log('sess:', row.sess_text);
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
})();
