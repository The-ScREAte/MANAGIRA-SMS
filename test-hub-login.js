const db = require('./config/db');

(async () => {
  try {
    console.log('Testing hub logo data retrieval during login simulation...\n');
    
    // Simulate what happens during staff user login
    const orgResult = await db.query(`
      SELECT o.*, 
             CASE WHEN o.hub_id IS NOT NULL THEN mh.hub_name ELSE NULL END as hub_name,
             CASE WHEN o.hub_id IS NOT NULL THEN mh.logo_path ELSE NULL END as hub_logo
      FROM organizations o
      LEFT JOIN managira_hubs mh ON o.hub_id = mh.hub_id
      WHERE o.nickname = 'fosco'
    `);
    
    if (orgResult.rows.length > 0) {
      const org = orgResult.rows[0];
      console.log('Organization Data Retrieved:');
      console.log('- Organization Name:', org.organization_name);
      console.log('- Hub ID:', org.hub_id);
      console.log('- Is Hub Member:', org.is_hub_member);
      console.log('- Hub Name:', org.hub_name);
      console.log('- Hub Logo:', org.hub_logo);
      console.log('\n');
      
      console.log('Session Data that WOULD be set:');
      if (org.is_hub_member && org.hub_id) {
        console.log('✅ HUB DATA WOULD BE SET:');
        console.log('   - isHubMember: true');
        console.log('   - hubName:', org.hub_name);
        console.log('   - hubLogo:', org.hub_logo);
        
        // Check if logo is valid
        const isValidLogo = org.hub_logo && 
                           !org.hub_logo.endsWith('/hub-logos') && 
                           !org.hub_logo.endsWith('/images/hub-logos');
        console.log('   - Logo is valid:', isValidLogo ? 'YES ✓' : 'NO ✗');
      } else {
        console.log('❌ HUB DATA WOULD NOT BE SET');
        console.log('   - is_hub_member:', org.is_hub_member);
        console.log('   - hub_id:', org.hub_id);
      }
    } else {
      console.log('Organization not found!');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
