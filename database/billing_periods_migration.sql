-- billing_periods_migration.sql
-- Adds billing_periods table and billing_period_key column to payments

-- 1. Create billing_periods table
CREATE TABLE IF NOT EXISTS billing_periods (
  id SERIAL PRIMARY KEY,
  period_key VARCHAR(30) UNIQUE NOT NULL,
  label VARCHAR(50) NOT NULL,
  months INT NOT NULL,
  discount_percentage INT NOT NULL DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 50),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Seed default billing periods
INSERT INTO billing_periods (period_key, label, months, discount_percentage, is_active, sort_order)
VALUES
  ('monthly',  'Monthly',  1,  0,  TRUE, 1),
  ('6_months', '6 Months', 6,  10, TRUE, 2),
  ('yearly',   '1 Year',   12, 15, TRUE, 3),
  ('2_years',  '2 Years',  24, 25, TRUE, 4)
ON CONFLICT (period_key) DO NOTHING;

-- 3. Add billing_period_key column to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_period_key VARCHAR(30) DEFAULT 'monthly';
