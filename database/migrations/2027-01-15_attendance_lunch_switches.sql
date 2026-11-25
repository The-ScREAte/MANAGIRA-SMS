-- A school chooses whether it takes attendance and lunch in Managira (Management, Class & notif. settings).
-- Both on until a school turns one off; nothing stored is ever deleted.
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS use_attendance BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS use_lunch BOOLEAN NOT NULL DEFAULT TRUE;
