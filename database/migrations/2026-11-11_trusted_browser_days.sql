-- A browser is remembered after a sign-in code for 3 days unless the school chooses otherwise
-- (Settings, Tenant configuration). Safe to run more than once.
ALTER TABLE tenant_settings ALTER COLUMN remember_device_days SET DEFAULT 3;
