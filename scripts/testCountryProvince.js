/**
 * Test script: verify country/province columns in organizations table.
 * Runs INSERT and UPDATE in transactions that are rolled back (no data is saved).
 */
const db = require('../config/db');

(async () => {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  }

  // Test 1: columns exist
  await test('DB columns exist (organization_country, organization_province)', async () => {
    await db.query('SELECT organization_country, organization_province FROM organizations LIMIT 1');
  });

  // Test 2: INSERT with new columns (rolled back)
  await test('INSERT with country/province (dry run)', async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Use a subquery to get a valid plan_id rather than hardcoding 1
      const planRes = await client.query('SELECT id FROM plans LIMIT 1');
      const planId = planRes.rows[0] ? planRes.rows[0].id : 1;
      const r = await client.query(
        `INSERT INTO organizations
           (organization_name, nickname, organization_address, organization_country, organization_province,
            organization_phone, email, password, proof_of_existence_1, plan_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING organization_id`,
        ['Test Country Org', 'testcountry1', '123 Test St', 'Canada', 'Ontario',
         '+1234567890', 'testcountry1@example.com', 'hashedpw', 'proof.jpg', planId]
      );
      if (!r.rows[0].organization_id) throw new Error('No organization_id returned');
      console.log('   → Inserted with org_id:', r.rows[0].organization_id, '(rolling back)');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // Test 3: UPDATE with new columns (rolled back)
  await test('UPDATE country/province (dry run)', async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE organizations
         SET organization_country = $1, organization_province = $2
         WHERE organization_id = (SELECT organization_id FROM organizations LIMIT 1)`,
        ['Nigeria', 'Lagos']
      );
      console.log('   → UPDATE executed successfully (rolling back)');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // Test 4: syntax check all modified controllers
  await test('Controller files have valid syntax', async () => {
    const { execSync } = require('child_process');
    const files = [
      'controllers/accountController.js',
      'controllers/hubController.js',
      'controllers/adminController.js',
      'controllers/printController.js',
      'controllers/transcriptController.js',
    ];
    for (const f of files) {
      execSync(`node --check ${f}`, { cwd: __dirname + '/..' });
    }
  });

  console.log('');
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('Unexpected error:', e.message);
  process.exit(1);
}).finally(() => db.end());
