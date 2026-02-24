CREATE TABLE IF NOT EXISTS organization_attendance_calendars (
  calendar_id SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  school_year_id INT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  term_id INT NOT NULL REFERENCES terms(term_id) ON DELETE CASCADE,
  country_code VARCHAR(4) NOT NULL DEFAULT 'GH',
  weekend_days SMALLINT[] NOT NULL DEFAULT ARRAY[0,6]::SMALLINT[],
  include_public_holidays BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, term_id)
);

CREATE TABLE IF NOT EXISTS organization_attendance_calendar_days (
  calendar_day_id SERIAL PRIMARY KEY,
  calendar_id INT NOT NULL REFERENCES organization_attendance_calendars(calendar_id) ON DELETE CASCADE,
  organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  calendar_date DATE NOT NULL,
  label TEXT,
  source VARCHAR(30) NOT NULL DEFAULT 'manual',
  counts_for_attendance BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (calendar_id, calendar_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_calendars_org_term
  ON organization_attendance_calendars (organization_id, term_id);

CREATE INDEX IF NOT EXISTS idx_attendance_calendar_days_calendar_date
  ON organization_attendance_calendar_days (calendar_id, calendar_date);