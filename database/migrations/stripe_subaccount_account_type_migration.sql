-- Lets a school keep a Stripe card payout account: paystack_subaccounts.account_type also allows
-- 'stripe_card'. Only that check changes; the checks on bank and mobile money fields stay, and a
-- stripe_card row passes them (each applies only to its own account type). Safe to repeat.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'paystack_subaccounts'::regclass
       AND conname = 'paystack_subaccounts_account_type_check'
       AND pg_get_constraintdef(oid) LIKE '%stripe_card%'
  ) THEN
    ALTER TABLE paystack_subaccounts DROP CONSTRAINT IF EXISTS paystack_subaccounts_account_type_check;
    ALTER TABLE paystack_subaccounts
      ADD CONSTRAINT paystack_subaccounts_account_type_check
      CHECK (account_type IN ('bank', 'mobile_money', 'stripe_card'));
  END IF;
END $$;
