// Each school's list of assessment names (like its subject and term lists).
// An assessment name used in several terms and school years ("Midterm Exam",
// "CAT 1") is one entry with one id, so it is reused instead of recreated.
// Names only match when they are the same apart from capitals and spacing;
// different names are never merged or renamed. Each school has its own list.
// Each term's assessments (per class and subject) stay separate records; they
// point to their entry through assessments.assessment_definition_id, kept by a
// database trigger so any code that creates assessments links them.

let ready = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS assessment_definitions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, name_key)
  );

  ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_definition_id INTEGER
    REFERENCES assessment_definitions(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS assessments_definition_idx ON assessments (assessment_definition_id);

  CREATE OR REPLACE FUNCTION assessment_name_key(p_name TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE AS $$
    SELECT LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p_name, '')), '\\s+', ' ', 'g'))
  $$;

  CREATE OR REPLACE FUNCTION link_assessment_to_definition() RETURNS trigger AS $$
  DECLARE
    v_key TEXT := assessment_name_key(NEW.title);
    v_id INTEGER;
  BEGIN
    IF NEW.organization_id IS NULL OR v_key = '' THEN RETURN NEW; END IF;
    SELECT id INTO v_id FROM assessment_definitions
     WHERE organization_id = NEW.organization_id AND name_key = v_key;
    IF v_id IS NULL THEN
      INSERT INTO assessment_definitions (organization_id, name, name_key)
      VALUES (NEW.organization_id, REGEXP_REPLACE(BTRIM(NEW.title), '\\s+', ' ', 'g'), v_key)
      ON CONFLICT (organization_id, name_key) DO UPDATE SET name = assessment_definitions.name
      RETURNING id INTO v_id;
    END IF;
    NEW.assessment_definition_id := v_id;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS assessments_link_definition ON assessments;
  CREATE TRIGGER assessments_link_definition
    BEFORE INSERT OR UPDATE OF title, organization_id ON assessments
    FOR EACH ROW EXECUTE FUNCTION link_assessment_to_definition();
`;

// One entry per distinct name per school (spelled as most often used), then
// every assessment linked to it.
const BACKFILL_SQL = `
  INSERT INTO assessment_definitions (organization_id, name, name_key)
  SELECT organization_id, name, name_key FROM (
    SELECT organization_id, assessment_name_key(title) AS name_key,
           REGEXP_REPLACE(BTRIM(title), '\\s+', ' ', 'g') AS name,
           ROW_NUMBER() OVER (PARTITION BY organization_id, assessment_name_key(title)
                              ORDER BY COUNT(*) DESC, MAX(assessment_id) DESC) AS rn
      FROM assessments
     WHERE organization_id IS NOT NULL AND assessment_name_key(title) <> ''
     GROUP BY organization_id, assessment_name_key(title), REGEXP_REPLACE(BTRIM(title), '\\s+', ' ', 'g')
  ) ranked
  WHERE rn = 1
  ON CONFLICT (organization_id, name_key) DO NOTHING;

  UPDATE assessments a
     SET assessment_definition_id = d.id
    FROM assessment_definitions d
   WHERE d.organization_id = a.organization_id
     AND d.name_key = assessment_name_key(a.title)
     AND a.assessment_definition_id IS DISTINCT FROM d.id;
`;

async function ensureAssessmentLibrarySchema(db) {
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

module.exports = { ensureAssessmentLibrarySchema };
