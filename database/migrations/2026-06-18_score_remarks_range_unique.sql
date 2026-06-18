-- Make score_remarks truly dynamic by allowing multiple ranges,
-- even when remark text is the same.

-- 1) Keep only the newest row per exact range.
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, class_id, term_id, from_percentage, to_percentage
      ORDER BY id DESC
    ) AS rn
  FROM score_remarks
)
DELETE FROM score_remarks s
USING ranked r
WHERE s.ctid = r.ctid
  AND r.rn > 1;

-- 2) Drop old uniqueness constraints that merge by remark text.
ALTER TABLE score_remarks DROP CONSTRAINT IF EXISTS score_remarks_unique;
ALTER TABLE score_remarks DROP CONSTRAINT IF EXISTS unique_organization_class_score;
ALTER TABLE score_remarks DROP CONSTRAINT IF EXISTS unique_score_remark;

-- 3) Recreate canonical unique constraint by range.
ALTER TABLE score_remarks
ADD CONSTRAINT score_remarks_unique
UNIQUE (organization_id, class_id, term_id, from_percentage, to_percentage);
