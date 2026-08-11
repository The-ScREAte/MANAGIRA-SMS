-- v2 of the Managira Worker access-grant system.
-- Replaces "grant individual contacts" with a clearer model:
--   contact_access_mode: 'own' (default) | 'all' | 'selected'
--   'selected' pulls in every contact created by / assigned to the chosen
--   source workers (user_extra_worker_contacts), rather than picking
--   one contact at a time.
-- Also adds school (organization) grants so a worker can be given visibility
-- into specific schools on their dashboard, independent of contact access.

ALTER TABLE user_feature_flags
  ADD COLUMN IF NOT EXISTS contact_access_mode TEXT NOT NULL DEFAULT 'own'
    CHECK (contact_access_mode IN ('own', 'all', 'selected'));

CREATE TABLE IF NOT EXISTS user_extra_worker_contacts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  granted_by INT REFERENCES users(user_id),
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_extra_worker_contacts_user
  ON user_extra_worker_contacts(user_id);

CREATE TABLE IF NOT EXISTS user_extra_organizations (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  granted_by INT REFERENCES users(user_id),
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_user_extra_organizations_user
  ON user_extra_organizations(user_id);
