-- Families are told about a day's attendance after the teacher is done, not the moment they press Save.
-- NOT RUN ON LIVE: run it by name. Safe to run again.
-- One row per class and day (utils/attendanceSends.js): when it was last saved, when the teacher said they were
-- done (confirmed_at) and when the families are due to hear (send_after: 30 minutes after "done", or 2 hours
-- after the last save when nobody confirmed). sent_at is set once they have been told.
-- Until it runs, attendance is saved and families are told straight away, as before.
CREATE TABLE IF NOT EXISTS attendance_sends (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  class_id        INTEGER NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  saved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ NULL,
  send_after      TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ NULL,
  UNIQUE (organization_id, class_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS attendance_sends_due_idx ON attendance_sends (send_after) WHERE sent_at IS NULL;
