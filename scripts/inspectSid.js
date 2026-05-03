const db = require('../config/db');
const sid = process.argv[2];
(async () => {
  try {
    if (sid) {
      const r = await db.query("SELECT sid, expire, sess::text AS sess_text FROM user_sessions WHERE sid=$1", [sid]);
      console.log(JSON.stringify(r.rows, null, 2));
    } else {
      const r = await db.query("SELECT sid, expire, sess::text AS sess_text FROM user_sessions WHERE sess::jsonb ? 'userId' ORDER BY expire DESC LIMIT 5");
      console.log('rows with userId:', r.rows.length);
      for (const row of r.rows) console.log(row);
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
})();
