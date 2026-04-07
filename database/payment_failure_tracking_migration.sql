-- Adds recurring payment failure tracking required for retry limits and hold logic.

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS last_failed_payment TIMESTAMP NULL;