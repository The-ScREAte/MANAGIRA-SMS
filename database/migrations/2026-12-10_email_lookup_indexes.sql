-- Lookups by email address (sign-in, email choices, invitations) compare LOWER(email). Without
-- these indexes each one reads the whole table. Built without blocking writes, and safe to repeat.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guardian_profiles_email_lower ON guardian_profiles (LOWER(email));
