-- Activities a teacher or the school plans for children. Parents see them on their calendar.
-- A row with no class is for the whole school.
CREATE TABLE IF NOT EXISTS class_activities (
  activity_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(class_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT,
  activity_date DATE NOT NULL,
  end_date DATE,
  start_time TIME,
  end_time TIME,
  location TEXT,
  created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_activities_school_date
  ON class_activities (organization_id, activity_date);

-- What parents can see of a set of questions, so they can help at home.
ALTER TABLE assessment_question_sets
  ADD COLUMN IF NOT EXISTS show_on_parent_portal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parent_notes TEXT;

CREATE TABLE IF NOT EXISTS assessment_set_resources (
  resource_id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  question_set_id INTEGER NOT NULL REFERENCES assessment_question_sets(question_set_id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_key TEXT,
  uploaded_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_set_resources_set
  ON assessment_set_resources (organization_id, question_set_id);
