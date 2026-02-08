const db = require('./config/db');

(async () => {
  try {
    console.log('Checking Fosco organization hub data...\n');
    
    const result = await db.query(`
      SELECT 
        o.organization_name, 
        o.nickname, 
        o.hub_id, 
        o.is_hub_member, 
        mh.hub_name, 
        mh.logo_path as hub_logo
      FROM organizations o
      LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
      WHERE o.nickname = 'fosco'
    `);
    
    if (result.rows.length > 0) {
      console.log('Organization Data:');
      console.log(JSON.stringify(result.rows[0], null, 2));
      console.log('\n');
      console.log('Hub Info Present?', result.rows[0].hub_id ? 'YES' : 'NO');
      console.log('Is Hub Member?', result.rows[0].is_hub_member ? 'YES' : 'NO');
      console.log('Hub Logo Present?', result.rows[0].hub_logo ? 'YES' : 'NO');
    } else {
      console.log('Organization "fosco" not found!');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
