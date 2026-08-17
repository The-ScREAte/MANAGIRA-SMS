-- Unified announcement/broadcast system (modal + banner), role/org/user targeting, frequency capping.
-- Applied automatically at runtime via utils/announcementSystem.js#ensureAnnouncementSchema;
-- this file documents the schema for reference/manual application.
--
-- Table names are prefixed `broadcast_` deliberately: a table literally named
-- `announcements` already exists (org-level "Events & Announcements", a
-- different feature/schema entirely - announcement_id, message,
-- organization_id, school_year_id, term_id, visibility). Reusing that name
-- would make CREATE TABLE IF NOT EXISTS silently no-op against the wrong table.

CREATE TABLE IF NOT EXISTS broadcast_announcements (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  body            TEXT NOT NULL,
  image_url       TEXT NULL,
  display_type    VARCHAR(10) NOT NULL DEFAULT 'modal'  CHECK (display_type IN ('modal','banner')),
  variant         VARCHAR(10) NOT NULL DEFAULT 'info'    CHECK (variant IN ('info','success','warning','new')),
  cta_links       JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{label,url,style,ack_required}]
  dismissible     BOOLEAN NOT NULL DEFAULT TRUE,
  frequency       VARCHAR(20) NOT NULL DEFAULT 'once'
                    CHECK (frequency IN ('once','once_per_session','every_login','daily','n_times','until_dismissed','until_date')),
  max_views       INTEGER NULL,
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at         TIMESTAMPTZ NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      INTEGER NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcast_announcements_tenant_active_idx ON broadcast_announcements(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS broadcast_announcements_window_idx ON broadcast_announcements(starts_at, ends_at);

CREATE TABLE IF NOT EXISTS broadcast_announcement_targets (
  id               SERIAL PRIMARY KEY,
  announcement_id  INTEGER NOT NULL REFERENCES broadcast_announcements(id) ON DELETE CASCADE,
  target_type      VARCHAR(10) NOT NULL CHECK (target_type IN ('role','org','user')),
  target_value     VARCHAR(255) NOT NULL   -- role name string | organization_id as text | user_id as text
);
CREATE INDEX IF NOT EXISTS broadcast_announcement_targets_lookup_idx ON broadcast_announcement_targets(announcement_id, target_type, target_value);

CREATE TABLE IF NOT EXISTS broadcast_announcement_receipts (
  id               SERIAL PRIMARY KEY,
  announcement_id  INTEGER NOT NULL REFERENCES broadcast_announcements(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL,
  viewer_type      VARCHAR(10) NOT NULL DEFAULT 'staff' CHECK (viewer_type IN ('staff','guardian','student')),  -- guardians/students are separate ID spaces from users.user_id; disambiguates receipts to avoid cross-namespace collisions
  tenant_id        INTEGER NULL,
  view_count       INTEGER NOT NULL DEFAULT 0,
  first_seen_at    TIMESTAMPTZ NULL,
  last_seen_at     TIMESTAMPTZ NULL,
  dismissed_at     TIMESTAMPTZ NULL,
  acknowledged_at  TIMESTAMPTZ NULL,
  UNIQUE (announcement_id, viewer_type, user_id)
);
CREATE INDEX IF NOT EXISTS broadcast_announcement_receipts_user_idx ON broadcast_announcement_receipts(viewer_type, user_id, announcement_id);
CREATE INDEX IF NOT EXISTS broadcast_announcement_receipts_tenant_idx ON broadcast_announcement_receipts(tenant_id);
