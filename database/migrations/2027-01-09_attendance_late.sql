-- Late arrivals: a student marked present on the class attendance page can also be marked late (feature attendance_notices).
-- Safe to repeat. Until it has run, the page offers no "late" and saves attendance exactly as before.
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS late BOOLEAN NOT NULL DEFAULT FALSE;
