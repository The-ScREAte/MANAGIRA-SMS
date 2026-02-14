-- Add hub contract dates
-- Date: 2026-02-12

ALTER TABLE managira_hubs
ADD COLUMN IF NOT EXISTS contract_start_date DATE,
ADD COLUMN IF NOT EXISTS contract_end_date DATE;

CREATE INDEX IF NOT EXISTS idx_hubs_contract_end_date ON managira_hubs(contract_end_date);
