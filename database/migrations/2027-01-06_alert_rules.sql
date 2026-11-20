-- Alerts people set up for themselves (feature alert_rules, utils/alertRules.js): "tell me when a
-- score is below / above N%", a child marked absent, a rider not coming. A person's saved rows
-- are authoritative; a person who never saved has the defaults in code. Safe to repeat.
CREATE TABLE IF NOT EXISTS alert_rules (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  recipient_type  VARCHAR(10) NOT NULL CHECK (recipient_type IN ('guardian', 'student', 'staff')),
  recipient_id    INTEGER NOT NULL,
  kind            VARCHAR(40) NOT NULL,
  student_id      INTEGER NOT NULL DEFAULT 0,
  threshold       NUMERIC(6, 2) NULL,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  channels        TEXT[] NOT NULL DEFAULT '{bell}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- student_id 0 = all of a parent's children; a child's own rows replace those for that child.
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS student_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_organization_id_recipient_type_recipient_id_kind_key;
CREATE UNIQUE INDEX IF NOT EXISTS alert_rules_unique_idx ON alert_rules (organization_id, recipient_type, recipient_id, kind, student_id);
CREATE INDEX IF NOT EXISTS alert_rules_person_idx ON alert_rules (organization_id, recipient_type, recipient_id);

-- What each alert did: one row per person, kind and thing it was about (ref_key), so the same
-- score is never announced twice. A row waiting for the weekly digest has digest_pending set.
CREATE TABLE IF NOT EXISTS alert_events (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  recipient_type  VARCHAR(10) NOT NULL,
  recipient_id    INTEGER NOT NULL,
  recipient_email VARCHAR(255) NULL,
  kind            VARCHAR(40) NOT NULL,
  ref_key         VARCHAR(120) NOT NULL,
  student_id      INTEGER NULL,
  title           TEXT NOT NULL,
  body            TEXT NULL,
  link            TEXT NULL,
  digest_pending  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  digested_at     TIMESTAMPTZ NULL,
  UNIQUE (organization_id, recipient_type, recipient_id, kind, ref_key)
);
CREATE INDEX IF NOT EXISTS alert_events_digest_idx ON alert_events (organization_id, recipient_email) WHERE digest_pending;
