-- Lets an Admin grant a Managira Worker visibility into Billing & Plan,
-- Security, and PayGira while they're viewing a granted school's dashboard.
-- Defaults to hidden — a worker only sees these once explicitly checked in
-- Manage Access.

ALTER TABLE user_feature_flags
  ADD COLUMN IF NOT EXISTS can_view_billing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_view_security BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_view_paygira BOOLEAN NOT NULL DEFAULT FALSE;
