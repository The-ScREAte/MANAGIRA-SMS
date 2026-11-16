-- The weekly briefing (utils/weeklyBriefing.js, feature weekly_briefing): what a school sends to
-- families and students each week, and when. class_id 0 is the whole school (with its day, time
-- and time zone); a class's own row replaces the school's choices for that class.
CREATE TABLE IF NOT EXISTS weekly_briefing_settings (
  organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INTEGER,
  updated_by_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, class_id)
);
