// Each school's subject library and term library.
//
// A subject (Mathematics) and a term (Fall, 1st Term) are defined once per
// school. The existing rows stay as they are and become the "uses":
//   subjects row = a class teaching a library subject (subjects.library_subject_id)
//   terms row    = a school year's dates for a library term (terms.term_definition_id)
// Their ids never change, so scores, report cards, positions and transcripts
// keep pointing at the same records.
//
// Database triggers link every subject/term row to its library entry by name
// (ignoring case and extra spaces) whenever one is added or renamed, so every
// screen and API stays linked without having to remember to do it.

let ready = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS subject_library (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS subject_library_org_name_key
    ON subject_library (organization_id, (lower(btrim(name))));

  CREATE TABLE IF NOT EXISTS term_definitions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS term_definitions_org_name_key
    ON term_definitions (organization_id, (lower(btrim(name))));

  ALTER TABLE subjects ADD COLUMN IF NOT EXISTS library_subject_id INTEGER REFERENCES subject_library(id) ON DELETE SET NULL;
  ALTER TABLE terms ADD COLUMN IF NOT EXISTS term_definition_id INTEGER REFERENCES term_definitions(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS subjects_library_subject_id_idx ON subjects (library_subject_id);
  CREATE INDEX IF NOT EXISTS terms_term_definition_id_idx ON terms (term_definition_id);

  -- Links a subject row to its school's library entry (adding the entry if it is
  -- new) and stores it under the library's spelling. A class never gets a second
  -- copy of a subject it already teaches: that insert is skipped.
  CREATE OR REPLACE FUNCTION link_subject_to_library() RETURNS trigger AS $$
  DECLARE
    lib_id INTEGER;
    lib_name TEXT;
  BEGIN
    IF NEW.organization_id IS NULL OR NULLIF(btrim(NEW.subject_name), '') IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT id, name INTO lib_id, lib_name FROM subject_library
     WHERE organization_id = NEW.organization_id AND lower(btrim(name)) = lower(btrim(NEW.subject_name));
    IF lib_id IS NULL THEN
      INSERT INTO subject_library (organization_id, name)
        VALUES (NEW.organization_id, btrim(NEW.subject_name))
        ON CONFLICT (organization_id, (lower(btrim(name)))) DO NOTHING;
      SELECT id, name INTO lib_id, lib_name FROM subject_library
       WHERE organization_id = NEW.organization_id AND lower(btrim(name)) = lower(btrim(NEW.subject_name));
    END IF;
    IF TG_OP = 'INSERT' AND NEW.class_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM subjects
          WHERE class_id = NEW.class_id AND organization_id = NEW.organization_id AND library_subject_id = lib_id) THEN
      RETURN NULL;
    END IF;
    NEW.library_subject_id := lib_id;
    NEW.subject_name := lib_name;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS subjects_link_library ON subjects;
  CREATE TRIGGER subjects_link_library BEFORE INSERT OR UPDATE OF subject_name, organization_id, library_subject_id ON subjects
    FOR EACH ROW EXECUTE FUNCTION link_subject_to_library();

  -- A term's place in the year from its name: 1st/Term 1/Fall = 1, 2nd/Spring = 2,
  -- 3rd/Summer = 3 ... NULL when the name doesn't say.
  CREATE OR REPLACE FUNCTION term_order_from_name(term_name TEXT) RETURNS INTEGER AS $$
    SELECT COALESCE(
      NULLIF(substring(lower(term_name) from '([0-9]+)'), '')::int,
      CASE
        WHEN lower(term_name) ~ 'first' THEN 1
        WHEN lower(term_name) ~ 'second' THEN 2
        WHEN lower(term_name) ~ 'third' THEN 3
        WHEN lower(term_name) ~ 'fourth' THEN 4
        WHEN lower(term_name) ~ '(fall|autumn)' THEN 1
        WHEN lower(term_name) ~ '(winter|spring)' THEN 2
        WHEN lower(term_name) ~ 'summer' THEN 3
      END)
  $$ LANGUAGE sql IMMUTABLE;

  -- Links a term row to its school's term definition (adding it if new) and
  -- stores it under the definition's spelling.
  CREATE OR REPLACE FUNCTION link_term_to_definition() RETURNS trigger AS $$
  DECLARE
    def_id INTEGER;
    def_name TEXT;
  BEGIN
    IF NEW.organization_id IS NULL OR NULLIF(btrim(NEW.term_name), '') IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT id, name INTO def_id, def_name FROM term_definitions
     WHERE organization_id = NEW.organization_id AND lower(btrim(name)) = lower(btrim(NEW.term_name));
    IF def_id IS NULL THEN
      INSERT INTO term_definitions (organization_id, name, sort_order)
        VALUES (NEW.organization_id, btrim(NEW.term_name),
                COALESCE(term_order_from_name(NEW.term_name),
                         (SELECT MAX(sort_order) + 1 FROM term_definitions WHERE organization_id = NEW.organization_id), 1))
        ON CONFLICT (organization_id, (lower(btrim(name)))) DO NOTHING;
      SELECT id, name INTO def_id, def_name FROM term_definitions
       WHERE organization_id = NEW.organization_id AND lower(btrim(name)) = lower(btrim(NEW.term_name));
    END IF;
    NEW.term_definition_id := def_id;
    NEW.term_name := def_name;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS terms_link_definition ON terms;
  CREATE TRIGGER terms_link_definition BEFORE INSERT OR UPDATE OF term_name, organization_id, term_definition_id ON terms
    FOR EACH ROW EXECUTE FUNCTION link_term_to_definition();
`;

// Links rows that have no library entry yet. The library name is a normal-case
// spelling when there is one (not ALL CAPS / all lowercase), then the one most
// rows use. Term order comes from the name (1st, Term 2, Fall...), otherwise
// from where the term usually falls within its school year.
const BACKFILL_SQL = `
  INSERT INTO subject_library (organization_id, name)
  SELECT DISTINCT ON (organization_id, lower(btrim(subject_name))) organization_id, btrim(subject_name)
    FROM (
      SELECT organization_id, subject_name, subject_id,
             COUNT(*) OVER (PARTITION BY organization_id, btrim(subject_name)) AS uses
        FROM subjects
       WHERE library_subject_id IS NULL AND organization_id IS NOT NULL AND NULLIF(btrim(subject_name), '') IS NOT NULL
    ) s
   ORDER BY organization_id, lower(btrim(subject_name)),
            (btrim(subject_name) IN (upper(btrim(subject_name)), lower(btrim(subject_name)))) ASC,
            uses DESC, subject_id ASC
  ON CONFLICT (organization_id, (lower(btrim(name)))) DO NOTHING;

  UPDATE subjects s SET library_subject_id = sl.id
    FROM subject_library sl
   WHERE s.library_subject_id IS NULL AND sl.organization_id = s.organization_id
     AND lower(btrim(sl.name)) = lower(btrim(s.subject_name));

  WITH placed AS (
    SELECT organization_id, term_id, term_name,
           ROW_NUMBER() OVER (PARTITION BY school_year_id ORDER BY start_date NULLS LAST, term_id) AS pos
      FROM terms
     WHERE term_definition_id IS NULL AND organization_id IS NOT NULL AND NULLIF(btrim(term_name), '') IS NOT NULL
  )
  INSERT INTO term_definitions (organization_id, name, sort_order)
  SELECT DISTINCT ON (organization_id, lower(btrim(term_name))) organization_id, btrim(term_name),
         COALESCE(term_order_from_name(term_name),
                  ROUND(AVG(pos) OVER (PARTITION BY organization_id, lower(btrim(term_name))))::int)
    FROM placed
   ORDER BY organization_id, lower(btrim(term_name)),
            (btrim(term_name) IN (upper(btrim(term_name)), lower(btrim(term_name)))) ASC, term_id
  ON CONFLICT (organization_id, (lower(btrim(name)))) DO NOTHING;

  UPDATE terms t SET term_definition_id = td.id
    FROM term_definitions td
   WHERE t.term_definition_id IS NULL AND td.organization_id = t.organization_id
     AND lower(btrim(td.name)) = lower(btrim(t.term_name));
`;

async function ensureAcademicLibrarySchema(db) {
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

// The school's library subjects with how many classes use each.
async function listSubjectLibrary(db, organizationId) {
  await ensureAcademicLibrarySchema(db);
  const { rows } = await db.query(
    `SELECT sl.id, sl.name, sl.is_active,
            COUNT(s.subject_id)::int AS class_count,
            COALESCE(array_agg(c.class_name ORDER BY c.dashboard_sort_order NULLS LAST, c.class_name) FILTER (WHERE c.class_id IS NOT NULL), '{}') AS classes
       FROM subject_library sl
       LEFT JOIN subjects s ON s.library_subject_id = sl.id
       LEFT JOIN classes c ON c.class_id = s.class_id
      WHERE sl.organization_id = $1
      GROUP BY sl.id
      ORDER BY lower(sl.name)`,
    [organizationId]
  );
  return rows;
}

// The school's library terms with how many school years use each.
async function listTermDefinitions(db, organizationId) {
  await ensureAcademicLibrarySchema(db);
  const { rows } = await db.query(
    `SELECT td.id, td.name, td.sort_order, td.is_active,
            COUNT(t.term_id)::int AS year_count
       FROM term_definitions td
       LEFT JOIN terms t ON t.term_definition_id = td.id
      WHERE td.organization_id = $1
      GROUP BY td.id
      ORDER BY td.sort_order, lower(td.name)`,
    [organizationId]
  );
  return rows;
}

// Renames a library subject everywhere it is used (the triggers keep the links).
async function renameLibrarySubject(db, organizationId, id, name) {
  const clean = String(name || "").trim().slice(0, 120);
  if (!clean) throw new Error("Enter a subject name.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const clash = await client.query(
      "SELECT 1 FROM subject_library WHERE organization_id = $1 AND id <> $2 AND lower(btrim(name)) = lower($3)",
      [organizationId, id, clean]
    );
    if (clash.rows.length) throw new Error("Another subject already has that name.");
    const updated = await client.query(
      "UPDATE subject_library SET name = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2",
      [organizationId, id, clean]
    );
    if (!updated.rowCount) throw new Error("Subject not found.");
    await client.query(
      "UPDATE subjects SET subject_name = $3 WHERE organization_id = $1 AND library_subject_id = $2",
      [organizationId, id, clean]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function addLibrarySubject(db, organizationId, name) {
  const clean = String(name || "").trim().slice(0, 120);
  if (!clean) throw new Error("Enter a subject name.");
  await ensureAcademicLibrarySchema(db);
  const { rows } = await db.query(
    `INSERT INTO subject_library (organization_id, name) VALUES ($1, $2)
     ON CONFLICT (organization_id, (lower(btrim(name)))) DO UPDATE SET is_active = TRUE, updated_at = NOW()
     RETURNING id`,
    [organizationId, clean]
  );
  return rows[0].id;
}

async function setLibrarySubjectActive(db, organizationId, id, active) {
  await db.query(
    "UPDATE subject_library SET is_active = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2",
    [organizationId, id, !!active]
  );
}

async function addTermDefinition(db, organizationId, name) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) throw new Error("Enter a term name.");
  await ensureAcademicLibrarySchema(db);
  const { rows } = await db.query(
    `INSERT INTO term_definitions (organization_id, name, sort_order)
     VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM term_definitions WHERE organization_id = $1), 1))
     ON CONFLICT (organization_id, (lower(btrim(name)))) DO UPDATE SET is_active = TRUE, updated_at = NOW()
     RETURNING id`,
    [organizationId, clean]
  );
  return rows[0].id;
}

// Renames a library term in every school year that uses it.
async function renameTermDefinition(db, organizationId, id, name) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) throw new Error("Enter a term name.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const clash = await client.query(
      "SELECT 1 FROM term_definitions WHERE organization_id = $1 AND id <> $2 AND lower(btrim(name)) = lower($3)",
      [organizationId, id, clean]
    );
    if (clash.rows.length) throw new Error("Another term already has that name.");
    const updated = await client.query(
      "UPDATE term_definitions SET name = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2",
      [organizationId, id, clean]
    );
    if (!updated.rowCount) throw new Error("Term not found.");
    await client.query(
      "UPDATE terms SET term_name = $3 WHERE organization_id = $1 AND term_definition_id = $2",
      [organizationId, id, clean]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function setTermDefinitionActive(db, organizationId, id, active) {
  await db.query(
    "UPDATE term_definitions SET is_active = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2",
    [organizationId, id, !!active]
  );
}

// Active library names for the suggestion lists on subject and term inputs.
async function libraryPickLists(db, organizationId) {
  try {
    await ensureAcademicLibrarySchema(db);
    const [subjects, terms] = await Promise.all([
      // A name whose subjects are all obsolete isn't suggested for new work.
      db.query(
        `SELECT l.name FROM subject_library l
          WHERE l.organization_id = $1 AND l.is_active
            AND NOT (
              EXISTS (SELECT 1 FROM subjects s WHERE s.organization_id = $1 AND lower(btrim(s.subject_name)) = lower(btrim(l.name)) AND s.obsolete_at IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM subjects s WHERE s.organization_id = $1 AND lower(btrim(s.subject_name)) = lower(btrim(l.name)) AND s.obsolete_at IS NULL)
            )
          ORDER BY lower(l.name)`,
        [organizationId]
      ),
      db.query("SELECT name FROM term_definitions WHERE organization_id = $1 AND is_active ORDER BY sort_order, lower(name)", [organizationId]),
    ]);
    return { subjectNames: subjects.rows.map((r) => r.name), termNames: terms.rows.map((r) => r.name) };
  } catch (err) {
    console.error("[academicLibrary] pick lists failed:", err.message);
    return { subjectNames: [], termNames: [] };
  }
}

// The library spelling for a typed name (so "mathematics" is stored as "Mathematics").
async function librarySubjectName(db, organizationId, name) {
  const clean = String(name || "").trim();
  if (!clean) return clean;
  const { rows } = await db.query(
    "SELECT name FROM subject_library WHERE organization_id = $1 AND lower(btrim(name)) = lower($2) LIMIT 1",
    [organizationId, clean]
  );
  return rows[0] ? rows[0].name : clean;
}

module.exports = {
  libraryPickLists,
  librarySubjectName,
  ensureAcademicLibrarySchema,
  listSubjectLibrary,
  listTermDefinitions,
  addLibrarySubject,
  renameLibrarySubject,
  setLibrarySubjectActive,
  addTermDefinition,
  renameTermDefinition,
  setTermDefinitionActive,
};
