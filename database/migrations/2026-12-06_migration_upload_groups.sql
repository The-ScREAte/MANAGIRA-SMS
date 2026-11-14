-- Data migration: files the school chose together (a folder, sent in batches) are one upload group,
-- so lists of one kind in it stay together instead of replacing each other. Safe to run again.
ALTER TABLE IF EXISTS migration_uploads ADD COLUMN IF NOT EXISTS group_id TEXT;
