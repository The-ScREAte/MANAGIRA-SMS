-- Database updates for Paystack integration and card storage

-- Add Paystack fields to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS paystack_customer_code VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id INT;

-- Update payments table for Paystack
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_subscription_code VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_reference VARCHAR(255);

-- Create stored_cards table for managing user cards
CREATE TABLE IF NOT EXISTS stored_cards (
    id SERIAL PRIMARY KEY,
    organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
    authorization_code VARCHAR(255) NOT NULL,
    card_type VARCHAR(50),
    last4 VARCHAR(4),
    exp_month VARCHAR(2),
    exp_year VARCHAR(4),
    bin VARCHAR(6),
    bank VARCHAR(100),
    channel VARCHAR(50),
    signature VARCHAR(255),
    reusable BOOLEAN DEFAULT true,
    country_code VARCHAR(3),
    display_name VARCHAR(120),
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create unique index to prevent duplicate authorizations
CREATE UNIQUE INDEX IF NOT EXISTS idx_stored_cards_auth_code ON stored_cards(authorization_code);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_stored_cards_org_id ON stored_cards(organization_id);
CREATE INDEX IF NOT EXISTS idx_stored_cards_active ON stored_cards(organization_id, is_active);

-- Add trigger to update timestamp
CREATE OR REPLACE FUNCTION update_stored_cards_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_stored_cards_modtime
    BEFORE UPDATE ON stored_cards
    FOR EACH ROW
    EXECUTE FUNCTION update_stored_cards_timestamp();
