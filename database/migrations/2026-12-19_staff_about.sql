-- "About me" for staff (feature teacher_cards, utils/staffAbout.js): a fun fact and up to two
-- photos a member of staff writes about themselves on their profile, shown to families on the
-- child's Teachers page where Class settings shares it. Photos are private files under
-- staff-about/<school>/ (opened through /files/ by signed-in people of that school only).
CREATE TABLE IF NOT EXISTS staff_about (
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  fun_fact TEXT NOT NULL DEFAULT '',
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);
