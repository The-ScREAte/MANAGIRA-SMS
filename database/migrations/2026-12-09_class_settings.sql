-- Class settings (feature class_settings, utils/classSettings.js): one row per class with what
-- that class has switched on (lunch) and what its parents see (attendance, lunch, report cards,
-- bus). A class with no row uses the defaults in code (everything on). Safe to run again.
CREATE TABLE IF NOT EXISTS class_settings (
  organization_id INTEGER NOT NULL,
  class_id        INTEGER NOT NULL,
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by      INTEGER,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, class_id)
);

-- Main and assistant teachers already saved on the staff form get Class Settings for their own
-- classes (new teachers get it from the Teacher preset; staff never saved get it as a default).
-- Only people with the saved marker get a row, so nobody unsaved becomes "saved" with one
-- permission. Once a school has any Class Settings row this does nothing for it, so running
-- it again never gives back a permission someone was refused.
INSERT INTO user_permissions (user_id, organization_id, permission_key)
SELECT DISTINCT u.user_id, u.organization_id, 'class_settings'
  FROM users u
  JOIN user_classes uc ON uc.user_id = u.user_id
  JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = u.organization_id
 WHERE uc.main IS TRUE
   AND EXISTS (SELECT 1 FROM user_permissions s
                WHERE s.user_id = u.user_id AND s.organization_id = u.organization_id AND s.permission_key = 'permissions_saved')
   AND NOT EXISTS (SELECT 1 FROM user_permissions x
                    WHERE x.organization_id = u.organization_id AND x.permission_key IN ('class_settings', 'class_settings_all'))
ON CONFLICT DO NOTHING;
