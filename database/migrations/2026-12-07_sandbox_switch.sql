-- The sandbox switch: Managira gives a school its sandbox (allowed), and the school's managers
-- turn it on or off for themselves from the header menu (school_on). Only while it's on do they
-- see Data migration, and only then is the live account held still. Safe to run again.
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS allowed BOOLEAN NOT NULL DEFAULT TRUE;
-- A sandbox already open stays on (TRUE for the rows there now); a new one starts off.
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS school_on BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE migration_jobs ALTER COLUMN school_on SET DEFAULT FALSE;
ALTER TABLE migration_jobs ADD COLUMN IF NOT EXISTS switched_at TIMESTAMPTZ;
