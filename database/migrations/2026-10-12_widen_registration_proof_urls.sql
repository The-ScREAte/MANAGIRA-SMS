-- Proof document links include the uploaded file name, so a long file name
-- could exceed VARCHAR(255) and fail sign-up after the card was saved.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE organizations
  ALTER COLUMN proof_of_existence_1 TYPE TEXT,
  ALTER COLUMN proof_of_existence_2 TYPE TEXT;
COMMIT;
