-- The transcript design a school prints (utils/transcriptDesign.js): standard, classic, modern or
-- compact. Empty means Standard, the original design. Safe to run again.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS transcript_design TEXT;
