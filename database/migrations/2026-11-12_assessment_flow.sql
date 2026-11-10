-- Assessments flow (feature assessment_flow). Safe to run more than once.
--
-- A score saved while the flow is on waits for the teacher's approval before parents and
-- students see it: pending_since marks it, posted_score / posted_choice keep what they saw
-- before (nothing, for a new score). A row with no pending_since is what everyone sees, so
-- scores saved before this, or by a school without the flow, need nothing done.
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS pending_since TIMESTAMPTZ;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS pending_source TEXT;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS posted_score NUMERIC(5,2);
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS posted_choice TEXT;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS approved_by INTEGER;
CREATE INDEX IF NOT EXISTS assessment_results_pending_idx
  ON assessment_results (assessment_id) WHERE pending_since IS NOT NULL;

-- A picture on a question, and the numbered spots of a "label the picture" question.
ALTER TABLE assessment_questions ADD COLUMN IF NOT EXISTS media_json JSONB;

-- What parents and the student see of a finished test once its grade is posted:
-- NULL nothing, 'grade' the grade, 'full' the grade with the questions and answers.
ALTER TABLE assessment_question_sets ADD COLUMN IF NOT EXISTS parent_share TEXT;
