// scripts/runBillingPeriodsMigration.js
const db = require('../config/db');

(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS billing_periods (
        id SERIAL PRIMARY KEY,
        period_key VARCHAR(30) UNIQUE NOT NULL,
        label VARCHAR(50) NOT NULL,
        months INT NOT NULL,
        discount_percentage INT NOT NULL DEFAULT 0
          CHECK (discount_percentage >= 0 AND discount_percentage <= 50),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('1. billing_periods table created');

    await db.query(`
      INSERT INTO billing_periods (period_key, label, months, discount_percentage, is_active, sort_order)
      VALUES
        ('monthly',  'Monthly',  1,  0,  TRUE, 1),
        ('6_months', '6 Months', 6,  10, TRUE, 2),
        ('yearly',   '1 Year',   12, 15, TRUE, 3),
        ('2_years',  '2 Years',  24, 25, TRUE, 4)
      ON CONFLICT (period_key) DO NOTHING
    `);
    console.log('2. Default billing periods seeded');

    await db.query(`
      ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS billing_period_key VARCHAR(30) DEFAULT 'monthly'
    `);
    console.log('3. billing_period_key column added to payments');

    const result = await db.query('SELECT * FROM billing_periods ORDER BY sort_order');
    console.log('\nBilling Periods:');
    console.table(result.rows.map(r => ({
      key: r.period_key,
      label: r.label,
      months: r.months,
      discount: r.discount_percentage + '%',
      active: r.is_active
    })));

    process.exit(0);
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  }
})();
