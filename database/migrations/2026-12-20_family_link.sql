-- One parent sign-in across schools (feature family_link, utils/familyLink.js): the sign-in email
-- this parent account has proven it owns (an emailed code accepted for it). Other schools' children
-- with the same email show only while this matches the account's current login_email.
ALTER TABLE guardian_accounts ADD COLUMN IF NOT EXISTS email_proven TEXT;
CREATE INDEX IF NOT EXISTS guardian_accounts_login_email_lower_idx ON guardian_accounts (LOWER(login_email));
