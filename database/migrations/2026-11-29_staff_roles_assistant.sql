-- Assistant teachers, and staff roles in the data migration. Safe to run again.

-- Assistant teachers (feature assistant_teacher, utils/mainTeacher.js): beside a class's one
-- main teacher, any number of assistants, who see and work on the whole class like it without
-- being the one in charge.
ALTER TABLE user_classes ADD COLUMN IF NOT EXISTS assistant BOOLEAN NOT NULL DEFAULT FALSE;

-- Each role or access group of the school's old system, matched to a Managira role
-- (utils/migration/roles.js): a built-in one, or a custom one (account type and permissions).
CREATE TABLE IF NOT EXISTS migration_roles (
  role_id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES migration_jobs(job_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  old_role TEXT NOT NULL,
  staff_count INTEGER NOT NULL DEFAULT 0,
  level TEXT,
  target TEXT,
  confidence TEXT NOT NULL DEFAULT 'none',
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  label TEXT,
  account_type TEXT,
  permissions JSONB,
  notes JSONB,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, old_role)
);
-- The school admin's approval of each person whose access goes up or is admin-level.
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS role_approvals JSONB NOT NULL DEFAULT '{}'::jsonb;

-- A member of staff's roles in the old system, read-only and as exported: their role, each
-- school and each class role with its dates. Inactive staff keep theirs without an account.
CREATE TABLE IF NOT EXISTS staff_role_history (
  history_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  job_id INTEGER REFERENCES migration_jobs(job_id) ON DELETE SET NULL,
  source_system TEXT,
  source_id TEXT,
  email TEXT,
  name TEXT,
  kind TEXT NOT NULL,
  value TEXT,
  detail JSONB,
  start_date DATE,
  end_date DATE,
  active BOOLEAN,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_role_history_user_idx ON staff_role_history (organization_id, user_id);
CREATE INDEX IF NOT EXISTS staff_role_history_email_idx ON staff_role_history (organization_id, lower(email));
CREATE INDEX IF NOT EXISTS staff_role_history_job_idx ON staff_role_history (job_id);

-- Every change to a member of staff's role, permissions or class roles: who, when, before, after.
CREATE TABLE IF NOT EXISTS staff_role_changes (
  change_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  user_id INTEGER,
  changed_by TEXT,
  changed_by_id INTEGER,
  what TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_role_changes_user_idx ON staff_role_changes (organization_id, user_id, at DESC);

-- When an imported member of staff first saw their "Your access" page.
CREATE TABLE IF NOT EXISTS staff_access_seen (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
