-- Mira skills (feature mira_skills, mira/services/skills.js): playbooks Mira follows. A personal
-- skill belongs to one member of staff; a school skill is made by someone with Mira Settings and
-- applies to everyone at the school. use_mode: 'auto' (when the request matches), 'always' (every
-- chat), 'manual' (only when picked in the composer).
CREATE TABLE IF NOT EXISTS mira_skills (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  scope         VARCHAR(10) NOT NULL CHECK (scope IN ('personal', 'school')),
  owner_user_id INTEGER NULL,
  name          VARCHAR(80) NOT NULL,
  description   VARCHAR(300) NOT NULL DEFAULT '',
  instructions  TEXT NOT NULL,
  use_mode      VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (use_mode IN ('auto', 'always', 'manual')),
  keywords      TEXT[] NOT NULL DEFAULT '{}',
  template_key  VARCHAR(60) NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    INTEGER NULL,
  updated_by    INTEGER NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mira_skills_tenant_idx ON mira_skills (tenant_id, scope, owner_user_id);
