-- 3 Months and 6 Months are offered again, with the discounts they had: schools pay on them.
-- (2026-11-15_plan_page.sql had taken them off the list of choices.)
UPDATE dynamic_billing_cycles SET is_active = TRUE, updated_at = NOW() WHERE cycle_key IN ('3_months', '6_months') AND NOT is_active;
