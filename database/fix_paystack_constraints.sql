-- Fix NOT NULL constraints on paystack_subaccounts table
-- Remove NOT NULL constraints from bank and mobile money fields to allow conditional usage

-- Remove NOT NULL constraints from bank fields (they should only be required for bank accounts)
ALTER TABLE paystack_subaccounts ALTER COLUMN account_number DROP NOT NULL;
ALTER TABLE paystack_subaccounts ALTER COLUMN bank_code DROP NOT NULL;
ALTER TABLE paystack_subaccounts ALTER COLUMN bank_name DROP NOT NULL;

-- Remove any NOT NULL constraints from mobile money fields (they should only be required for mobile money accounts)
ALTER TABLE paystack_subaccounts ALTER COLUMN momo_number DROP NOT NULL;
ALTER TABLE paystack_subaccounts ALTER COLUMN momo_provider DROP NOT NULL;
ALTER TABLE paystack_subaccounts ALTER COLUMN account_holder_name DROP NOT NULL;

-- Drop and recreate the check constraints to ensure proper field population
ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS bank_fields_check;
ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS momo_fields_check;
ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS bank_fields_null_for_momo;
ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS momo_fields_null_for_bank;

-- Add proper check constraints
ALTER TABLE paystack_subaccounts ADD CONSTRAINT bank_fields_check CHECK (
    (account_type = 'bank' AND account_number IS NOT NULL AND bank_code IS NOT NULL AND bank_name IS NOT NULL) 
    OR (account_type != 'bank')
);

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
