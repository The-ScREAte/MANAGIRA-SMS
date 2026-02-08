-- Migration: Add hub detachment request system
-- Created: 2026-02-07

-- Create table for detachment requests
CREATE TABLE IF NOT EXISTS hub_detachment_requests (
    request_id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(organization_id),
    hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id),
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by VARCHAR(255) NOT NULL,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_detachment_org_id ON hub_detachment_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_detachment_hub_id ON hub_detachment_requests(hub_id);
CREATE INDEX IF NOT EXISTS idx_detachment_status ON hub_detachment_requests(status);

-- Add comment
COMMENT ON TABLE hub_detachment_requests IS 'Stores requests from organizations to detach from their hub';
