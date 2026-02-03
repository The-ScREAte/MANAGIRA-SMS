-- Migration: Make password_hash nullable in guardian_accounts table
-- This allows creating guardian accounts before password is set

ALTER TABLE guardian_accounts ALTER COLUMN password_hash DROP NOT NULL;

-- Add updated_at column if not exists
ALTER TABLE guardian_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration completed: guardian_accounts.password_hash is now nullable';
END $$;
