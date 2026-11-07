-- Single sign-on: one connection per school, the sign-ins in progress, and a record of each
-- attempt. A secret is never stored readable, and nothing here works until a manager has
-- tested the connection and turned it on with their password.
CREATE TABLE IF NOT EXISTS sso_connections (
  connection_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(organization_id) ON DELETE CASCADE,
  public_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK (protocol IN ('saml', 'oidc')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'tested', 'active')),
  saml_entity_id TEXT,
  saml_sso_url TEXT,
  saml_certificates TEXT[] NOT NULL DEFAULT '{}',
  email_attribute TEXT,
  oidc_issuer TEXT,
  oidc_client_id TEXT,
  oidc_client_secret_locked TEXT,
  allow_students BOOLEAN NOT NULL DEFAULT FALSE,
  require_sso BOOLEAN NOT NULL DEFAULT FALSE,
  tested_at TIMESTAMPTZ,
  tested_email TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sso_login_requests (
  request_id TEXT PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES sso_connections(connection_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'test')),
  browser_hash TEXT NOT NULL,
  nonce TEXT,
  verifier_locked TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sso_login_requests_expires ON sso_login_requests (expires_at);

CREATE TABLE IF NOT EXISTS sso_events (
  event_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  email TEXT,
  outcome TEXT NOT NULL,
  detail TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sso_events_org ON sso_events (organization_id, created_at DESC);

-- Managers who run a school's settings can set this up, and a school can take it away from any
-- of them on their staff form. It does nothing until the feature reaches their school.
INSERT INTO user_permissions (user_id, organization_id, permission_key)
SELECT DISTINCT u.user_id, u.organization_id, 'manage_sso'
  FROM users u
  JOIN user_permissions p ON p.user_id = u.user_id AND p.permission_key = 'manage_settings'
 WHERE u.account_type = 'Manager' AND u.organization_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Whether the school's main manager was the one who turned it on. Until they have, single
-- sign-on doesn't sign in their account, so no other manager can sign in as them.
ALTER TABLE sso_connections ADD COLUMN IF NOT EXISTS turned_on_by_main BOOLEAN NOT NULL DEFAULT FALSE;
