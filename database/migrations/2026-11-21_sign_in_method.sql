-- How each member of staff signs in: 'sso' (their school's single sign-on provider) or
-- 'password' (a Managira password). Empty means a Managira password. Chosen on the staff form
-- while the school's single sign-on is on, or for everyone at once in Settings. Safe to repeat.
DO $$
DECLARE
  fresh BOOLEAN := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'sign_in_method'
  );
BEGIN
  ALTER TABLE users ADD COLUMN IF NOT EXISTS sign_in_method TEXT;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_sign_in_method_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_sign_in_method_check CHECK (sign_in_method IS NULL OR sign_in_method IN ('sso', 'password'));
  END IF;

  -- Before this, everyone at a school with single sign-on turned on was sent to its provider.
  -- They keep signing in that way. Only the first time: running this again changes nobody.
  IF fresh AND to_regclass('sso_connections') IS NOT NULL THEN
    UPDATE users u
       SET sign_in_method = 'sso'
      FROM sso_connections c
     WHERE c.organization_id = u.organization_id
       AND c.status = 'active'
       AND u.sign_in_method IS NULL
       AND u.removed_at IS NULL
       AND u.account_type::text NOT IN ('Admin', 'Mini Admin', 'Internal Worker');
  END IF;
END $$;
