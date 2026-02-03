-- Migration: Create password_reset_tokens table
-- This table stores password reset tokens for both staff and guardians

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  user_id VARCHAR(255) PRIMARY KEY,
  token VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster token lookup
CREATE INDEX IF NOT EXISTS password_reset_tokens_token_idx ON password_reset_tokens(token);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration completed: password_reset_tokens table created';
END $$;
