-- First-time setup (feature first_setup, utils/firstSetup.js): when a school finished or
-- skipped through it. Empty = not yet; a school that already chose its colour isn't asked.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS first_setup_done_at TIMESTAMPTZ;
