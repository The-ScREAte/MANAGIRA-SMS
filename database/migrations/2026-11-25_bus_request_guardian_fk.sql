-- A parent's bus request stores the parent's profile id (guardian_profiles), but its guardian_id
-- pointed at the older per-student guardians table, so every request from a parent failed.
-- Point it at the profiles. NOT VALID: rows saved earlier are left as they are.
ALTER TABLE transport_student_requests DROP CONSTRAINT IF EXISTS transport_student_requests_guardian_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_student_requests_guardian_profile_fkey') THEN
    ALTER TABLE transport_student_requests
      ADD CONSTRAINT transport_student_requests_guardian_profile_fkey
      FOREIGN KEY (guardian_id) REFERENCES guardian_profiles(guardian_id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
