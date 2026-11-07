-- Private calendar links for parents and students. Only a hash of each link is searchable,
-- and the link itself is stored locked, so reading this table doesn't reveal anyone's link.
CREATE TABLE IF NOT EXISTS family_calendar_feeds (
  feed_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('guardian', 'student')),
  owner_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_locked TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, owner_kind, owner_id)
);
