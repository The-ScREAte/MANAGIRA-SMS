-- Sign-ups failed after the card was saved when the school's web address was
-- longer than 15 characters: the nickname slug allows up to 30
-- (utils/orgNicknameSlug.js) but organizations.nickname was VARCHAR(15).
-- Phone columns were also VARCHAR(15), too short for some international
-- numbers ("+" and up to 15 digits). Widening a VARCHAR keeps all data.
-- hub_organizations_view depends on two of these columns, so it is recreated.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP VIEW IF EXISTS hub_organizations_view;

ALTER TABLE organizations
  ALTER COLUMN nickname TYPE VARCHAR(63),
  ALTER COLUMN organization_phone TYPE VARCHAR(32);
ALTER TABLE managira_hubs ALTER COLUMN hub_phone TYPE VARCHAR(32);
ALTER TABLE guardians ALTER COLUMN phone TYPE VARCHAR(32);

CREATE VIEW hub_organizations_view AS
 SELECT o.organization_id,
    o.organization_name,
    COALESCE(o.nickname, o.subdomain) AS org_nickname,
    o.email AS organization_email,
    o.first_name,
    o.last_name,
    o.organization_phone AS org_phone,
    o.organization_address AS org_address,
    o.created_at AS org_created_at,
    o.on_hold AS org_on_hold,
    o.deleted AS org_deleted,
    o.is_hub_member,
    o.joined_hub_at,
    mh.hub_id,
    mh.hub_name,
    mh.hub_nickname,
    mh.hub_email,
    mh.plan_id AS hub_plan_id,
    mh.hub_branding_enabled,
    mh.hub_footer_text,
    mh.on_hold AS hub_on_hold,
    p.plan_name AS hub_plan_name
   FROM organizations o
     JOIN managira_hubs mh ON o.hub_id = mh.hub_id
     LEFT JOIN plans p ON mh.plan_id = p.id
  WHERE o.is_hub_member = true AND o.deleted = false;

COMMIT;
