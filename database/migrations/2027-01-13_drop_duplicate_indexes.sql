-- Drops indexes that are exact copies of another index on the same table (same columns, same
-- operator classes, same WHERE, both non-unique or the copy being the plain one). NOT RUN YET:
-- run it by name. Safe to run again; it changes no data and no query result, it only saves the
-- database a second index update on every write (the biggest win is user_sessions, which is
-- written whenever anyone's session changes).
--
-- Each pair is (copy to drop, index to keep). The copy is dropped only when the one to keep exists
-- AND the two really match, and never when the copy backs a constraint (primary key / unique).
--
-- Look first (read-only):
--   SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
--    AND indexname IN ('idx_user_sessions_expire', 'guardian_profiles_org_idx',
--      'idx_guardian_report_recipients_user', 'idx_guardian_report_recipients_report_id',
--      'idx_finance_payments_received', 'idx_organizations_intended_plan');
DO $$
DECLARE
  pair RECORD;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('idx_user_sessions_expire',                 'IDX_session_expire'),
      ('guardian_profiles_org_idx',                'idx_guardian_profiles_org'),
      ('idx_guardian_report_recipients_user',      'idx_guardian_report_recipients_user_id'),
      ('idx_guardian_report_recipients_report_id', 'idx_guardian_report_recipients_report'),
      ('idx_finance_payments_received',            'idx_finance_payments_org_received_at'),
      ('idx_organizations_intended_plan',          'idx_organizations_intended_plan_id')
    ) AS p(copy_name, keep_name)
  LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_index c
        JOIN pg_class cc ON cc.oid = c.indexrelid AND cc.relname = pair.copy_name
        JOIN pg_namespace n ON n.oid = cc.relnamespace AND n.nspname = 'public'
        JOIN pg_class kc ON kc.relname = pair.keep_name AND kc.relnamespace = n.oid
        JOIN pg_index k ON k.indexrelid = kc.oid
       WHERE c.indrelid = k.indrelid
         AND c.indkey = k.indkey
         AND c.indclass = k.indclass
         AND c.indcollation = k.indcollation
         AND COALESCE(c.indpred::text, '') = COALESCE(k.indpred::text, '')
         AND COALESCE(c.indexprs::text, '') = COALESCE(k.indexprs::text, '')
         AND NOT c.indisunique
         AND NOT c.indisprimary
         AND c.indisvalid AND k.indisvalid
    ) THEN
      EXECUTE format('DROP INDEX IF EXISTS public.%I', pair.copy_name);
    END IF;
  END LOOP;
END $$;
