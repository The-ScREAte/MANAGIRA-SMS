-- Custom forms (feature custom_forms), student portfolios (student_portfolio) and help on
-- each question (learning_resources). Safe to run again: everything is IF NOT EXISTS.

-- A section of fields the school designs: where it shows, which classes, who fills it in, its
-- fields and what it starts (tasks, notifications, calendar). Fields and rules are kept with
-- the section, so a section saves in one statement.
CREATE TABLE IF NOT EXISTS custom_sections (
  section_id      SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  icon            VARCHAR(30) NOT NULL DEFAULT 'form',
  notes           TEXT,
  multiple        BOOLEAN NOT NULL DEFAULT FALSE,
  filled_by       VARCHAR(10) NOT NULL DEFAULT 'staff' CHECK (filled_by IN ('staff', 'parent', 'student')),
  class_ids       INTEGER[] NOT NULL DEFAULT '{}',
  show_parents    BOOLEAN NOT NULL DEFAULT FALSE,
  show_students   BOOLEAN NOT NULL DEFAULT FALSE,
  protected       BOOLEAN NOT NULL DEFAULT FALSE,
  required        BOOLEAN NOT NULL DEFAULT FALSE,
  due_date        DATE,
  status          VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'archived')),
  fields          JSONB NOT NULL DEFAULT '[]'::jsonb,
  rules           JSONB NOT NULL DEFAULT '[]'::jsonb,
  position        INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_sections_org ON custom_sections (organization_id, status, position);

-- What was filled in, one row per student (or many, for a list of entries).
CREATE TABLE IF NOT EXISTS custom_section_entries (
  entry_id          SERIAL PRIMARY KEY,
  organization_id   INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  section_id        INTEGER NOT NULL REFERENCES custom_sections(section_id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  data              JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted         BOOLEAN NOT NULL DEFAULT TRUE,
  saved_by_type     VARCHAR(10) NOT NULL DEFAULT 'staff',
  saved_by_id       INTEGER,
  saved_by_name     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_entries_section ON custom_section_entries (section_id, student_id);
CREATE INDEX IF NOT EXISTS idx_custom_entries_student ON custom_section_entries (organization_id, student_id);

-- What an automation already did, so each rule acts once per entry (and once per reminder day).
CREATE TABLE IF NOT EXISTS custom_section_runs (
  run_id          SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  section_id      INTEGER NOT NULL REFERENCES custom_sections(section_id) ON DELETE CASCADE,
  entry_id        INTEGER NOT NULL DEFAULT 0,
  student_id      INTEGER NOT NULL DEFAULT 0,
  rule_id         VARCHAR(40) NOT NULL,
  fire_key        VARCHAR(80) NOT NULL DEFAULT '',
  task_id         INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (section_id, entry_id, student_id, rule_id, fire_key)
);
CREATE INDEX IF NOT EXISTS idx_custom_runs_org ON custom_section_runs (organization_id, created_at DESC);

-- A task a form made: who hears when it is done.
CREATE TABLE IF NOT EXISTS custom_section_tasks (
  task_id         INTEGER PRIMARY KEY REFERENCES org_tasks(task_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  section_id      INTEGER REFERENCES custom_sections(section_id) ON DELETE SET NULL,
  entry_id        INTEGER,
  student_id      INTEGER,
  notify_done     INTEGER[] NOT NULL DEFAULT '{}',
  notified_at     TIMESTAMPTZ
);

-- Work a teacher adds to a student's portfolio for a term (a scan of a project, a certificate).
CREATE TABLE IF NOT EXISTS student_portfolio_items (
  item_id         SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  term_id         INTEGER NOT NULL,
  title           TEXT NOT NULL,
  note            TEXT,
  file_name       TEXT,
  file_url        TEXT,
  file_key        TEXT,
  added_by        INTEGER,
  added_by_name   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_items_student ON student_portfolio_items (organization_id, student_id, term_id);

-- Help on one question: a recommendation, a link and files (utils/questionHelp.js).
ALTER TABLE assessment_questions ADD COLUMN IF NOT EXISTS help_json JSONB;

-- A question set's resources and recommendations shown to students with the test, not only
-- for open-book tests (utils/parentResources.js).
ALTER TABLE assessment_question_sets ADD COLUMN IF NOT EXISTS students_see_resources BOOLEAN NOT NULL DEFAULT FALSE;
