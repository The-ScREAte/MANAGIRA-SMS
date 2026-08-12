-- Lets an Admin grant a Managira Worker permission to add notes/comments to
-- contacts they can see via a grant (not their own/assigned), which already
-- always allowed commenting. Off by default.
ALTER TABLE user_feature_flags
  ADD COLUMN IF NOT EXISTS can_comment_contacts BOOLEAN NOT NULL DEFAULT FALSE;
