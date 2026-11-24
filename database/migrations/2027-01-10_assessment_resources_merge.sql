-- Assessments, simpler: one Resources box per test (STEP 3.3). NOT RUN: it changes what students can
-- see, so it waits for approval. Safe to run again.
--
-- Until now a question could carry its own files and link (assessment_questions.help_json). The editor no
-- longer adds new ones: files and links go in the test's Resources, and a question keeps one "Hint" text.
-- This copies the files and links already attached to questions into their test's Resources.
--
-- What changes for students when it runs:
--   * Resources show per TEST (and only in open-book mode, as every Resource does), not under one question.
--     So the same files are no longer shown under their question during a closed-book test.
--   * "Students can see resources" is switched on for every test that had question files or links, so
--     nobody loses a file they could open before.
-- help_json is NOT cleared here, so nothing is lost: do that in a later step once the result is checked.

-- Files
INSERT INTO assessment_set_resources (organization_id, question_set_id, file_name, file_url, file_key, uploaded_by)
SELECT DISTINCT ON (q.question_set_id, f->>'key')
       q.organization_id, q.question_set_id, COALESCE(NULLIF(f->>'name', ''), 'File'), f->>'url', f->>'key', NULL
  FROM assessment_questions q,
       LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(q.help_json->'files') = 'array' THEN q.help_json->'files' ELSE '[]'::jsonb END) f
 WHERE q.help_json IS NOT NULL AND COALESCE(f->>'key', '') <> ''
   AND NOT EXISTS (SELECT 1 FROM assessment_set_resources r
                    WHERE r.question_set_id = q.question_set_id AND r.file_key = f->>'key');

-- Links
INSERT INTO assessment_set_resources (organization_id, question_set_id, file_name, file_url, file_key, uploaded_by)
SELECT DISTINCT ON (q.question_set_id, q.help_json->'link'->>'url')
       q.organization_id, q.question_set_id,
       COALESCE(NULLIF(q.help_json->'link'->>'label', ''), q.help_json->'link'->>'url'),
       q.help_json->'link'->>'url', NULL, NULL
  FROM assessment_questions q
 WHERE q.help_json IS NOT NULL AND COALESCE(q.help_json->'link'->>'url', '') ~* '^https?://'
   AND NOT EXISTS (SELECT 1 FROM assessment_set_resources r
                    WHERE r.question_set_id = q.question_set_id AND r.file_key IS NULL AND r.file_url = q.help_json->'link'->>'url');

-- Students keep seeing them.
UPDATE assessment_question_sets qs SET students_see_resources = TRUE
 WHERE EXISTS (SELECT 1 FROM assessment_questions q
                WHERE q.question_set_id = qs.question_set_id
                  AND (jsonb_array_length(CASE WHEN jsonb_typeof(q.help_json->'files') = 'array' THEN q.help_json->'files' ELSE '[]'::jsonb END) > 0
                       OR COALESCE(q.help_json->'link'->>'url', '') ~* '^https?://'));
