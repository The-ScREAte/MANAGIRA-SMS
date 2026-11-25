-- Report remarks: the built-in Custom editor section every school has.
-- The app makes it the first time a school's Custom editor or Report Settings reads it
-- (utils/customForms.js ensureRemarksSection), so nothing here is needed for it to work; this
-- only (1) renames a school's older "Report card remarks" section and marks it as the built-in
-- one (answers are stored by section id and field id, so none are touched), and (2) makes sure a
-- school can't end up with two. Safe to run again.

UPDATE custom_sections s
   SET name = 'Report remarks',
       options = COALESCE(s.options, '{}'::jsonb) || jsonb_build_object('builtin', 'report_remarks')
                 || CASE WHEN s.options->>'beside' = 'true' THEN '{}'::jsonb ELSE '{"besideChosen": true}'::jsonb END,
       updated_at = NOW()
 WHERE s.section_id IN (
         SELECT DISTINCT ON (organization_id) section_id
           FROM custom_sections
          WHERE name IN ('Report card remarks', 'Report remarks')
            AND COALESCE(options->>'builtin', '') = ''
            AND organization_id NOT IN (SELECT organization_id FROM custom_sections WHERE options->>'builtin' = 'report_remarks')
          ORDER BY organization_id, section_id
       );

CREATE UNIQUE INDEX IF NOT EXISTS custom_sections_one_report_remarks
    ON custom_sections (organization_id)
    WHERE options->>'builtin' = 'report_remarks';

-- Report remarks is shown beside each student unless the school itself unticked that
-- (besideChosen is set when it does): earlier built-in rows made with it off are switched on.
UPDATE custom_sections
   SET options = options || '{"beside": true}'::jsonb, updated_at = NOW()
 WHERE options->>'builtin' = 'report_remarks'
   AND COALESCE(options->>'beside', '') <> 'true'
   AND COALESCE(options->>'besideChosen', '') <> 'true';
