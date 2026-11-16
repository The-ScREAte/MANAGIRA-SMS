-- Two-step sign-in with an authenticator app (feature sign_in_authenticator, utils/signInMfa.js).
-- A school's rule: off (each person chooses), required for managers and supervisors, or required
-- for all staff. A manager can also require it for one person. The codes themselves live in
-- account_mfa (2026-11-28_migration_core.sql). Safe to repeat.
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS mfa_required TEXT NOT NULL DEFAULT 'off';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_settings_mfa_required_check') THEN
    ALTER TABLE tenant_settings ADD CONSTRAINT tenant_settings_mfa_required_check CHECK (mfa_required IN ('off', 'admins', 'staff'));
  END IF;
END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT FALSE;
