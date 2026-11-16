-- Lunch taken for each student on each school day, from the class attendance page.
-- One row per student per day: had_lunch TRUE (got lunch) or FALSE (no lunch). No row = not taken yet.
-- Safe to run again.
CREATE TABLE IF NOT EXISTS class_lunch (
  lunch_id        BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  class_id        INTEGER NOT NULL,
  term_id         INTEGER,
  student_id      INTEGER NOT NULL,
  lunch_date      DATE NOT NULL,
  had_lunch       BOOLEAN NOT NULL,
  marked_by       INTEGER,
  marked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, student_id, lunch_date)
);
CREATE INDEX IF NOT EXISTS idx_class_lunch_class_day ON class_lunch (organization_id, class_id, lunch_date);
CREATE INDEX IF NOT EXISTS idx_class_lunch_student ON class_lunch (organization_id, student_id, lunch_date);
