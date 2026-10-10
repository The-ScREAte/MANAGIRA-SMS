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
