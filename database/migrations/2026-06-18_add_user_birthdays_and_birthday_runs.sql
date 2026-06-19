ALTER TABLE users
ADD COLUMN IF NOT EXISTS date_of_birth DATE;

ALTER TABLE guardians
ADD COLUMN IF NOT EXISTS date_of_birth DATE;

ALTER TABLE guardian_profiles
ADD COLUMN IF NOT EXISTS date_of_birth DATE;
