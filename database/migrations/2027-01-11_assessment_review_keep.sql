-- Assessments, simpler: keep today's behaviour for schools that review tests. NOT RUN YET: run it by
-- name, AFTER 2027-01-10_assessment_simplify.sql (it needs tenant_settings.review_tests). Safe to run again.
--
-- "Review tests before students see them" is off for new schools. A school that already uses approval
-- (somebody there has approved or rejected a question set) gets it switched ON, so for them newly saved
-- tests still wait for a manager or supervisor exactly as before.
--
-- Count first (read-only), then run the file:
--   SELECT COUNT(DISTINCT organization_id) FROM assessment_question_sets
--    WHERE reviewed_by IS NOT NULL AND LOWER(COALESCE(review_status, '')) IN ('approved', 'rejected');
INSERT INTO tenant_settings (organization_id, review_tests, updated_by, updated_at)
SELECT DISTINCT qs.organization_id, TRUE, 'assessment_review_keep', NOW()
  FROM assessment_question_sets qs
  JOIN organizations o ON o.organization_id = qs.organization_id
 WHERE qs.reviewed_by IS NOT NULL AND LOWER(COALESCE(qs.review_status, '')) IN ('approved', 'rejected')
ON CONFLICT (organization_id) DO UPDATE
   SET review_tests = TRUE, updated_by = 'assessment_review_keep', updated_at = NOW();
