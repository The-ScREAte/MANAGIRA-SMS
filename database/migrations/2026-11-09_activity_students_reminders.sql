-- Activities for one student (shown only to that student and their parents, and on their
-- calendars), and an optional reminder email to families the day before (sent once, from
-- reminders@managira.com; utils/classActivities.js sendActivityReminders). Safe to repeat.
ALTER TABLE IF EXISTS class_activities
  ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES students(student_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS remind_families BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_class_activities_student
  ON class_activities (organization_id, student_id) WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_class_activities_due_reminders
  ON class_activities (activity_date) WHERE remind_families AND reminded_at IS NULL;
