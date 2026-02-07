-- Managira Hub System - Complete Migration
-- Date: 2026-02-06
-- Purpose: Enable multi-tier organizational management with hubs managing multiple organizations

-- =====================================================
-- 1. CREATE MANAGIRA HUBS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS managira_hubs (
    hub_id SERIAL PRIMARY KEY,
    hub_name VARCHAR(255) NOT NULL,
    hub_nickname VARCHAR(64) UNIQUE NOT NULL,
    hub_email VARCHAR(255) UNIQUE NOT NULL,
    hub_password VARCHAR(255),
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    hub_address VARCHAR(255),
    hub_phone VARCHAR(15),
    logo_path VARCHAR(255),
    
    -- Plan & Billing
    plan_id INTEGER REFERENCES plans(id),
    max_organizations INTEGER NOT NULL DEFAULT 5,
    stripe_customer_id VARCHAR(255),
    paystack_customer_code VARCHAR(255),
    
    -- Status flags
    on_hold BOOLEAN DEFAULT FALSE,
    deleted BOOLEAN DEFAULT FALSE,
    approved BOOLEAN DEFAULT TRUE,
    
    -- Customization
    hub_branding_enabled BOOLEAN DEFAULT TRUE,
    hub_footer_text TEXT,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by_admin_id INTEGER REFERENCES users(user_id),
    
    -- Reset password
    reset_password_token VARCHAR(255),
    reset_password_expires TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_hubs_nickname ON managira_hubs(hub_nickname);
CREATE INDEX IF NOT EXISTS idx_hubs_email ON managira_hubs(hub_email);
CREATE INDEX IF NOT EXISTS idx_hubs_deleted ON managira_hubs(deleted);
CREATE INDEX IF NOT EXISTS idx_hubs_on_hold ON managira_hubs(on_hold);

-- =====================================================
-- 2. ALTER ORGANIZATIONS TABLE FOR HUB SUPPORT
-- =====================================================
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS hub_id INTEGER REFERENCES managira_hubs(hub_id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_hub_member BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS hub_invitation_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS hub_invitation_expires TIMESTAMP,
ADD COLUMN IF NOT EXISTS hub_invitation_accepted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS joined_hub_at TIMESTAMP;

-- Create index for hub queries
CREATE INDEX IF NOT EXISTS idx_organizations_hub ON organizations(hub_id);
CREATE INDEX IF NOT EXISTS idx_organizations_hub_member ON organizations(is_hub_member);

-- =====================================================
-- 3. CREATE HUB SESSIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS hub_sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_sessions_expire ON hub_sessions(expire);

-- =====================================================
-- 4. CREATE HUB ACTIVITY LOGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS hub_activity_logs (
    log_id SERIAL PRIMARY KEY,
    hub_id INTEGER REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
    action_type VARCHAR(100) NOT NULL,
    target_organization_id INTEGER REFERENCES organizations(organization_id),
    description TEXT,
    performed_by VARCHAR(255),
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hub_logs_hub_id ON hub_activity_logs(hub_id);
CREATE INDEX IF NOT EXISTS idx_hub_logs_created_at ON hub_activity_logs(created_at);

-- =====================================================
-- 5. CREATE HUB ORGANIZATION INVITATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS hub_organization_invitations (
    invitation_id SERIAL PRIMARY KEY,
    hub_id INTEGER NOT NULL REFERENCES managira_hubs(hub_id) ON DELETE CASCADE,
    organization_name VARCHAR(255) NOT NULL,
    contact_person_name VARCHAR(255) NOT NULL,
    contact_person_email VARCHAR(255) NOT NULL,
    contact_person_phone VARCHAR(20),
    invitation_token VARCHAR(255) UNIQUE NOT NULL,
    message TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hub_invitations_token ON hub_organization_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_hub_invitations_hub_id ON hub_organization_invitations(hub_id);
CREATE INDEX IF NOT EXISTS idx_hub_invitations_status ON hub_organization_invitations(status);
CREATE INDEX IF NOT EXISTS idx_hub_invitations_email ON hub_organization_invitations(contact_person_email);

-- =====================================================
-- 6. CREATE TRIGGER FOR UPDATED_AT
-- =====================================================
CREATE OR REPLACE FUNCTION update_hub_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now(); 
    RETURN NEW; 
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER update_hubs_modtime
    BEFORE UPDATE ON managira_hubs
    FOR EACH ROW
    EXECUTE FUNCTION update_hub_modified_column();

CREATE TRIGGER update_hub_invitations_modtime
    BEFORE UPDATE ON hub_organization_invitations
    FOR EACH ROW
    EXECUTE FUNCTION update_hub_modified_column();

-- =====================================================
-- 7. CREATE USEFUL VIEW FOR HUB ORGANIZATIONS
-- =====================================================
CREATE OR REPLACE VIEW hub_organizations_view AS
SELECT 
    o.organization_id,
    o.organization_name,
    o.nickname as org_nickname,
    o.organization_email,
    o.first_name,
    o.last_name,
    o.phone,
    o.created_at as org_created_at,
    o.on_hold as org_on_hold,
    o.deleted as org_deleted,
    o.is_hub_member,
    o.joined_hub_at,
    mh.hub_id,
    mh.hub_name,
    mh.hub_nickname,
    mh.hub_email,
    mh.plan_id as hub_plan_id,
    mh.hub_branding_enabled,
    mh.hub_footer_text,
    mh.on_hold as hub_on_hold,
    p.plan_name as hub_plan_name
FROM organizations o
JOIN managira_hubs mh ON o.hub_id = mh.hub_id
LEFT JOIN plans p ON mh.plan_id = p.id
WHERE o.is_hub_member = true AND o.deleted = false;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- You can now:
-- 1. Create hubs from admin panel
-- 2. Invite organizations to join hubs
-- 3. Organizations inherit hub plans and features
-- 4. Hubs can view all their organizations' data
-- 5. Subdomain structure: orgname.hubname.managira.com
