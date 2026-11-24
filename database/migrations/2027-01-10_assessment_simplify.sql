-- Assessments, simpler (STEP 2 to 4 of the simplify plan). NOT RUN YET: run it by name after testing.
-- Safe to run again.

-- 1. "Review tests before students see them": a school setting, off by default.
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS review_tests BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. "Accept late until": an optional cut-off after the due date. Late submissions are marked Late.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS late_until TIMESTAMPTZ;
ALTER TABLE student_assessment_attempts ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. "Shuffle questions" as a setting on the test, applied to each student.
ALTER TABLE assessment_question_sets ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE;
