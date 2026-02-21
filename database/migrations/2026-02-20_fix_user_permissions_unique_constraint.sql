-- Ensure user_permissions uniqueness is scoped per organization
-- Safe to run multiple times.

BEGIN;

-- 1) Remove duplicate rows before adding/re-adding the target unique constraint.
-- Keep the earliest row for each (user_id, organization_id, permission_key).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, organization_id, permission_key
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM user_permissions
)
DELETE FROM user_permissions up
USING ranked r
WHERE up.id = r.id
  AND r.rn > 1;

-- 2) Drop old wrong unique constraint if it exists.
ALTER TABLE user_permissions
  DROP CONSTRAINT IF EXISTS user_permissions_user_id_permission_key_key;

-- 3) Ensure correct unique constraint exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_permissions_user_org_perm_unique'
  ) THEN
    ALTER TABLE user_permissions
      ADD CONSTRAINT user_permissions_user_org_perm_unique
      UNIQUE (user_id, organization_id, permission_key);
  END IF;
END
$$;

COMMIT;
