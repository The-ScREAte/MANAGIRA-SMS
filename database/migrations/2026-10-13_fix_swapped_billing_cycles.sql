-- On 2026-09-22 the "Monthly" and "3 Months" cycles were edited onto each
-- other's keys: key 'monthly' became 3 months and key '3_months' became 1 month.
-- Schools that chose "Monthly" before that date are on key 'monthly' and would
-- have been charged for 3 months at their next renewal. Put each key back to
-- what it means, and move the school that chose "Monthly" after that date
-- (saved under '3_months') onto 'monthly'.
BEGIN;
UPDATE dynamic_billing_cycles SET label = 'Monthly', months = 1, discount_percentage = 0, sort_order = 0, updated_at = NOW()
 WHERE cycle_key = 'monthly';
UPDATE dynamic_billing_cycles SET label = '3 Months', months = 3, discount_percentage = 1, sort_order = 1, updated_at = NOW()
 WHERE cycle_key = '3_months';
UPDATE payments SET billing_period_key = 'monthly'
 WHERE billing_period_key = '3_months'
   AND organization_id IN (SELECT organization_id FROM organizations WHERE created_at >= '2026-09-22');
COMMIT;
