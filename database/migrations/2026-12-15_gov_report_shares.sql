-- Gov/state reports sent to people a school names (controllers/stateReportingController.js).
-- Someone outside the school gets a link that works for 7 days and a 6-digit code in a separate
-- email; only hashes of both are kept. Safe to run again.
CREATE TABLE IF NOT EXISTS state_report_shares (
  share_id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES state_report_files(file_id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  wrong_tries INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  last_downloaded_at TIMESTAMPTZ,
  sent_by VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_state_report_shares_file ON state_report_shares (organization_id, file_id);
