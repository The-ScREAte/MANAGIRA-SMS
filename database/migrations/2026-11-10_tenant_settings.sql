-- A school's sign-in rules (Settings, Tenant configuration). A school without a row uses the
-- defaults: signed out after 24 hours, Keep me logged in for 30 days, a verification code at
-- sign-in, and a remembered browser for 30 days. Safe to run more than once.
CREATE TABLE IF NOT EXISTS tenant_settings (
  organization_id INT PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
  session_hours INT NOT NULL DEFAULT 24 CHECK (session_hours BETWEEN 1 AND 720),
  keep_signed_in_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  keep_signed_in_days INT NOT NULL DEFAULT 30 CHECK (keep_signed_in_days BETWEEN 1 AND 90),
  login_code_required BOOLEAN NOT NULL DEFAULT TRUE,
  remember_device_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  remember_device_days INT NOT NULL DEFAULT 30 CHECK (remember_device_days BETWEEN 1 AND 90),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
