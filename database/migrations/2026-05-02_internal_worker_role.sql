-- Internal Worker role + internal_contacts table
-- Adds a new role to the user_role enum and creates the table backing the
-- "Contacts / Referrals" widget on the admin dashboard.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Internal Worker';

CREATE TABLE IF NOT EXISTS internal_contacts (
  id SERIAL PRIMARY KEY,
  created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  contact_name TEXT NOT NULL,
  organization_name TEXT,
  appointment_set BOOLEAN NOT NULL DEFAULT FALSE,
  appointment_at TIMESTAMP,
  notes TEXT,
  followed_up BOOLEAN NOT NULL DEFAULT FALSE,
  followed_up_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_internal_contacts_created_by
  ON internal_contacts(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_internal_contacts_created_at
  ON internal_contacts(created_at DESC);
