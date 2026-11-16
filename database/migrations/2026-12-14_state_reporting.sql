-- State reporting files (feature state_reporting, utils/stateFile.js). Safe to run again.

-- How a saved Report Builder report is written as the state's file: layout, field names,
-- widths, codes and the count dates it's made on.
ALTER TABLE custom_report_definitions ADD COLUMN IF NOT EXISTS state_file_json JSONB;

-- Each file made: kept locked (gzip, then AES-256-GCM with the server's settings key) for a
-- year, with who made it, its rows, what the check found, its fingerprint, who downloaded it
-- and when it was sent to the state. After a year the content is removed and the record stays.
CREATE TABLE IF NOT EXISTS state_report_files (
  file_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  report_id BIGINT REFERENCES custom_report_definitions(report_id) ON DELETE SET NULL,
  report_name VARCHAR(120) NOT NULL,
  file_name VARCHAR(120) NOT NULL,
  content_type VARCHAR(60) NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  problem_count INTEGER NOT NULL DEFAULT 0,
  problems JSONB NOT NULL DEFAULT '[]'::jsonb,
  sha256 CHAR(64) NOT NULL,
  content_locked TEXT,
  for_date DATE,
  made_by INTEGER,
  made_by_name VARCHAR(160),
  made_automatically BOOLEAN NOT NULL DEFAULT FALSE,
  made_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '365 days'),
  download_count INTEGER NOT NULL DEFAULT 0,
  last_downloaded_at TIMESTAMPTZ,
  last_downloaded_by VARCHAR(160),
  submitted_at TIMESTAMPTZ,
  submitted_by VARCHAR(160),
  submitted_reference VARCHAR(120)
);
CREATE INDEX IF NOT EXISTS idx_state_report_files_report ON state_report_files (organization_id, report_id, made_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_report_files_expiry ON state_report_files (expires_at) WHERE content_locked IS NOT NULL;

-- The count dates already made, so each is made once (the schedule itself is in state_file_json).
CREATE TABLE IF NOT EXISTS state_report_runs (
  report_id BIGINT NOT NULL REFERENCES custom_report_definitions(report_id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  run_on DATE NOT NULL,
  file_id BIGINT REFERENCES state_report_files(file_id) ON DELETE SET NULL,
  last_error TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (report_id, run_on)
);
