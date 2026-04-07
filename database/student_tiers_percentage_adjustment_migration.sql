-- student_tiers_percentage_adjustment_migration.sql
-- Adds adjustment_percentage to plan_student_tiers and backfills it from existing fixed prices.

ALTER TABLE plan_student_tiers
ADD COLUMN IF NOT EXISTS adjustment_percentage DECIMAL(10,2);

UPDATE plan_student_tiers pst
SET adjustment_percentage = ROUND((((pst.price_usd - p.total_cost) / NULLIF(p.total_cost, 0)) * 100)::numeric, 2)
FROM plans p
WHERE pst.plan_id = p.id
  AND pst.adjustment_percentage IS NULL
  AND p.total_cost IS NOT NULL
  AND p.total_cost <> 0;

UPDATE plan_student_tiers
SET adjustment_percentage = 0
WHERE adjustment_percentage IS NULL;