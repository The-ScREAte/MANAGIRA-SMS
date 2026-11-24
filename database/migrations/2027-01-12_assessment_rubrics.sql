-- Rubrics for written (essay) questions. NOT RUN ON LIVE: run it by name. Safe to run again.
-- A rubric is a short list of criteria with marks (assessment_questions.rubric_json:
-- {"criteria":[{"name":"Content","marks":5}, ...]}). The question's marks are the criteria's total.
-- A marker's marks per criterion are kept with the answer (student_assessment_responses.rubric_marks: [4, 2, 1]).
-- Until it runs, questions work as before and the rubric option is not offered.
ALTER TABLE assessment_questions ADD COLUMN IF NOT EXISTS rubric_json JSONB;
ALTER TABLE student_assessment_responses ADD COLUMN IF NOT EXISTS rubric_marks JSONB;
