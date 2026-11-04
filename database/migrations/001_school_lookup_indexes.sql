-- Indexes for the lookups schools use most, which had no matching index.
-- CONCURRENTLY keeps the tables usable while these build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_org_term_class_date ON attendance_records (organization_id, term_id, class_id, date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_class_date ON attendance_records (class_id, date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assessment_results_org_term_class ON assessment_results (organization_id, term_id, class_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_category_scores_org_term_class ON category_scores (organization_id, term_id, class_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_student_positions_org_term_class ON student_positions (organization_id, term_id, class_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subjects_org_class ON subjects (organization_id, class_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_classes_org ON classes (organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_terms_org_year ON terms (organization_id, school_year_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_classes_class ON user_classes (class_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_student_subjects_subject ON student_subjects (subject_id);
