-- Days off on the attendance sheet (Settings › School rules, utils/attendanceCalendar.js): shown
-- greyed (the default, as before: "Last 3 days" is the last 3 calendar days) or hidden (then it's
-- the last 3 school days). Safe to run again.
ALTER TABLE organization_attendance_calendars ADD COLUMN IF NOT EXISTS show_days_off BOOLEAN NOT NULL DEFAULT TRUE;
