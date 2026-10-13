-- Hubs can give each of their schools a plan (what the school can use).
-- A hub school's plan: the plan the hub gave it, else the hub's default plan,
-- else its own plan. Managira chooses which plans each hub may give.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS hub_assigned_plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE managira_hubs ADD COLUMN IF NOT EXISTS allowed_plan_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE hub_organization_invitations ADD COLUMN IF NOT EXISTS hub_assigned_plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL;
