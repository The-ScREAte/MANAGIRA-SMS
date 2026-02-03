-- Add pending plan columns to organizations table
ALTER TABLE organizations
ADD COLUMN pending_plan_id INTEGER,
ADD COLUMN pending_plan_effective_date TIMESTAMP;

-- (Optional) Add a foreign key constraint if you want strict referential integrity
-- ALTER TABLE organizations
-- ADD CONSTRAINT fk_pending_plan FOREIGN KEY (pending_plan_id) REFERENCES plans(id);
