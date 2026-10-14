// Database rules that keep each school's saved records safe, whatever code
// writes them (this version or an older one still running somewhere).
//
// 1. Same school, real links. Scores, assessments, attendance, positions,
//    reports and the rest must point at a term, class, subject and school year
//    that exist and belong to the same school. A link to another school's
//    record, or to nothing, is refused.
// 2. Nothing with records disappears by accident. These links used to say
//    "delete the scores/attendance/students too" when a class, subject or term
//    was deleted. Now the delete is refused while records point at it (the app
//    already explains why). Deleting a whole school still removes everything:
//    those checks run at the end of the delete, after the school's records are
//    gone too.
// 3. Each student's subjects per term. student_subjects holds only the current
//    list, so moving up a class replaced last year's subjects. Every term's list
//    is now kept in student_term_subjects, filled by the database itself.

let ready = null;

// [table, column, parent table, parent key]. Every table here is removed with
// its school (organization_id ... ON DELETE CASCADE), which the whole-school
// delete relies on.
const SAME_SCHOOL_LINKS = [
  ["assessments", "term_id", "terms", "term_id"],
  ["assessments", "class_id", "classes", "class_id"],
  ["assessments", "subject_id", "subjects", "subject_id"],
  ["assessment_results", "term_id", "terms", "term_id"],
  ["assessment_results", "class_id", "classes", "class_id"],
  ["assessment_results", "subject_id", "subjects", "subject_id"],
  ["category_scores", "term_id", "terms", "term_id"],
  ["category_scores", "class_id", "classes", "class_id"],
  ["category_scores", "subject_id", "subjects", "subject_id"],
  ["attendance_records", "term_id", "terms", "term_id"],
  ["attendance_records", "class_id", "classes", "class_id"],
  ["student_term_positions", "term_id", "terms", "term_id"],
  ["student_term_positions", "class_id", "classes", "class_id"],
  ["student_term_positions", "subject_id", "subjects", "subject_id"],
  ["student_reports", "term_id", "terms", "term_id"],
  ["student_reports", "class_id", "classes", "class_id"],
  ["student_assessment_attempts", "term_id", "terms", "term_id"],
  ["student_assessment_attempts", "class_id", "classes", "class_id"],
  ["finance_bills", "term_id", "terms", "term_id"],
  ["finance_bills", "school_year_id", "school_years", "id"],
  ["class_schedules", "term_id", "terms", "term_id"],
  ["class_schedules", "class_id", "classes", "class_id"],
  ["class_schedules", "school_year_id", "school_years", "id"],
  ["school_events", "term_id", "terms", "term_id"],
  ["school_events", "school_year_id", "school_years", "id"],
  ["announcements", "term_id", "terms", "term_id"],
  ["announcements", "school_year_id", "school_years", "id"],
  ["enrollments", "term_id", "terms", "term_id"],
  ["enrollments", "school_year_id", "school_years", "id"],
  ["subjects", "class_id", "classes", "class_id"],
  ["terms", "school_year_id", "school_years", "id"],
];

// Saved records: their old "delete these too" links to classes, subjects,
// terms and school years are dropped (the same-school links above replace them).
const RECORD_TABLES = [
  "assessments", "assessment_results", "category_scores", "attendance_records",
  "student_term_positions", "student_reports", "student_assessment_attempts",
  "finance_bills", "class_schedules", "school_events", "announcements",
];

const STUDENT_TERM_SUBJECTS_SQL = `
  CREATE TABLE IF NOT EXISTS student_term_subjects (
    student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
    term_id INTEGER NOT NULL REFERENCES terms(term_id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (student_id, subject_id, term_id)
  );
  CREATE INDEX IF NOT EXISTS student_term_subjects_term_idx
    ON student_term_subjects (organization_id, term_id);

  -- A student's subjects for one term: the current list plus what that term kept.
  CREATE OR REPLACE FUNCTION student_subjects_in_term(p_term_id INTEGER)
  RETURNS TABLE (student_id INTEGER, subject_id INTEGER, organization_id INTEGER, term_id INTEGER)
  LANGUAGE sql STABLE AS $$
    SELECT ss.student_id, ss.subject_id, ss.organization_id, ss.term_id FROM student_subjects ss
    UNION
    SELECT h.student_id, h.subject_id, h.organization_id, h.term_id
      FROM student_term_subjects h
     WHERE h.term_id = p_term_id
  $$;

  -- Terms still running or to come (finished terms keep what they had).
  CREATE OR REPLACE FUNCTION term_is_open(p_term_id INTEGER) RETURNS BOOLEAN
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM terms t
       WHERE t.term_id = p_term_id
         AND (t.current OR t.end_date IS NULL OR t.end_date >= CURRENT_DATE)
    )
  $$;

  -- A subject given to a student counts for every open term they are enrolled
  -- in that subject's class; taking it away removes it from those open terms
  -- unless scores were already saved.
  CREATE OR REPLACE FUNCTION keep_student_term_subjects() RETURNS trigger AS $$
  BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      DELETE FROM student_term_subjects h
       WHERE h.student_id = OLD.student_id
         AND h.subject_id = OLD.subject_id
         AND term_is_open(h.term_id)
         AND NOT EXISTS (SELECT 1 FROM assessment_results ar
                          WHERE ar.student_id = h.student_id AND ar.subject_id = h.subject_id AND ar.term_id = h.term_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      INSERT INTO student_term_subjects (student_id, subject_id, term_id, organization_id)
      SELECT DISTINCT NEW.student_id, NEW.subject_id, e.term_id, sub.organization_id
        FROM subjects sub
        JOIN enrolled_students es ON es.class_id = sub.class_id AND es.student_id = NEW.student_id
        JOIN enrollments e ON e.enrollment_id = es.enrollment_id AND e.organization_id = sub.organization_id
       WHERE sub.subject_id = NEW.subject_id
         AND e.term_id IS NOT NULL
         AND term_is_open(e.term_id)
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END IF;
    RETURN OLD;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS student_subjects_keep_terms ON student_subjects;
  CREATE TRIGGER student_subjects_keep_terms AFTER INSERT OR UPDATE OR DELETE ON student_subjects
    FOR EACH ROW EXECUTE FUNCTION keep_student_term_subjects();

  -- Enrolling a student in a class for a term gives them that class's subjects
  -- from their list for the term; un-enrolling takes them back (open terms only,
  -- never once scores are saved).
  CREATE OR REPLACE FUNCTION keep_student_term_subjects_on_enroll() RETURNS trigger AS $$
  DECLARE
    v_term INTEGER;
    v_org INTEGER;
  BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      SELECT e.term_id, e.organization_id INTO v_term, v_org FROM enrollments e WHERE e.enrollment_id = OLD.enrollment_id;
      IF v_term IS NOT NULL AND term_is_open(v_term) THEN
        DELETE FROM student_term_subjects h
         USING subjects sub
         WHERE sub.subject_id = h.subject_id
           AND sub.class_id = OLD.class_id
           AND h.student_id = OLD.student_id
           AND h.term_id = v_term
           AND NOT EXISTS (SELECT 1 FROM enrolled_students es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
                            WHERE es.student_id = OLD.student_id AND es.class_id = OLD.class_id AND e.term_id = v_term)
           AND NOT EXISTS (SELECT 1 FROM assessment_results ar
                            WHERE ar.student_id = h.student_id AND ar.subject_id = h.subject_id AND ar.term_id = h.term_id);
      END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      SELECT e.term_id, e.organization_id INTO v_term, v_org FROM enrollments e WHERE e.enrollment_id = NEW.enrollment_id;
      IF v_term IS NOT NULL AND term_is_open(v_term) THEN
        INSERT INTO student_term_subjects (student_id, subject_id, term_id, organization_id)
        SELECT ss.student_id, ss.subject_id, v_term, sub.organization_id
          FROM student_subjects ss
          JOIN subjects sub ON sub.subject_id = ss.subject_id
         WHERE ss.student_id = NEW.student_id
           AND sub.class_id = NEW.class_id
           AND sub.organization_id = v_org
        ON CONFLICT DO NOTHING;
      END IF;
      RETURN NEW;
    END IF;
    RETURN OLD;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS enrolled_students_keep_term_subjects ON enrolled_students;
  CREATE TRIGGER enrolled_students_keep_term_subjects AFTER INSERT OR UPDATE OR DELETE ON enrolled_students
    FOR EACH ROW EXECUTE FUNCTION keep_student_term_subjects_on_enroll();

  -- A saved score always means the student took that subject that term.
  CREATE OR REPLACE FUNCTION keep_student_term_subject_from_score() RETURNS trigger AS $$
  BEGIN
    IF NEW.student_id IS NOT NULL AND NEW.subject_id IS NOT NULL AND NEW.term_id IS NOT NULL AND NEW.organization_id IS NOT NULL THEN
      INSERT INTO student_term_subjects (student_id, subject_id, term_id, organization_id)
      VALUES (NEW.student_id, NEW.subject_id, NEW.term_id, NEW.organization_id)
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS assessment_results_keep_term_subject ON assessment_results;
  CREATE TRIGGER assessment_results_keep_term_subject AFTER INSERT OR UPDATE OF student_id, subject_id, term_id ON assessment_results
    FOR EACH ROW EXECUTE FUNCTION keep_student_term_subject_from_score();
`;

// 4. Enrollment and a student's class agree. A student's own class follows
//    their enrollment in the school's current term (promotion used to enroll
//    students in their next class without moving them), and every enrolled
//    student's class is on that term's class list.
const ENROLLMENT_CLASS_SQL = `
  -- The school's current term (term and its school year both current).
  CREATE OR REPLACE FUNCTION is_current_term(p_term_id INTEGER) RETURNS BOOLEAN
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
                    WHERE t.term_id = p_term_id AND t.current AND sy.current)
  $$;

  -- Enrolling a student: their class is on that term's class list, and in the
  -- current term the student's own class follows the enrollment.
  CREATE OR REPLACE FUNCTION enrollment_keeps_class() RETURNS trigger AS $$
  DECLARE
    v_term INTEGER;
  BEGIN
    IF NEW.class_id IS NULL THEN RETURN NEW; END IF;
    INSERT INTO enrolled_classes (enrollment_id, class_id) VALUES (NEW.enrollment_id, NEW.class_id)
    ON CONFLICT (enrollment_id, class_id) DO NOTHING;
    SELECT term_id INTO v_term FROM enrollments WHERE enrollment_id = NEW.enrollment_id;
    IF v_term IS NOT NULL AND is_current_term(v_term) THEN
      UPDATE students SET class_id = NEW.class_id
       WHERE student_id = NEW.student_id
         AND class_id IS DISTINCT FROM NEW.class_id
         AND NOT COALESCE(graduated, FALSE);
    END IF;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS enrolled_students_keep_class ON enrolled_students;
  CREATE TRIGGER enrolled_students_keep_class AFTER INSERT OR UPDATE OF class_id, enrollment_id ON enrolled_students
    FOR EACH ROW EXECUTE FUNCTION enrollment_keeps_class();

  -- When a term becomes the current one, every student enrolled in it takes
  -- the class they are enrolled in for that term (e.g. after a promotion).
  CREATE OR REPLACE FUNCTION sync_classes_to_term(p_term_id INTEGER) RETURNS INTEGER AS $$
  DECLARE
    v_count INTEGER;
  BEGIN
    UPDATE students s SET class_id = es.class_id
      FROM enrolled_students es
      JOIN enrollments e ON e.enrollment_id = es.enrollment_id
     WHERE e.term_id = p_term_id
       AND es.student_id = s.student_id
       AND s.organization_id = e.organization_id
       AND es.class_id IS NOT NULL
       AND s.class_id IS DISTINCT FROM es.class_id
       AND NOT COALESCE(s.graduated, FALSE);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END $$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION current_term_keeps_classes() RETURNS trigger AS $$
  DECLARE
    v_term INTEGER;
  BEGIN
    IF TG_TABLE_NAME = 'terms' THEN
      IF NEW.current AND NOT COALESCE(OLD.current, FALSE) AND is_current_term(NEW.term_id) THEN
        PERFORM sync_classes_to_term(NEW.term_id);
      END IF;
    ELSIF NEW.current AND NOT COALESCE(OLD.current, FALSE) THEN
      SELECT t.term_id INTO v_term FROM terms t WHERE t.school_year_id = NEW.id AND t.current LIMIT 1;
      IF v_term IS NOT NULL THEN PERFORM sync_classes_to_term(v_term); END IF;
    END IF;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS terms_current_keeps_classes ON terms;
  CREATE TRIGGER terms_current_keeps_classes AFTER UPDATE OF current ON terms
    FOR EACH ROW EXECUTE FUNCTION current_term_keeps_classes();
  DROP TRIGGER IF EXISTS school_years_current_keeps_classes ON school_years;
  CREATE TRIGGER school_years_current_keeps_classes AFTER UPDATE OF current ON school_years
    FOR EACH ROW EXECUTE FUNCTION current_term_keeps_classes();
`;

const ENROLLMENT_CLASS_BACKFILL_SQL = `
  INSERT INTO enrolled_classes (enrollment_id, class_id)
  SELECT DISTINCT es.enrollment_id, es.class_id
    FROM enrolled_students es
   WHERE es.class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM enrolled_classes ec WHERE ec.enrollment_id = es.enrollment_id AND ec.class_id = es.class_id)
  ON CONFLICT (enrollment_id, class_id) DO NOTHING;

  SELECT sync_classes_to_term(t.term_id) FROM terms t WHERE is_current_term(t.term_id);
`;

// Every term a student has scores in, and every term they were enrolled in a
// class whose subjects are on their list.
const STUDENT_TERM_SUBJECTS_BACKFILL_SQL = `
  INSERT INTO student_term_subjects (student_id, subject_id, term_id, organization_id)
  SELECT DISTINCT ar.student_id, ar.subject_id, ar.term_id, ar.organization_id
    FROM assessment_results ar
    JOIN students s ON s.student_id = ar.student_id
    JOIN subjects sub ON sub.subject_id = ar.subject_id
    JOIN terms t ON t.term_id = ar.term_id
   WHERE ar.organization_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO student_term_subjects (student_id, subject_id, term_id, organization_id)
  SELECT DISTINCT ss.student_id, ss.subject_id, e.term_id, sub.organization_id
    FROM student_subjects ss
    JOIN subjects sub ON sub.subject_id = ss.subject_id
    JOIN enrolled_students es ON es.student_id = ss.student_id AND es.class_id = sub.class_id
    JOIN enrollments e ON e.enrollment_id = es.enrollment_id AND e.organization_id = sub.organization_id
    JOIN terms t ON t.term_id = e.term_id
  ON CONFLICT DO NOTHING;
`;

async function runSafely(client, sql, params) {
  try {
    await client.query(sql, params);
    return true;
  } catch (err) {
    console.warn("[recordSafety]", err.message.slice(0, 200));
    return false;
  }
}

async function applyRules(client) {
  // Changing links briefly locks two tables; never wait long behind live traffic.
  await client.query("SET lock_timeout = '5s'");

  const { rows: columnRows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );
  const columns = new Map();
  columnRows.forEach(({ table_name: t, column_name: c }) => {
    if (!columns.has(t)) columns.set(t, new Set());
    columns.get(t).add(c);
  });
  const has = (table, column) => columns.has(table) && columns.get(table).has(column);

  // Parents can be looked up by (id, school).
  for (const [parent, key] of [["terms", "term_id"], ["classes", "class_id"], ["subjects", "subject_id"], ["school_years", "id"]]) {
    await runSafely(client, `CREATE UNIQUE INDEX IF NOT EXISTS ${parent}_id_school_uidx ON ${parent} (${key}, organization_id)`);
  }

  const { rows: existing } = await client.query(
    `SELECT conname FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`
  );
  const names = new Set(existing.map((r) => r.conname));

  for (const [table, column, parent, key] of SAME_SCHOOL_LINKS) {
    if (!has(table, column) || !has(table, "organization_id") || !has(parent, "organization_id")) continue;
    const name = `${table}_${column}_same_school_fk`;
    if (!names.has(name)) {
      const added = await runSafely(
        client,
        `ALTER TABLE ${table} ADD CONSTRAINT ${name}
           FOREIGN KEY (${column}, organization_id) REFERENCES ${parent} (${key}, organization_id) NOT VALID`
      );
      if (!added) continue;
    }
    // Checks the rows already saved; if any were off it stays in force for new ones.
    await runSafely(client, `ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`);
  }

  // Old "delete these too" links from saved records.
  const { rows: cascades } = await client.query(
    `SELECT c.conrelid::regclass::text AS table_name, c.conname
       FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.confdeltype = 'c'
        AND c.conrelid::regclass::text = ANY($1::text[])
        AND c.confrelid::regclass::text IN ('classes', 'subjects', 'terms', 'school_years')
        AND array_length(c.conkey, 1) = 1`,
    [RECORD_TABLES]
  );
  for (const { table_name: table, conname } of cascades) {
    await runSafely(client, `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${conname}`);
  }

  // Deleting a class must never delete its students. Checked when the change is
  // saved (deferred), so deleting a whole school, which removes some rows a step
  // later than others, still works.
  const { rows: studentCascade } = await client.query(
    `SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'students'::regclass AND confrelid = 'classes'::regclass AND confdeltype = 'c'`
  );
  if (names.has("students_class_id_keep_fk")) {
    await runSafely(client, `ALTER TABLE students ALTER CONSTRAINT students_class_id_keep_fk DEFERRABLE INITIALLY DEFERRED`);
  } else if (studentCascade.length) {
    await runSafely(
      client,
      `ALTER TABLE students ADD CONSTRAINT students_class_id_keep_fk
         FOREIGN KEY (class_id) REFERENCES classes (class_id) DEFERRABLE INITIALLY DEFERRED NOT VALID`
    );
  }
  if (studentCascade.length && await runSafely(client, `ALTER TABLE students VALIDATE CONSTRAINT students_class_id_keep_fk`)) {
    for (const { conname } of studentCascade) {
      await runSafely(client, `ALTER TABLE students DROP CONSTRAINT IF EXISTS ${conname}`);
    }
  }

  // Class enrollments keep their original link (removed with their class): a
  // whole-school delete relies on it. The app refuses to delete a class that
  // has enrollments. (An earlier version of these rules changed it; put back.)
  if (names.has("enrolled_students_class_id_keep_fk")) {
    const { rows: enrollCascade } = await client.query(
      `SELECT 1 FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'enrolled_students'::regclass AND confrelid = 'classes'::regclass AND confdeltype = 'c'`
    );
    if (!enrollCascade.length) {
      await runSafely(
        client,
        `ALTER TABLE enrolled_students ADD CONSTRAINT enrolled_students_class_id_fkey
           FOREIGN KEY (class_id) REFERENCES classes (class_id) ON DELETE CASCADE NOT VALID`
      );
      await runSafely(client, `ALTER TABLE enrolled_students VALIDATE CONSTRAINT enrolled_students_class_id_fkey`);
    }
    await runSafely(client, `ALTER TABLE enrolled_students DROP CONSTRAINT IF EXISTS enrolled_students_class_id_keep_fk`);
  }

  await client.query(STUDENT_TERM_SUBJECTS_SQL);
  await client.query(STUDENT_TERM_SUBJECTS_BACKFILL_SQL);
  // Lookups by child (parents list, parent portal access checks).
  await runSafely(client, "CREATE INDEX IF NOT EXISTS guardian_students_student_idx ON guardian_students (student_id)");
  await runSafely(client, "CREATE INDEX IF NOT EXISTS guardians_org_student_idx ON guardians (organization_id, student_id)");
  await client.query(ENROLLMENT_CLASS_SQL);
  await client.query(ENROLLMENT_CLASS_BACKFILL_SQL);
}

async function ensureRecordSafetySchema(db) {
  if (!ready) {
    ready = (async () => {
      const client = typeof db.connect === "function" ? await db.connect() : db;
      try {
        await applyRules(client);
      } finally {
        if (client !== db) {
          await client.query("RESET lock_timeout").catch(() => {});
          client.release();
        }
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

module.exports = { ensureRecordSafetySchema, SAME_SCHOOL_LINKS, RECORD_TABLES };
