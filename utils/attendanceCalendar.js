const Holidays = require("date-holidays");

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function toDateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
  }
  return false;
}

function normalizeWeekendDaysInput(rawWeekendDays) {
  // Handle PostgreSQL array string format like "{0,6}" that pg may return for SMALLINT[]
  if (typeof rawWeekendDays === 'string') {
    const trimmed = rawWeekendDays.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      rawWeekendDays = trimmed.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  const arrayValue = Array.isArray(rawWeekendDays)
    ? rawWeekendDays
    : rawWeekendDays === undefined || rawWeekendDays === null
    ? []
    : [rawWeekendDays];

  const normalized = arrayValue
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

  return [...new Set(normalized)].sort((a, b) => a - b);
}

async function ensureAttendanceCalendarSchema(db) {
  await db.query(`
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
  `);

  await db.query(`
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
  `);

  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_attendance_calendars_org_term ON organization_attendance_calendars (organization_id, term_id)`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_attendance_calendar_days_calendar_date ON organization_attendance_calendar_days (calendar_id, calendar_date)`
  );
}

function getHolidayCountryOptions() {
  const hd = new Holidays();
  const countries = hd.getCountries() || {};

  return Object.entries(countries)
    .map(([code, name]) => ({
      code,
      name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getTermRecord(db, organizationId, termId) {
  const result = await db.query(
    `
      SELECT t.term_id, t.term_name, t.start_date, t.end_date, t.school_year_id, sy.year_label
      FROM terms t
      JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.term_id = $1 AND t.organization_id = $2
      LIMIT 1
    `,
    [termId, organizationId]
  );

  return result.rows[0] || null;
}

async function getAttendanceCalendarProfile(db, organizationId, termId) {
  let result;

  if (termId) {
    result = await db.query(
      `
        SELECT calendar_id, organization_id, school_year_id, term_id, country_code,
               weekend_days, include_public_holidays, created_at, updated_at
        FROM organization_attendance_calendars
        WHERE organization_id = $1::int AND term_id = $2::int
        LIMIT 1
      `,
      [organizationId, termId]
    );

    // Org-wide fallback: if no term-specific row exists, use the latest rules for the organization.
    if (result.rows.length === 0) {
      result = await db.query(
        `
          SELECT calendar_id, organization_id, school_year_id, term_id, country_code,
                 weekend_days, include_public_holidays, created_at, updated_at
          FROM organization_attendance_calendars
          WHERE organization_id = $1::int
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `,
        [organizationId]
      );
    }
  } else {
    result = await db.query(
      `
        SELECT calendar_id, organization_id, school_year_id, term_id, country_code,
               weekend_days, include_public_holidays, created_at, updated_at
        FROM organization_attendance_calendars
        WHERE organization_id = $1::int
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [organizationId]
    );
  }

  if (result.rows.length === 0) return null;

  const profile = result.rows[0];
  const normalizedWeekendDays = normalizeWeekendDaysInput(profile.weekend_days || []);
  profile.weekend_days = normalizedWeekendDays.length > 0 ? normalizedWeekendDays : [0, 6];
  return profile;
}

async function getAttendanceCalendarDays(db, calendarId, startDate, endDate) {
  let result;

  if (startDate && endDate) {
    result = await db.query(
      `
        SELECT calendar_day_id, calendar_id, organization_id, calendar_date,
               label, source, counts_for_attendance, updated_at
        FROM organization_attendance_calendar_days
        WHERE calendar_id = $1
          AND calendar_date BETWEEN $2 AND $3
        ORDER BY calendar_date ASC
      `,
      [calendarId, startDate, endDate]
    );
  } else {
    result = await db.query(
      `
        SELECT calendar_day_id, calendar_id, organization_id, calendar_date,
               label, source, counts_for_attendance, updated_at
        FROM organization_attendance_calendar_days
        WHERE calendar_id = $1
        ORDER BY calendar_date ASC
      `,
      [calendarId]
    );
  }

  return result.rows.map((row) => ({
    ...row,
    calendar_date_key: toDateKey(row.calendar_date),
  }));
}

function buildCalendarDayMap(dayRows) {
  const map = new Map();

  (dayRows || []).forEach((row) => {
    const key = row.calendar_date_key || toDateKey(row.calendar_date);
    if (!key) return;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      return;
    }

    const sourcePriority = {
      manual: 2,
      public_holiday: 1,
    };

    const currentPriority = sourcePriority[String(existing.source || "").toLowerCase()] || 0;
    const nextPriority = sourcePriority[String(row.source || "").toLowerCase()] || 0;

    if (nextPriority >= currentPriority) {
      map.set(key, row);
    }
  });

  return map;
}

function isAttendanceCountableForDate(dateValue, calendarProfile, dayMap) {
  if (!calendarProfile) return true;

  const dateKey = toDateKey(dateValue);
  if (!dateKey) return true;

  const matchedDay = dayMap instanceof Map ? dayMap.get(dateKey) : null;
  if (matchedDay && String(matchedDay.source || "").toLowerCase() === "manual") {
    return Boolean(matchedDay.counts_for_attendance);
  }

  if (
    matchedDay &&
    String(matchedDay.source || "").toLowerCase() === "public_holiday" &&
    parseBoolean(calendarProfile.include_public_holidays)
  ) {
    return Boolean(matchedDay.counts_for_attendance);
  }

  const weekendDays = normalizeWeekendDaysInput(calendarProfile.weekend_days || []);
  const dayOfWeek = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();

  if (weekendDays.includes(dayOfWeek)) {
    return false;
  }

  return true;
}

async function upsertAttendanceCalendarProfile(db, {
  organizationId,
  schoolYearId,
  termId,
  countryCode,
  weekendDays,
  includePublicHolidays,
  userId,
}) {
  const normalizedWeekendDays = normalizeWeekendDaysInput(weekendDays);
  const safeWeekendDays = normalizedWeekendDays.length > 0 ? normalizedWeekendDays : [0, 6];

  // Organization-bound behavior: update the latest row for this organization regardless of term,
  // and only insert a new row when none exists yet.
  const existingProfile = await db.query(
    `
      SELECT calendar_id
      FROM organization_attendance_calendars
      WHERE organization_id = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
    [organizationId]
  );

  if (existingProfile.rows.length > 0) {
    const result = await db.query(
      `
        UPDATE organization_attendance_calendars
        SET country_code = $2,
            weekend_days = $3::smallint[],
            include_public_holidays = $4,
            updated_by = $5,
            updated_at = NOW()
        WHERE calendar_id = $1
        RETURNING *
      `,
      [
        existingProfile.rows[0].calendar_id,
        countryCode,
        safeWeekendDays,
        includePublicHolidays,
        userId || null,
      ]
    );

    const profile = result.rows[0];
    profile.weekend_days = normalizeWeekendDaysInput(profile.weekend_days || []);
    return profile;
  }

  const result = await db.query(
    `
      INSERT INTO organization_attendance_calendars
      (
        organization_id,
        school_year_id,
        term_id,
        country_code,
        weekend_days,
        include_public_holidays,
        created_by,
        updated_by,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::smallint[], $6, $7, $7, NOW())
      ON CONFLICT (organization_id, term_id)
      DO UPDATE SET
        school_year_id = EXCLUDED.school_year_id,
        country_code = EXCLUDED.country_code,
        weekend_days = EXCLUDED.weekend_days,
        include_public_holidays = EXCLUDED.include_public_holidays,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING *
    `,
    [
      organizationId,
      schoolYearId,
      termId,
      countryCode,
      safeWeekendDays,
      includePublicHolidays,
      userId || null,
    ]
  );

  const profile = result.rows[0];
  profile.weekend_days = normalizeWeekendDaysInput(profile.weekend_days || []);
  return profile;
}

async function syncPublicHolidayDays(db, {
  calendarId,
  organizationId,
  countryCode,
  startDate,
  endDate,
  userId,
}) {
  await db.query(
    `
      DELETE FROM organization_attendance_calendar_days
      WHERE calendar_id = $1 AND source = 'public_holiday'
    `,
    [calendarId]
  );

  if (!countryCode) {
    return { inserted: 0 };
  }

  const hd = new Holidays(countryCode);
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { inserted: 0 };
  }

  const years = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    years.push(year);
  }

  let inserted = 0;
  for (const year of years) {
    const holidays = hd.getHolidays(year) || [];
    for (const holiday of holidays) {
      if (String(holiday.type || "").toLowerCase() !== "public") {
        continue;
      }

      const holidayDate = toDateKey(holiday.start || holiday.date);
      if (!holidayDate) continue;
      if (holidayDate < toDateKey(start) || holidayDate > toDateKey(end)) {
        continue;
      }

      await db.query(
        `
          INSERT INTO organization_attendance_calendar_days
          (
            calendar_id,
            organization_id,
            calendar_date,
            label,
            source,
            counts_for_attendance,
            created_by,
            updated_at
          )
          VALUES ($1, $2, $3, $4, 'public_holiday', false, $5, NOW())
          ON CONFLICT (calendar_id, calendar_date)
          DO UPDATE SET
            label = EXCLUDED.label,
            source = 'public_holiday',
            counts_for_attendance = false,
            updated_at = NOW()
        `,
        [calendarId, organizationId, holidayDate, holiday.name || "Public Holiday", userId || null]
      );
      inserted += 1;
    }
  }

  return { inserted };
}

async function upsertManualCalendarDay(db, {
  calendarId,
  organizationId,
  calendarDate,
  label,
  countsForAttendance,
  userId,
}) {
  const result = await db.query(
    `
      INSERT INTO organization_attendance_calendar_days
      (
        calendar_id,
        organization_id,
        calendar_date,
        label,
        source,
        counts_for_attendance,
        created_by,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'manual', $5, $6, NOW())
      ON CONFLICT (calendar_id, calendar_date)
      DO UPDATE SET
        label = EXCLUDED.label,
        source = 'manual',
        counts_for_attendance = EXCLUDED.counts_for_attendance,
        updated_at = NOW()
      RETURNING *
    `,
    [calendarId, organizationId, calendarDate, label || null, countsForAttendance, userId || null]
  );

  return result.rows[0] || null;
}

async function deleteManualCalendarDay(db, { calendarDayId, organizationId }) {
  const result = await db.query(
    `
      DELETE FROM organization_attendance_calendar_days
      WHERE calendar_day_id = $1
        AND organization_id = $2
        AND source = 'manual'
    `,
    [calendarDayId, organizationId]
  );

  return result.rowCount > 0;
}

module.exports = {
  WEEKDAY_OPTIONS,
  toDateKey,
  parseBoolean,
  normalizeWeekendDaysInput,
  ensureAttendanceCalendarSchema,
  getHolidayCountryOptions,
  getTermRecord,
  getAttendanceCalendarProfile,
  getAttendanceCalendarDays,
  buildCalendarDayMap,
  isAttendanceCountableForDate,
  upsertAttendanceCalendarProfile,
  syncPublicHolidayDays,
  upsertManualCalendarDay,
  deleteManualCalendarDay,
};