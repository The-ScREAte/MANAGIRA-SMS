-- Migration: add 'stripe_card' as a valid account_type in paystack_subaccounts
-- Run this once against your database before deploying the Stripe card subaccount feature.

DO $$
BEGIN
    -- Drop old account_type check constraint
    ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS paystack_subaccounts_account_type_check;

    -- Drop field-nullability constraints that would block stripe_card rows
    ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS bank_fields_null_for_momo;
    ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS momo_fields_null_for_bank;
    ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS bank_fields_check;
    ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS momo_fields_check;

    -- New account_type constraint that includes stripe_card
    ALTER TABLE paystack_subaccounts
        ADD CONSTRAINT paystack_subaccounts_account_type_check
        CHECK (account_type IN ('bank', 'mobile_money', 'stripe_card'));

    -- Restore bank-fields check (still enforced for bank rows)
    ALTER TABLE paystack_subaccounts
        ADD CONSTRAINT bank_fields_check CHECK (
            (account_type = 'bank' AND account_number IS NOT NULL AND bank_code IS NOT NULL AND bank_name IS NOT NULL)
            OR account_type <> 'bank'
        );

    -- Restore momo-fields check (still enforced for mobile_money rows)
    ALTER TABLE paystack_subaccounts
        ADD CONSTRAINT momo_fields_check CHECK (
            (account_type = 'mobile_money' AND momo_number IS NOT NULL AND momo_provider IS NOT NULL AND account_holder_name IS NOT NULL)
            OR account_type <> 'mobile_money'
        );
END $$;
