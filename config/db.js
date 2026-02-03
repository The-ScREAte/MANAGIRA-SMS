const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DB_CONNECTION_STRING,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  idleTimeoutMillis: 5000,           // 🔹 Close idle clients after 5 seconds
  connectionTimeoutMillis: 5000      // 🔹 Fail if connection takes longer than 5 seconds
});

pool.on('connect', () => {
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

module.exports = pool;
