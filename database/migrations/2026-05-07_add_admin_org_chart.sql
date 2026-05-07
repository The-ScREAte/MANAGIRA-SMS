-- Admin-side org chart: supervisor relationship + custom role + profile image
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS supervisor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_role_title TEXT,
  ADD COLUMN IF NOT EXISTS org_role_description TEXT,
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT,
  ADD COLUMN IF NOT EXISTS profile_image_s3_key TEXT;

CREATE INDEX IF NOT EXISTS idx_users_supervisor ON users(supervisor_user_id);
