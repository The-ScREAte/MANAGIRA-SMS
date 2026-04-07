-- student_tiers_migration.sql
-- Adds plan_student_tiers table and columns on organizations for student-count pricing

-- 1. Create plan_student_tiers table
CREATE TABLE IF NOT EXISTS plan_student_tiers (
  id           SERIAL PRIMARY KEY,
  plan_id      INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  label        VARCHAR(100) NOT NULL,
  min_students INT NOT NULL DEFAULT 0,
  max_students INT,
  price_usd    DECIMAL(10,2) NOT NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_tiers_plan ON plan_student_tiers(plan_id);

-- 2. Add tier tracking columns to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS selected_student_tier_id INT REFERENCES plan_student_tiers(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS approx_student_count INT;

-- 3. Track whether we already notified this org about exceeding their tier
--    Reset to FALSE whenever the org changes tier
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS student_tier_exceeded_notified BOOLEAN DEFAULT FALSE;
