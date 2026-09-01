-- Tracks when an org was placed on hold and how many manager reminder
-- emails have been sent, so a daily sweep can send up to 3 reminders
-- spaced 5 days apart, starting ~7 days after the hold began.

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS on_hold_at TIMESTAMP NULL;

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS hold_reminder_count INTEGER NOT NULL DEFAULT 0;
