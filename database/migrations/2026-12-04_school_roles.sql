-- A school's own staff roles (utils/schoolRoles.js, feature school_roles): a name, the built-in role
-- it's based on (its account type) and the permissions it gives. Picking one on the staff form
-- ticks its permissions; the person keeps the role's name. Safe to run again.
CREATE TABLE IF NOT EXISTS school_roles (
  role_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_type TEXT NOT NULL CHECK (base_type IN ('Manager', 'Supervisor', 'Teacher', 'Driver')),
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS school_roles_name_idx ON school_roles (organization_id, LOWER(name)) WHERE archived_at IS NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_role_id INTEGER REFERENCES school_roles(role_id) ON DELETE SET NULL;
-- A data migration's old role matched to one of the school's own roles (utils/migration/roles.js).
ALTER TABLE IF EXISTS migration_roles ADD COLUMN IF NOT EXISTS school_role_id INTEGER;
