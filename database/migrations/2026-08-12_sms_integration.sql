-- SMS integration: per-tenant provider settings (Arkesel, Africa's Talking, Twilio).
-- Applied automatically at runtime via utils/smsIntegration.js#ensureSmsIntegrationSchema;
-- this file documents the schema for reference/manual application.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS sms_active_provider TEXT,

  ADD COLUMN IF NOT EXISTS sms_arkesel_activated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_arkesel_configured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_arkesel_sender_id TEXT,
  ADD COLUMN IF NOT EXISTS sms_arkesel_api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS sms_arkesel_last_status TEXT,
  ADD COLUMN IF NOT EXISTS sms_arkesel_last_error TEXT,
  ADD COLUMN IF NOT EXISTS sms_arkesel_last_tested_at TIMESTAMPTZ,

  ADD COLUMN IF NOT EXISTS sms_africastalking_activated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_africastalking_configured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_africastalking_username TEXT,
  ADD COLUMN IF NOT EXISTS sms_africastalking_sender_id TEXT,
  ADD COLUMN IF NOT EXISTS sms_africastalking_api_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS sms_africastalking_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_africastalking_last_status TEXT,
  ADD COLUMN IF NOT EXISTS sms_africastalking_last_error TEXT,
  ADD COLUMN IF NOT EXISTS sms_africastalking_last_tested_at TIMESTAMPTZ,

  ADD COLUMN IF NOT EXISTS sms_twilio_activated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_twilio_configured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_twilio_account_sid TEXT,
  ADD COLUMN IF NOT EXISTS sms_twilio_from_number TEXT,
  ADD COLUMN IF NOT EXISTS sms_twilio_auth_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS sms_twilio_last_status TEXT,
  ADD COLUMN IF NOT EXISTS sms_twilio_last_error TEXT,
  ADD COLUMN IF NOT EXISTS sms_twilio_last_tested_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sms_delivery_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  recipient TEXT,
  status TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_org
  ON sms_delivery_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_delivery_logs_message_id
  ON sms_delivery_logs (provider, provider_message_id);
