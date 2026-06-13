ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS platform_fee_bearer VARCHAR(20) NOT NULL DEFAULT 'parent'
CHECK (platform_fee_bearer IN ('parent', 'school'));

ALTER TABLE finance_payments
ADD COLUMN IF NOT EXISTS platform_fee_bearer VARCHAR(20);

ALTER TABLE finance_pending_stripe_payments
ADD COLUMN IF NOT EXISTS platform_fee_bearer VARCHAR(20);
