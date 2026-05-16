'use strict';
const db = require('../config/db');
(async () => {
  const org = await db.query(`SELECT organization_id, organization_name FROM organizations WHERE organization_name ILIKE '%Managira%' LIMIT 5`);
  console.log('ORGS:', JSON.stringify(org.rows, null, 2));
  const user = await db.query(`SELECT user_id, first_name, last_name, account_type, organization_id FROM users WHERE first_name ILIKE '%Managira%' LIMIT 5`);
  console.log('USERS:', JSON.stringify(user.rows, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
