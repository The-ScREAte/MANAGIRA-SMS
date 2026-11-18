-- One parent sign-in across schools (feature family_link): the parent's answer to another school's
-- invitation, kept on that school's parent account. 'accepted' shows its children on the sign-in
-- the parent uses; 'declined' ("Not me") hides it. Empty = not answered yet.
ALTER TABLE guardian_accounts ADD COLUMN IF NOT EXISTS family_status TEXT;
ALTER TABLE guardian_accounts ADD COLUMN IF NOT EXISTS family_decided_at TIMESTAMPTZ;
