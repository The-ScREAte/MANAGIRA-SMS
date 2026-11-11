-- Google Classroom: what each school chose (how courses are made, which assessments become
-- Google assignments, which way grades travel, parent invitations), and for each grade the
-- value Managira and Google last agreed on, so a grade changed in one place reaches the other
-- without overwriting a newer one. Both are new columns without a stored default rewrite.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS google_classroom_options JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS google_grade NUMERIC(6,2);
