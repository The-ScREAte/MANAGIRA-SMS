-- Notification automation schema for attendance alerts and weekly digests

CREATE TABLE IF NOT EXISTS notification_policies (
  policy_id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  week_start_day SMALLINT NOT NULL DEFAULT 1,
  absence_threshold_weekly SMALLINT NOT NULL DEFAULT 3,
  digest_weekday SMALLINT NOT NULL DEFAULT 6,
  digest_send_hour SMALLINT NOT NULL DEFAULT 18,
  digest_send_minute SMALLINT NOT NULL DEFAULT 0,
  enable_parent_absence_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  enable_weekly_parent_digest BOOLEAN NOT NULL DEFAULT TRUE,
  enable_weekly_teacher_digest BOOLEAN NOT NULL DEFAULT TRUE,
  enable_weekly_manager_digest BOOLEAN NOT NULL DEFAULT TRUE,
  enable_weekly_hub_digest BOOLEAN NOT NULL DEFAULT TRUE,
  underperform_attendance_threshold NUMERIC(5,2) NOT NULL DEFAULT 70,
  underperform_score_threshold NUMERIC(5,2) NOT NULL DEFAULT 55,
  good_score_threshold NUMERIC(5,2) NOT NULL DEFAULT 60,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id)
);

CREATE TABLE IF NOT EXISTS notification_dispatches (
  dispatch_id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  event_key VARCHAR(200) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_kind VARCHAR(80),
  subject TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  error_message TEXT,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP,
  UNIQUE (event_type, event_key, recipient_email)
);

CREATE TABLE IF NOT EXISTS notification_digest_runs (
  run_id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  digest_type VARCHAR(80) NOT NULL,
  week_start_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, digest_type, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_org_event
  ON notification_dispatches (organization_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_status
  ON notification_dispatches (status, created_at DESC);
