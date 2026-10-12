-- Each school's web address (nickname.managira.com) must be unique. Sign-up
-- checks it, but two sign-ups at the same moment could both pass the check.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS organizations_nickname_unique
  ON organizations (LOWER(nickname))
  WHERE nickname IS NOT NULL;
