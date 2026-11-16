-- Unsubscribe links in optional emails (utils/emailLinks.js) and the email choices on staff and
-- parent settings pages, kept by address: every send checks this one table (sendEmailSafely).
-- The choices are also saved on the person's account, where their settings page reads them.
CREATE TABLE IF NOT EXISTS email_opt_outs (
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (email, category)
);

-- Choices people already made on their settings pages. Safe to repeat.
DO $$
BEGIN
  IF to_regclass('public.user_email_preferences') IS NOT NULL THEN
    INSERT INTO email_opt_outs (email, category)
    SELECT DISTINCT LOWER(TRIM(u.email)), p.preference_key
      FROM user_email_preferences p JOIN users u ON u.user_id = p.user_id
     WHERE p.enabled = FALSE AND NULLIF(TRIM(u.email), '') IS NOT NULL
    ON CONFLICT (email, category) DO NOTHING;
  END IF;
  IF to_regclass('public.guardian_email_preferences') IS NOT NULL THEN
    INSERT INTO email_opt_outs (email, category)
    SELECT DISTINCT LOWER(TRIM(g.email)), p.preference_key
      FROM guardian_email_preferences p JOIN guardian_profiles g ON g.guardian_id = p.guardian_id
     WHERE p.enabled = FALSE AND NULLIF(TRIM(g.email), '') IS NOT NULL
    ON CONFLICT (email, category) DO NOTHING;
  END IF;
END $$;
