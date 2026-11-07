-- Browsers that have entered a sign-in code. The same account on the same browser isn't asked
-- for a code again until the trust runs out (30 days after it was last used). Only a hash of
-- the browser's random token is stored. Safe to run more than once.
CREATE TABLE IF NOT EXISTS login_trusted_devices (
  id BIGSERIAL PRIMARY KEY,
  device_hash TEXT NOT NULL,
  account_key TEXT NOT NULL,
  organization_id INT REFERENCES organizations(organization_id) ON DELETE CASCADE,
  hub_id INT,
  device_family TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (device_hash, account_key)
);
CREATE INDEX IF NOT EXISTS login_trusted_devices_account_idx ON login_trusted_devices (account_key);
CREATE INDEX IF NOT EXISTS login_trusted_devices_expires_idx ON login_trusted_devices (expires_at);
