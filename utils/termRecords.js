// Records that belong to one term stay with that term.
//
// Subject positions: student_positions keeps one row per student and subject,
// so ranking a new term used to replace the previous term's positions. Every
// position written there is now also kept per term in student_term_positions
// (a database trigger, so any version of the code keeps it), and readers use
// that table. Positions earlier terms lost are rebuilt from their saved scores
// with the same ranking the app uses (highest total first, ties share a place).
//
// Report-card settings (status_settings): a second rule allowed only one row
// per class, so a new term's settings replaced the last term's. Only the
// per-term rule is kept.

let ready = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS student_term_positions (
    student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
    term_id INTEGER NOT NULL,
    class_id INTEGER,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    position INTEGER,
    total_subject_score NUMERIC,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (student_id, subject_id, term_id)
  );
  CREATE INDEX IF NOT EXISTS student_term_positions_class_term_idx
    ON student_term_positions (organization_id, class_id, term_id);

  CREATE OR REPLACE FUNCTION keep_term_position() RETURNS trigger AS $$
  BEGIN
    IF NEW.term_id IS NULL OR NEW.organization_id IS NULL OR NEW.subject_id IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO student_term_positions
      (student_id, subject_id, term_id, class_id, organization_id, position, total_subject_score, updated_at)
    VALUES (NEW.student_id, NEW.subject_id, NEW.term_id, NEW.class_id, NEW.organization_id,
            NEW.position, NEW.total_subject_score, NOW())
    ON CONFLICT (student_id, subject_id, term_id) DO UPDATE SET
      class_id = EXCLUDED.class_id,
      position = EXCLUDED.position,
      total_subject_score = EXCLUDED.total_subject_score,
      updated_at = NOW();
    RETURN NEW;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS student_positions_keep_term ON student_positions;
  CREATE TRIGGER student_positions_keep_term AFTER INSERT OR UPDATE ON student_positions
    FOR EACH ROW EXECUTE FUNCTION keep_term_position();

  ALTER TABLE status_settings DROP CONSTRAINT IF EXISTS unique_status_per_class_org;
  DROP INDEX IF EXISTS unique_status_per_class_org;
`;

// Current positions first (they are what each term last showed), then any
// term that has scores but no kept positions gets them rebuilt from its scores.
const BACKFILL_SQL = `
  INSERT INTO student_term_positions
    (student_id, subject_id, term_id, class_id, organization_id, position, total_subject_score)
  SELECT student_id, subject_id, term_id, class_id, organization_id, position, total_subject_score
    FROM student_positions
   WHERE term_id IS NOT NULL AND organization_id IS NOT NULL AND subject_id IS NOT NULL
  ON CONFLICT (student_id, subject_id, term_id) DO NOTHING;

  INSERT INTO student_term_positions
    (student_id, subject_id, term_id, class_id, organization_id, position, total_subject_score)
  SELECT student_id, subject_id, term_id, class_id, organization_id,
         RANK() OVER (PARTITION BY organization_id, class_id, subject_id, term_id ORDER BY SUM(score) DESC),
         SUM(score)
    FROM assessment_results
   WHERE term_id IS NOT NULL AND class_id IS NOT NULL AND subject_id IS NOT NULL AND organization_id IS NOT NULL
   GROUP BY student_id, subject_id, term_id, class_id, organization_id
  ON CONFLICT (student_id, subject_id, term_id) DO NOTHING;
`;

async function ensureTermRecordsSchema(db) {
  if (!ready) {
    ready = (async () => {
      await db.query(SCHEMA_SQL);
      await db.query(BACKFILL_SQL);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

module.exports = { ensureTermRecordsSchema, SCHEMA_SQL, BACKFILL_SQL };
