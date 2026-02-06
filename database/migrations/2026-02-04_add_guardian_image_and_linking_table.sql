-- Migration: Add image_url to pending_guardians and create pending_student_guardians linking table
-- Date: 2026-02-04
-- Description: Supports guardian image uploads in public registration and linking existing guardians to pending students

-- Add image_url column to pending_guardians table if it doesn't exist
ALTER TABLE pending_guardians 
ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT 'profilePlaceholder.png';

-- Create pending_student_guardians table for linking existing guardians to pending students
CREATE TABLE IF NOT EXISTS pending_student_guardians (
  id SERIAL PRIMARY KEY,
  pending_student_id INTEGER NOT NULL,
  guardian_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pending_student
    FOREIGN KEY (pending_student_id)
    REFERENCES pending_students(pending_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_guardian
    FOREIGN KEY (guardian_id)
    REFERENCES guardian_profiles(guardian_id)
    ON DELETE CASCADE,
  UNIQUE(pending_student_id, guardian_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_pending_student_guardians_pending_student 
ON pending_student_guardians(pending_student_id);

CREATE INDEX IF NOT EXISTS idx_pending_student_guardians_guardian 
ON pending_student_guardians(guardian_id);
