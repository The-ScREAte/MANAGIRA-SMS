-- Migration: Add reset_password_token columns to guardian_accounts
-- Allows guardians to use the forget password flow

ALTER TABLE guardian_accounts ADD COLUMN IF NOT EXISTS reset_password_token VARCHAR(255);
ALTER TABLE guardian_accounts ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_guardian_accounts_reset_token 
  ON guardian_accounts(reset_password_token) 
  WHERE reset_password_token IS NOT NULL;

DO $$
BEGIN
    RAISE NOTICE 'Migration completed: guardian_accounts now supports password reset tokens';
END $$;
