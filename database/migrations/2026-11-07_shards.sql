-- Shards: each one is an app server and a database. The control database's copy of these
-- tables is the registry and the school directory; the same empty tables on other shards
-- are simply unused. Nothing here changes how a school works.

CREATE TABLE IF NOT EXISTS shards (
  shard_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'production',
  region TEXT NOT NULL DEFAULT 'us',
  countries TEXT[] NOT NULL DEFAULT '{}',
  hosting_location TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  accepts_new BOOLEAN NOT NULL DEFAULT FALSE,
  is_control BOOLEAN NOT NULL DEFAULT FALSE,
  capacity_schools INTEGER NOT NULL DEFAULT 200,
  capacity_users INTEGER NOT NULL DEFAULT 1000,
  id_block INTEGER NOT NULL UNIQUE,
  app_url TEXT,
  db_url_encrypted TEXT,
  render_service_id TEXT,
  render_postgres_id TEXT,
  provision_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO shards (name, environment, region, status, accepts_new, is_control, id_block, hosting_location)
VALUES ('us-shard-01', 'production', 'us', 'active', TRUE, TRUE, 0, 'oregon')
ON CONFLICT (name) DO NOTHING;

-- Where each school lives. Routing details only, never student or school records.
CREATE TABLE IF NOT EXISTS shard_schools (
  organization_id INTEGER PRIMARY KEY,
  shard_id INTEGER NOT NULL REFERENCES shards (shard_id),
  subdomain TEXT,
  name TEXT,
  country TEXT,
  hub_id INTEGER,
  staff_count INTEGER NOT NULL DEFAULT 0,
  student_count INTEGER NOT NULL DEFAULT 0,
  parent_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shard_schools_shard ON shard_schools (shard_id);
CREATE INDEX IF NOT EXISTS shard_schools_subdomain ON shard_schools (LOWER(subdomain));

-- Where each hub lives. A hub's schools always live with it.
CREATE TABLE IF NOT EXISTS shard_hubs (
  hub_id INTEGER PRIMARY KEY,
  shard_id INTEGER NOT NULL REFERENCES shards (shard_id),
  subdomain TEXT,
  name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shard_hubs_shard ON shard_hubs (shard_id);

CREATE TABLE IF NOT EXISTS shard_moves (
  move_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  organization_ids INTEGER[] NOT NULL DEFAULT '{}',
  hub_id INTEGER,
  school_name TEXT,
  from_shard_id INTEGER NOT NULL REFERENCES shards (shard_id),
  to_shard_id INTEGER NOT NULL REFERENCES shards (shard_id),
  rehearsal BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'running',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB,
  error TEXT,
  requested_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shard_moves_recent ON shard_moves (started_at DESC);

-- A release is a tested commit. Production shards only ever receive an approved one.
CREATE TABLE IF NOT EXISTS shard_releases (
  release_id SERIAL PRIMARY KEY,
  commit_sha TEXT NOT NULL UNIQUE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  tested_on TEXT,
  created_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shard_deployments (
  deployment_id SERIAL PRIMARY KEY,
  release_id INTEGER REFERENCES shard_releases (release_id),
  shard_id INTEGER NOT NULL REFERENCES shards (shard_id),
  commit_sha TEXT NOT NULL,
  previous_commit TEXT,
  status TEXT NOT NULL DEFAULT 'deploying',
  render_deploy_id TEXT,
  is_rollback BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  started_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shard_deployments_recent ON shard_deployments (started_at DESC);

-- Who sees a feature: off, selected schools and hubs, or everyone.
CREATE TABLE IF NOT EXISTS shard_feature_access (
  feature_key TEXT PRIMARY KEY,
  access TEXT NOT NULL DEFAULT 'everyone',
  organization_ids INTEGER[] NOT NULL DEFAULT '{}',
  hub_ids INTEGER[] NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Who did what to shards: every create, change, move and release.
CREATE TABLE IF NOT EXISTS shard_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shard_audit_recent ON shard_audit (created_at DESC);

-- A school being moved is paused so nothing changes while it is copied.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS shard_move_state TEXT;
CREATE INDEX IF NOT EXISTS organizations_shard_move_state ON organizations (organization_id) WHERE shard_move_state IS NOT NULL;
ALTER TABLE managira_hubs ADD COLUMN IF NOT EXISTS shard_move_state TEXT;
