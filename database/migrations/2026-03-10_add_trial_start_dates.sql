-- Store trial start dates selected during signup payment flow.
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS trial_start_at TIMESTAMP NULL;

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS trial_starts_at TIMESTAMP NULL;
