-- Login page ads (Admin > Announcements > Login page ads).
-- Also created at runtime by utils/loginAds.js ensureLoginAdsSchema().
CREATE TABLE IF NOT EXISTS login_ads (
  id SERIAL PRIMARY KEY,
  title TEXT,
  media_type TEXT NOT NULL,
  media_url TEXT NOT NULL,
  s3_key TEXT,
  mime_type TEXT,
  media_width INTEGER,
  media_height INTEGER,
  link_url TEXT,
  link_label TEXT,
  show_as_button BOOLEAN NOT NULL DEFAULT TRUE,
  button_x NUMERIC(6,2) NOT NULL DEFAULT 50,
  button_y NUMERIC(6,2) NOT NULL DEFAULT 85,
  button_color TEXT NOT NULL DEFAULT '#e4572e',
  button_text_color TEXT NOT NULL DEFAULT '#ffffff',
  button_size TEXT NOT NULL DEFAULT 'md',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_ads_active_order_idx
  ON login_ads (is_active, sort_order, id);

-- Placement (sign-in pages / inside the app), in-app delivery, scheduling and click stats.
ALTER TABLE login_ads
  ADD COLUMN IF NOT EXISTS show_on_login BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_in_app BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS app_position VARCHAR(12) NOT NULL DEFAULT 'bottom-right',
  ADD COLUMN IF NOT EXISTS app_frequency VARCHAR(20) NOT NULL DEFAULT 'once_per_session',
  ADD COLUMN IF NOT EXISTS app_max_views INTEGER,
  ADD COLUMN IF NOT EXISTS app_roles TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_clicks INTEGER NOT NULL DEFAULT 0;

-- Per-viewer seen / closed / clicked for the in-app ad card.
CREATE TABLE IF NOT EXISTS login_ad_receipts (
  id SERIAL PRIMARY KEY,
  ad_id INTEGER NOT NULL REFERENCES login_ads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  viewer_type VARCHAR(10) NOT NULL DEFAULT 'staff',
  view_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  UNIQUE (ad_id, viewer_type, user_id)
);

-- Dashboard notices folded into announcements (utils/announcementSystem.js
-- also copies older admin_announcements rows over and marks them).
ALTER TABLE broadcast_announcements DROP CONSTRAINT IF EXISTS broadcast_announcements_display_type_check;
ALTER TABLE broadcast_announcements
  ADD CONSTRAINT broadcast_announcements_display_type_check
  CHECK (display_type IN ('modal','banner','dashboard'));
ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS migrated_announcement_id INTEGER;
