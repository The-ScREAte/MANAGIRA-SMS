-- The plan page a new school sees (views/account/servicePlan.ejs): two ways to pay, monthly or a
-- year at 10% off, and Pro's line says "start using Mira" (Full Mira is Premium's).
-- The other cycles stop being offered; a school already paying on one keeps it
-- (resolveBillingCycle reads a school's own cycle whether or not it is still offered).
UPDATE dynamic_billing_cycles SET is_active = FALSE, updated_at = NOW() WHERE cycle_key IN ('3_months', '6_months', '2_years') AND is_active;
UPDATE dynamic_billing_cycles SET discount_percentage = 10, is_active = TRUE, updated_at = NOW() WHERE cycle_key = 'yearly';
UPDATE plans SET description = 'For schools that test online, issue transcripts and start using Mira.' WHERE plan_name = 'Pro' AND description = 'For schools that test online, issue transcripts and want Mira.';
