-- ✅ Paystack Subaccounts Migration Script
-- This replaces the Flutterwave subaccount system

-- Migration script to update existing paystack_subaccounts table with support for bank and mobile money accounts
-- This adds new fields for different payment types while preserving existing data

-- First, add the new columns if they don't exist
DO $$ 
BEGIN
    -- Add mobile money fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'paystack_subaccounts' AND column_name = 'momo_number') THEN
        ALTER TABLE paystack_subaccounts ADD COLUMN momo_number VARCHAR(20);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'paystack_subaccounts' AND column_name = 'momo_provider') THEN
        ALTER TABLE paystack_subaccounts ADD COLUMN momo_provider VARCHAR(50);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'paystack_subaccounts' AND column_name = 'account_holder_name') THEN
        ALTER TABLE paystack_subaccounts ADD COLUMN account_holder_name VARCHAR(255);
    END IF;
    
    -- Add updated_at if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'paystack_subaccounts' AND column_name = 'updated_at') THEN
        ALTER TABLE paystack_subaccounts ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
    
    -- Update account_type column to allow mobile_money if it's restricted
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'paystack_subaccounts' AND column_name = 'account_type') THEN
        -- Drop existing constraint if it exists
        ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS paystack_subaccounts_account_type_check;
        -- Add new constraint
        ALTER TABLE paystack_subaccounts ADD CONSTRAINT paystack_subaccounts_account_type_check 
            CHECK (account_type IN ('bank', 'mobile_money'));
    END IF;
END $$;

-- Remove percentage_charge column if it exists (no longer needed)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'paystack_subaccounts' AND column_name = 'percentage_charge') THEN
        ALTER TABLE paystack_subaccounts DROP COLUMN percentage_charge;
    END IF;
END $$;

-- Add constraints to ensure proper field population based on account type
DO $$
BEGIN
    -- Drop existing constraints if they exist
    ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS bank_fields_check;
    ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS momo_fields_check;
    
    -- Add new constraints - bank fields only required for bank accounts
    ALTER TABLE paystack_subaccounts ADD CONSTRAINT bank_fields_check CHECK (
        (account_type = 'bank' AND account_number IS NOT NULL AND bank_code IS NOT NULL AND bank_name IS NOT NULL) 
        OR (account_type != 'bank')
    );
    
    -- Mobile money fields only required for mobile money accounts
    ALTER TABLE paystack_subaccounts ADD CONSTRAINT momo_fields_check CHECK (
        (account_type = 'mobile_money' AND momo_number IS NOT NULL AND momo_provider IS NOT NULL AND account_holder_name IS NOT NULL)
        OR (account_type != 'mobile_money')
    );
    
    -- Ensure bank fields are NULL for mobile money accounts
    ALTER TABLE paystack_subaccounts ADD CONSTRAINT bank_fields_null_for_momo CHECK (
        (account_type = 'mobile_money' AND account_number IS NULL AND bank_code IS NULL AND bank_name IS NULL)
        OR (account_type != 'mobile_money')
    );
    
    -- Ensure mobile money fields are NULL for bank accounts
    ALTER TABLE paystack_subaccounts ADD CONSTRAINT momo_fields_null_for_bank CHECK (
        (account_type = 'bank' AND momo_number IS NULL AND momo_provider IS NULL AND account_holder_name IS NULL)
        OR (account_type != 'bank')
    );
END $$;

-- Create indexes for better performance (only if they don't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'paystack_subaccounts' AND indexname = 'idx_paystack_subaccounts_org_id') THEN
        CREATE INDEX idx_paystack_subaccounts_org_id ON paystack_subaccounts(organization_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'paystack_subaccounts' AND indexname = 'idx_paystack_subaccounts_account_type') THEN
        CREATE INDEX idx_paystack_subaccounts_account_type ON paystack_subaccounts(account_type);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'paystack_subaccounts' AND indexname = 'idx_paystack_subaccounts_is_primary') THEN
        CREATE INDEX idx_paystack_subaccounts_is_primary ON paystack_subaccounts(is_primary);
    END IF;
END $$;

-- Update existing records to have account_type = 'bank' if null or empty
UPDATE paystack_subaccounts 
SET account_type = 'bank' 
WHERE account_type IS NULL OR account_type = '';

-- Add comments
COMMENT ON TABLE paystack_subaccounts IS 'Stores Paystack subaccount information for both bank accounts and mobile money accounts';
COMMENT ON COLUMN paystack_subaccounts.account_type IS 'Type of account: bank or mobile_money';
COMMENT ON COLUMN paystack_subaccounts.subaccount_code IS 'Paystack subaccount code - only for bank accounts created via Paystack API';
COMMENT ON COLUMN paystack_subaccounts.momo_provider IS 'Mobile money provider: mtn, vodafone, or airtel_tigo';
COMMENT ON COLUMN paystack_subaccounts.momo_number IS 'Mobile money number for mobile_money account type';
COMMENT ON COLUMN paystack_subaccounts.account_holder_name IS 'Account holder name for mobile money accounts';

-- 2. Add indexes for performance
CREATE INDEX idx_paystack_subaccounts_org_id ON paystack_subaccounts (organization_id);
CREATE INDEX idx_paystack_subaccounts_primary ON paystack_subaccounts (organization_id, is_primary);

-- 3. Add unique constraint to ensure only one primary per organization
CREATE UNIQUE INDEX idx_paystack_subaccounts_unique_primary 
ON paystack_subaccounts (organization_id, is_primary) 
WHERE is_primary = true;

-- 4. Add Paystack fields to organizations table if not already present
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT,
ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT,
ADD COLUMN IF NOT EXISTS paystack_reference TEXT;

-- 5. Create public registration payments tracking table
CREATE TABLE IF NOT EXISTS public_registration_payments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(organization_id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  student_email TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'GHS',
  paystack_reference TEXT UNIQUE NOT NULL,
  subaccount_code TEXT REFERENCES paystack_subaccounts(subaccount_code),
  status VARCHAR(20) DEFAULT 'pending',
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 6. Add indexes for payment tracking
CREATE INDEX idx_public_payments_org_id ON public_registration_payments (organization_id);
CREATE INDEX idx_public_payments_reference ON public_registration_payments (paystack_reference);
CREATE INDEX idx_public_payments_status ON public_registration_payments (status);

-- 7. Optional: Migration data from Flutterwave to Paystack (for reference)
-- Note: This would need manual mapping as Paystack subaccounts need to be created via API
-- INSERT INTO paystack_subaccounts (organization_id, account_type, business_name, account_number, bank_code, is_primary)
-- SELECT organization_id, account_type, account_name, account_number, bank_or_provider, is_primary
-- FROM flutterwave_accounts;

COMMENT ON TABLE paystack_subaccounts IS 'Stores Paystack subaccount details for organizations to receive public registration payments';
COMMENT ON TABLE public_registration_payments IS 'Tracks all public registration payments made through Paystack';
