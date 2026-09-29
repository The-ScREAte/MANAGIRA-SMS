-- Indexes for the score sheet (common/assessment) and saveAllScores.
-- Also applied at runtime by ensureScoreSheetIndexes() in commonController.
CREATE INDEX IF NOT EXISTS idx_assessment_results_assessment
  ON assessment_results (assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_class_subject_term
  ON assessment_results (class_id, subject_id, term_id);
CREATE INDEX IF NOT EXISTS idx_enrolled_students_class_student
  ON enrolled_students (class_id, student_id);
CREATE INDEX IF NOT EXISTS idx_enrolled_students_student
  ON enrolled_students (student_id);
CREATE INDEX IF NOT EXISTS idx_students_org_class
  ON students (organization_id, class_id);
