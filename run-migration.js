// Run migration script
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'database', 'migrations', '2026-02-04_add_guardian_image_and_linking_table.sql'),
      'utf8'
    );
    
    await pool.query(sql);
    console.log('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
