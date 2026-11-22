-- Attendance notes: the reason a student was absent (typed on the class attendance page, saved with the day).
-- Safe to repeat. Until it has run, the page offers no notes and saves attendance exactly as before.
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS note TEXT;
