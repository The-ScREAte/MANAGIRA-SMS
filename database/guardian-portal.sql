-- Guardian Portal Database Schema
-- This adds parent/guardian login functionality without breaking existing staff flows

-- 1) Master guardian record (one guardian can be linked to many students)
CREATE TABLE IF NOT EXISTS guardian_profiles (
  guardian_id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,

  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  phone VARCHAR(30),
  email VARCHAR(255),
  address TEXT,
  hometown VARCHAR(255),
  image_url TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Helpful search indexes
CREATE INDEX IF NOT EXISTS guardian_profiles_org_idx
  ON guardian_profiles (organization_id);

CREATE INDEX IF NOT EXISTS guardian_profiles_name_idx
  ON guardian_profiles (organization_id, LOWER(first_name), LOWER(last_name));

CREATE INDEX IF NOT EXISTS guardian_profiles_phone_idx
  ON guardian_profiles (organization_id, phone);

CREATE INDEX IF NOT EXISTS guardian_profiles_email_idx
  ON guardian_profiles (organization_id, LOWER(email));

-- 2) Link guardians to students (many-to-many)
CREATE TABLE IF NOT EXISTS guardian_students (
  guardian_id INT NOT NULL REFERENCES guardian_profiles(guardian_id) ON DELETE CASCADE,
  student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  relationship VARCHAR(50) DEFAULT 'Guardian',
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (guardian_id, student_id)
);

-- 3) Login credentials for guardian portal
CREATE TABLE IF NOT EXISTS guardian_accounts (
  id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  guardian_id INT NOT NULL REFERENCES guardian_profiles(guardian_id) ON DELETE CASCADE,

  login_email VARCHAR(255),
  login_phone VARCHAR(30),
  password_hash TEXT,
  must_reset_password BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique logins per organization (nulls are ok in Postgres)
CREATE UNIQUE INDEX IF NOT EXISTS guardian_accounts_email_unique
  ON guardian_accounts (organization_id, LOWER(login_email))
  WHERE login_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS guardian_accounts_phone_unique
  ON guardian_accounts (organization_id, login_phone)
  WHERE login_phone IS NOT NULL;

-- OPTIONAL: ensure your old guardians table can store email + image if missing
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE guardians ADD COLUMN IF NOT EXISTS image_url TEXT;
