ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS external_website_url TEXT;
