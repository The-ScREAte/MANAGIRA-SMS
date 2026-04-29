-- ============================================================
--  Managira In-App Notification System
--  Run once. All statements are idempotent (IF NOT EXISTS).
-- ============================================================

-- ── Main notifications table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id               SERIAL PRIMARY KEY,
  organization_id  INTEGER      NOT NULL,
  recipient_type   VARCHAR(20)  NOT NULL
                     CHECK (recipient_type IN ('staff', 'guardian', 'broadcast')),
  -- For 'staff'    : user_id from users table
  -- For 'guardian' : guardian_id from guardian_profiles table
  -- For 'broadcast': 0  (visible to all staff in the org)
  recipient_id     INTEGER      NOT NULL DEFAULT 0,
  type             VARCHAR(60)  NOT NULL,
  title            VARCHAR(255) NOT NULL,
  body             TEXT,
  link             VARCHAR(500),
  ref_id           INTEGER,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_org_recip
  ON notifications (organization_id, recipient_type, recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notif_broadcast
  ON notifications (organization_id, recipient_type, created_at DESC)
  WHERE recipient_type = 'broadcast';

-- ── Read-receipts table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_reads (
  id               SERIAL PRIMARY KEY,
  notification_id  INTEGER   NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  -- user_id for staff, guardian_id for guardian
  reader_id        INTEGER   NOT NULL,
  read_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (notification_id, reader_id)
);

CREATE INDEX IF NOT EXISTS idx_notif_reads_reader
  ON notification_reads (reader_id, notification_id);
