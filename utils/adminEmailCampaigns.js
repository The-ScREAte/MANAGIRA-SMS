const { escapeHtml, renderCleanEmail } = require("./emailHelper");

const ALLOWED_FREQUENCIES = new Set([
  "once",
  "every_1_minute",
  "every_3_minutes",
  "every_5_minutes",
  "every_10_minutes",
  "daily",
  "every_2_days",
  "weekly",
  "monthly",
]);
const INTERVAL_MINUTE_FREQUENCIES = new Map([
  ["every_1_minute", 1],
  ["every_3_minutes", 3],
  ["every_5_minutes", 5],
  ["every_10_minutes", 10],
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_SPLIT_PATTERN = /[\n,;]+/;
const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;

async function ensureAdminEmailCampaignSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_email_campaigns (
      id SERIAL PRIMARY KEY,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      manual_emails TEXT[] NOT NULL DEFAULT '{}',
      target_user_ids INTEGER[] NOT NULL DEFAULT '{}',
      frequency VARCHAR(20) NOT NULL DEFAULT 'once',
      send_time VARCHAR(5) NOT NULL DEFAULT '09:00',
      day_of_week SMALLINT,
      day_of_month SMALLINT,
      start_date DATE NOT NULL DEFAULT CURRENT_DATE,
      end_date DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_sent_at TIMESTAMP,
      next_run_at TIMESTAMP,
      last_error TEXT,
      created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT admin_email_campaigns_frequency_check
        CHECK (frequency IN ('once', 'every_1_minute', 'every_3_minutes', 'every_5_minutes', 'every_10_minutes', 'daily', 'every_2_days', 'weekly', 'monthly')),
      CONSTRAINT admin_email_campaigns_send_time_check
        CHECK (send_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
      CONSTRAINT admin_email_campaigns_day_of_week_check
        CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
      CONSTRAINT admin_email_campaigns_day_of_month_check
        CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_email_campaigns_active_next_run
      ON admin_email_campaigns (is_active, next_run_at)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_email_campaigns_created_by
      ON admin_email_campaigns (created_by)
  `);

  // Keep frequency constraint aligned for existing databases.
  await db.query(`
    ALTER TABLE admin_email_campaigns
    DROP CONSTRAINT IF EXISTS admin_email_campaigns_frequency_check
  `);
  await db.query(`
    ALTER TABLE admin_email_campaigns
    ADD CONSTRAINT admin_email_campaigns_frequency_check
      CHECK (frequency IN ('once', 'every_1_minute', 'every_3_minutes', 'every_5_minutes', 'every_10_minutes', 'daily', 'every_2_days', 'weekly', 'monthly'))
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_admin_email_campaigns_modtime'
      ) THEN
        CREATE TRIGGER update_admin_email_campaigns_modtime
          BEFORE UPDATE ON admin_email_campaigns
          FOR EACH ROW
          EXECUTE FUNCTION update_modified_column();
      END IF;
    END
    $$;
  `);
}

function parseEmailList(value) {
  if (Array.isArray(value)) {
    return uniqueLowercaseStrings(value);
  }

  if (typeof value !== "string") {
    return [];
  }

  return uniqueLowercaseStrings(value.split(EMAIL_SPLIT_PATTERN));
}

function uniqueLowercaseStrings(values) {
  const seen = new Set();
  const output = [];

  for (const item of values) {
    const normalized = String(item || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function normalizeUserIds(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(EMAIL_SPLIT_PATTERN)
      : [];

  const seen = new Set();
  const userIds = [];

  for (const item of rawValues) {
    const parsed = Number.parseInt(String(item || "").trim(), 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || seen.has(parsed)) {
      continue;
    }

    seen.add(parsed);
    userIds.push(parsed);
  }

  return userIds;
}

function normalizeFrequency(value) {
  const rawFrequency = String(value || "once").trim().toLowerCase();
  // Legacy compatibility: old interval schedules are now treated as 5-minute cadence.
  const frequency = rawFrequency === "every_3_minutes" ? "every_5_minutes" : rawFrequency;
  if (!ALLOWED_FREQUENCIES.has(rawFrequency) && rawFrequency !== "every_3_minutes") {
    throw new Error("Invalid frequency selected.");
  }
  return frequency;
}

function normalizeTime(value) {
  const sendTime = String(value || "09:00").trim();
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(sendTime)) {
    throw new Error("Send time must use the HH:MM format.");
  }
  return sendTime;
}

function normalizeDate(value, fieldName, fallbackValue) {
  const input = value ?? fallbackValue;
  let date = null;

  if (input instanceof Date) {
    date = new Date(input);
  } else if (input) {
    const raw = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      date = new Date(`${raw}T00:00:00`);
    } else {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
      }
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is invalid.`);
  }
  return formatDateOnly(date);
}

function normalizeOptionalDate(value, fieldName) {
  if (!value) {
    return null;
  }

  return normalizeDate(value, fieldName);
}

function normalizeDayOfWeek(value, frequency) {
  if (frequency !== "weekly") {
    return null;
  }

  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) {
    throw new Error("Weekly schedules require a valid weekday.");
  }

  return parsed;
}

function normalizeDayOfMonth(value, frequency) {
  if (frequency !== "monthly") {
    return null;
  }

  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    throw new Error("Monthly schedules require a valid day of month.");
  }

  return parsed;
}

function normalizeCampaignInput(payload = {}) {
  const subject = String(payload.subject || "").trim();
  const content = String(payload.content || "").trim();
  const frequency = normalizeFrequency(payload.frequency);
  const sendTime = normalizeTime(payload.sendTime);
  const startDate = normalizeDate(payload.startDate, "Start date", formatDateOnly(new Date()));
  const endDate = normalizeOptionalDate(payload.endDate, "End date");
  const manualEmails = parseEmailList(payload.manualEmails);
  const targetUserIds = normalizeUserIds(payload.targetUserIds);
  const dayOfWeek = normalizeDayOfWeek(payload.dayOfWeek, frequency);
  const dayOfMonth = normalizeDayOfMonth(payload.dayOfMonth, frequency);
  const isActive = payload.isActive === undefined ? true : Boolean(payload.isActive);

  if (!subject) {
    throw new Error("Email subject is required.");
  }

  if (!content) {
    throw new Error("Email content is required.");
  }

  if (manualEmails.length === 0 && targetUserIds.length === 0) {
    throw new Error("Add at least one recipient email or user.");
  }

  if (endDate && endDate < startDate) {
    throw new Error("End date cannot be before the start date.");
  }

  const nextRunAt = isActive
    ? computeNextRunAt(
        {
          frequency,
          sendTime,
          dayOfWeek,
          dayOfMonth,
          startDate,
          endDate,
        },
        new Date(),
        { allowImmediateCatchUp: true }
      )
    : null;

  return {
    subject,
    content,
    manualEmails,
    targetUserIds,
    frequency,
    sendTime,
    dayOfWeek,
    dayOfMonth,
    startDate,
    endDate,
    isActive,
    nextRunAt,
  };
}

function computeNextRunAt(schedule, fromDate = new Date(), options = {}) {
  const frequency = normalizeFrequency(schedule.frequency);
  const sendTime = normalizeTime(schedule.sendTime);
  const allowImmediateCatchUp = Boolean(options.allowImmediateCatchUp);
  const [hours, minutes] = sendTime.split(":").map((value) => Number.parseInt(value, 10));
  const startDate = new Date(`${normalizeDate(schedule.startDate, "Start date")}T00:00:00`);
  const endDate = schedule.endDate ? new Date(`${normalizeDate(schedule.endDate, "End date")}T23:59:59`) : null;

  if (INTERVAL_MINUTE_FREQUENCIES.has(frequency)) {
    const intervalMinutes = INTERVAL_MINUTE_FREQUENCIES.get(frequency);
    const candidate = computeNextIntervalBoundary(new Date(Math.max(startDate.getTime(), fromDate.getTime())), intervalMinutes);

    if (endDate && candidate > endDate) {
      return null;
    }

    return candidate;
  }

  if (frequency === "once") {
    const scheduledAt = new Date(startDate);
    scheduledAt.setHours(hours, minutes, 0, 0);

    if (endDate && scheduledAt > endDate) {
      return null;
    }

    return scheduledAt >= fromDate ? scheduledAt : new Date(fromDate);
  }

  if (allowImmediateCatchUp) {
    const scheduledToday = new Date(fromDate);
    scheduledToday.setHours(hours, minutes, 0, 0);

    if (
      scheduledToday >= startDate &&
      (!endDate || scheduledToday <= endDate) &&
      matchesScheduleDay(scheduledToday, frequency, schedule) &&
      scheduledToday < fromDate
    ) {
      const immediateRun = new Date(fromDate);
      immediateRun.setSeconds(0, 0);
      return immediateRun;
    }
  }

  const cursor = new Date(Math.max(startDate.getTime(), fromDate.getTime()));
  const candidate = new Date(cursor);
  candidate.setSeconds(0, 0);

  for (let offset = 0; offset <= 370; offset += 1) {
    const day = new Date(candidate);
    day.setDate(candidate.getDate() + offset);
    day.setHours(hours, minutes, 0, 0);

    if (day < startDate) {
      continue;
    }

    if (endDate && day > endDate) {
      return null;
    }

    if (!matchesScheduleDay(day, frequency, schedule)) {
      continue;
    }

    if (day >= fromDate) {
      return day;
    }
  }

  return null;
}

function computeNextRunAfterSend(schedule, sentAt = new Date()) {
  const frequency = String(schedule.frequency).toLowerCase();
  if (frequency === "once") {
    return null;
  }

  if (INTERVAL_MINUTE_FREQUENCIES.has(frequency)) {
    const intervalMinutes = INTERVAL_MINUTE_FREQUENCIES.get(frequency);
    const nextRunAt = computeNextIntervalBoundary(sentAt, intervalMinutes);
    const endDate = schedule.endDate ? new Date(`${normalizeDate(schedule.endDate, "End date")}T23:59:59`) : null;
    if (endDate && nextRunAt > endDate) {
      return null;
    }
    return nextRunAt;
  }

  const nextBase = new Date(sentAt);
  nextBase.setMinutes(nextBase.getMinutes() + 1);
  return computeNextRunAt(schedule, nextBase);
}

function matchesScheduleDay(day, frequency, schedule) {
  if (frequency === "daily" || frequency === "once") {
    return true;
  }

  if (frequency === "every_2_days") {
    const anchor = new Date(schedule.startDate);
    anchor.setHours(0, 0, 0, 0);
    const currentDay = new Date(day);
    currentDay.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((currentDay.getTime() - anchor.getTime()) / DAY_MS);
    return diffDays >= 0 && diffDays % 2 === 0;
  }

  if (frequency === "weekly") {
    return day.getDay() === Number(schedule.dayOfWeek);
  }

  if (frequency === "monthly") {
    const desiredDay = Number(schedule.dayOfMonth);
    const maxDay = daysInMonth(day.getFullYear(), day.getMonth());
    return day.getDate() === Math.min(desiredDay, maxDay);
  }

  return false;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function computeNextIntervalBoundary(date, intervalMinutes) {
  const candidate = new Date(date);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + intervalMinutes);

  return candidate;
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildCampaignEmailHtml(subject, content) {
  const safeSubject = escapeHtml(String(subject || "").trim());
  const paragraphs = String(content || "")
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => linkifyContent(section).replace(/\n/g, "<br>"));

  return renderCleanEmail({
    title: safeSubject,
    paragraphs: paragraphs.length > 0 ? paragraphs : [linkifyContent(String(content || ""))],
  });
}

function buildCampaignEmailText(content) {
  return String(content || "").trim();
}

function linkifyContent(content) {
  const escaped = escapeHtml(String(content || ""));
  return escaped.replace(URL_PATTERN, (url) => {
    const safeUrl = url.replace(/"/g, "%22");
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

module.exports = {
  ensureAdminEmailCampaignSchema,
  normalizeCampaignInput,
  computeNextRunAt,
  computeNextRunAfterSend,
  buildCampaignEmailHtml,
  buildCampaignEmailText,
  parseEmailList,
  normalizeUserIds,
};