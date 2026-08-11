-- Extra visibility grants for Managira Workers (Admin / Mini Admin / Internal Worker)
-- Lets an Admin grant an individual worker access to specific internal_contacts
-- rows they didn't create/aren't assigned to, and/or visibility into the
-- Team Org Chart page without promoting them to full Admin.

CREATE TABLE IF NOT EXISTS user_extra_contact_permissions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  contact_id INT NOT NULL REFERENCES internal_contacts(id) ON DELETE CASCADE,
  granted_by INT REFERENCES users(user_id),
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_user_extra_contact_permissions_user
  ON user_extra_contact_permissions(user_id);

CREATE TABLE IF NOT EXISTS user_feature_flags (
  user_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  can_view_org_chart BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INT REFERENCES users(user_id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
