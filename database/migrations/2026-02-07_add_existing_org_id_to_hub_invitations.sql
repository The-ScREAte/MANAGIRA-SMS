-- Migration: Add existing_org_id to hub_organization_invitations
-- Date: 2026-02-07
-- Description: Adds support for inviting existing organizations to join a hub

ALTER TABLE hub_organization_invitations 
ADD COLUMN IF NOT EXISTS existing_org_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_hub_invitations_existing_org 
ON hub_organization_invitations(existing_org_id);

-- Add comment
COMMENT ON COLUMN hub_organization_invitations.existing_org_id IS 'Reference to existing organization being invited to join hub';
