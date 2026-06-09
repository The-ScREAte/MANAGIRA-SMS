-- Migration: add payout_provider_pref to organizations
-- Date: 2026-06-09
--
-- Purpose: let each school pick whether parent payments go to their Stripe
-- Connect account, Paystack subaccount, or both. NULL = legacy auto-detect.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS payout_provider_pref VARCHAR(16);

-- Optional check; left commented so existing rows with weird values are not rejected.
-- ALTER TABLE organizations
--   ADD CONSTRAINT organizations_payout_provider_pref_check
--   CHECK (payout_provider_pref IS NULL OR payout_provider_pref IN ('stripe','paystack','both'));
