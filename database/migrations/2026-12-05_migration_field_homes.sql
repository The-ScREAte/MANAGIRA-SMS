-- Data migration: where each new student field lives (the student form's section, and whether the
-- admission form asks it too), chosen by the school on Match columns; and the school's choices for
-- the whole migration (meal balances kept in its meal app or moved into PayGira). Safe to run again.
ALTER TABLE IF EXISTS migration_columns ADD COLUMN IF NOT EXISTS field_section TEXT;
ALTER TABLE IF EXISTS migration_columns ADD COLUMN IF NOT EXISTS field_on_application BOOLEAN;
ALTER TABLE IF EXISTS migration_jobs ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '{}'::jsonb;
