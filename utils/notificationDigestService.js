const db = require("../config/db");
const {
  sendEmailSafely,
  sendEmailInBackground,
  renderCleanEmail,
  escapeHtml,
} = require("./emailHelper");

const APP_URL = String(process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/$/, "");
const LOGIN_URL = `${APP_URL}/account/login`;

// Staff open a parent conversation through one link: Mail Room users land in
// its inbox, teachers in the class's Parent Messages (see /common/parent-messages/:id).
const parentMessageUrl = (reportId) => `${APP_URL}/common/parent-messages/${Number(reportId)}`;
const {
  isUserEmailEnabled,
  isGuardianEmailEnabled,
  isHubEmailEnabled,
  isEmailEnabledForRecipient,
  filterEmailsByPreference,
} = require("./emailPreferences");
const { getOrganizationWebsiteInfo } = require("./schoolWebsiteAccess");
const { activeStudentSql } = require("./activeStudents");

const DEFAULT_POLICY = {
  timezone: "UTC",
  week_start_day: 1,
  absence_threshold_weekly: 3,
  digest_weekday: 6,
  digest_send_hour: 18,
  digest_send_minute: 0,
  enable_parent_absence_alerts: true,
  enable_weekly_parent_digest: true,
  enable_weekly_teacher_digest: true,
  enable_weekly_manager_digest: true,
  enable_weekly_hub_digest: true,
  underperform_attendance_threshold: 70,
  underperform_score_threshold: 55,
  good_score_threshold: 60,
};

const GLOBAL_DIGEST_WEEKDAY = 6; // Saturday

let ensuredSchema = false;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// A figure the database may not have (an average with nothing graded is NULL): NaN when
// missing, never 0, so an email never shows "0.0%" for "nothing yet".
const figureOrNaN = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));

function normalizeWeekday(value, fallback = GLOBAL_DIGEST_WEEKDAY) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) {
    return fallback;
  }
  return parsed;
}

function buildFailureNotification(organizationId, {
  title = "Email delivery failed",
  body = "A school email could not be delivered.",
  link = null,
  dedupeHours = 12,
} = {}) {
  const orgId = Number.parseInt(organizationId, 10);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    return null;
  }

  return {
    orgId,
    recipientType: 'broadcast',
    recipientId: 0,
    title,
    body,
    link,
    dedupeHours,
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  // Basic RFC-ish check: something@domain.tld, domain has at least one dot, tld >= 2 chars
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e);
}

function uniqueEmails(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const normalized = normalizeEmail(item);
    if (!normalized || !isValidEmail(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function nowInTimeZone(date, timeZone) {
  try {
    return new Date(date.toLocaleString("en-US", { timeZone }));
  } catch (_err) {
    return new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  }
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeek(dateInZone, weekStartDay) {
  const out = new Date(dateInZone);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay();
  const offset = (day - weekStartDay + 7) % 7;
  out.setDate(out.getDate() - offset);
  return out;
}

function endOfWeek(start) {
  const out = new Date(start);
  out.setDate(out.getDate() + 6);
  out.setHours(23, 59, 59, 999);
  return out;
}

function scoreBand(score, goodThreshold) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "No scored assessments yet";
  if (s >= Math.max(85, goodThreshold + 20)) return "Excellent";
  if (s >= Math.max(70, goodThreshold + 10)) return "Good";
  if (s >= goodThreshold) return "Fair";
  if (s >= Math.max(45, goodThreshold - 15)) return "Needs Attention";
  return "Critical";
}

// ── Email wording ────────────────────────────────────────────────────────────────────────
// A subject line: plain text on one line (never HTML), cut at a word near `max` characters.
function subjectLine(text, max = 70) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

// "Hi Maria," when a first name is known, "Hello," otherwise. Names are typed by people: escaped.
function greetingFor(firstName) {
  const name = String(firstName || "").trim();
  return name ? `Hi ${escapeHtml(name)},` : "Hello,";
}

const plural = (count, word, words = `${word}s`) => `${Number(count).toLocaleString("en-US")} ${Number(count) === 1 ? word : words}`;

// "2026-11-16" as "November 16, 2026" (US style); `weekday` adds "Monday, ". Anything that isn't
// a date is returned as it was.
function formatDay(value, { weekday = false, year = true } = {}) {
  const key = value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return String(value || "").trim();
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    ...(weekday ? { weekday: "long" } : {}),
    month: "long",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

// "the week of November 9", for the weekly emails.
const weekOf = (weekStartKey) => `the week of ${formatDay(weekStartKey, { year: false })}`;

// Text someone typed (an event's details, an announcement) as escaped paragraphs, line breaks kept.
function textParagraphs(text) {
  return String(text || "")
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => escapeHtml(part).replace(/\r?\n/g, "<br>"));
}

// A message someone wrote, quoted in the email (escaped, line breaks kept).
function quoteHtml(text) {
  const body = escapeHtml(String(text || "").trim()).replace(/\r?\n/g, "<br>");
  return body
    ? `<blockquote style="margin:0;padding:2px 0 2px 14px;border-left:3px solid #cbd5e1;">${body}</blockquote>`
    : "";
}

// One child, class or school in the weekly emails: a small box that reads well on a phone, in
// light or dark mode. `heading`, `aside` and `lines` are HTML (escape what people typed).
function cardHtml(heading, aside, lines) {
  const head = `<p class="t-strong" style="margin:0 0 6px;font-size:15px;line-height:1.4;font-weight:600;color:#0f172a;">${heading}${aside ? ` <span class="t-muted" style="font-weight:400;color:#64748b;">&middot; ${aside}</span>` : ""}</p>`;
  const body = lines
    .filter(Boolean)
    .map((line) => (/^\s*<ul\b/i.test(line) ? line : `<p style="margin:0;font-size:14px;line-height:1.6;">${line}</p>`))
    .join("");
  return `<div class="bg-soft" style="margin:0 0 12px;padding:14px 16px;background:#f8fafc;border:1px solid #eef2f6;border-radius:10px;">${head}${body}</div>`;
}

const listHtml = (items) => `<ul style="margin:4px 0 0;padding-left:18px;font-size:14px;line-height:1.6;">${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;

// A child's attendance this week: "present all 5 days" or "present 3 of 5 days, absent 2".
// Attendance is taken once a day, so each mark is a day.
function attendanceInWords({ marksCount, presentCount, absentCount, lateCount }) {
  const parts = [presentCount === marksCount && marksCount > 1
    ? `present all ${plural(marksCount, "day")}`
    : `present ${presentCount} of ${plural(marksCount, "day")}`];
  if (absentCount > 0) parts.push(`absent ${absentCount}`);
  if (lateCount > 0) parts.push(`late ${lateCount}`);
  return parts.join(", ");
}

// How a child's grades are going this term, from the school's own thresholds. Families get a
// word, never a score, by email. Null until something has been graded and posted.
function gradesInWords(avgScore, goodThreshold) {
  if (!Number.isFinite(Number(avgScore))) return null;
  const band = scoreBand(avgScore, goodThreshold);
  return { Excellent: "excellent", Good: "good", Fair: "fair" }[band] || "needs some support";
}

async function ensureNotificationSchema(database = db) {
  if (ensuredSchema) return;

  await database.query(`
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
    )
  `);

  await database.query(`
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
      sent_at TIMESTAMP
    )
  `);

  await database.query(`
    ALTER TABLE notification_dispatches
    DROP CONSTRAINT IF EXISTS notification_dispatches_event_type_event_key_recipient_email_key
  `);

  await database.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dispatches_org_event_key_recipient ON notification_dispatches (organization_id, event_type, event_key, recipient_email)"
  );

  await database.query(`
    CREATE TABLE IF NOT EXISTS notification_digest_runs (
      run_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      digest_type VARCHAR(80) NOT NULL,
      week_start_date DATE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, digest_type, week_start_date)
    )
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS notification_quiet_streaks (
      streak_id SERIAL PRIMARY KEY,
      organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      digest_type VARCHAR(80) NOT NULL,
      recipient_email VARCHAR(255) NOT NULL,
      quiet_weeks SMALLINT NOT NULL DEFAULT 0,
      last_week_start_date DATE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, digest_type, recipient_email)
    )
  `);

  await database.query(
    "CREATE INDEX IF NOT EXISTS idx_notification_dispatches_org_event ON notification_dispatches (organization_id, event_type, created_at DESC)"
  );

  await database.query(
    "CREATE INDEX IF NOT EXISTS idx_notification_dispatches_status ON notification_dispatches (status, created_at DESC)"
  );

  ensuredSchema = true;
}

async function getPolicy(database, organizationId) {
  const result = await database.query(
    "SELECT * FROM notification_policies WHERE organization_id = $1 LIMIT 1",
    [organizationId]
  );

  if (!result.rows.length) {
    await database.query(
      `INSERT INTO notification_policies (organization_id) VALUES ($1)
       ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId]
    );

    return { ...DEFAULT_POLICY, organization_id: organizationId };
  }

  return { ...DEFAULT_POLICY, ...result.rows[0] };
}

async function getOrganizationSummary(database, organizationId) {
  const result = await database.query(
    `SELECT organization_name FROM organizations WHERE organization_id = $1 LIMIT 1`,
    [organizationId]
  );

  return {
    organizationName: result.rows[0]?.organization_name || "School",
  };
}

async function reserveDispatch(database, {
  organizationId,
  eventType,
  eventKey,
  recipientEmail,
  recipientKind,
  subject,
  payload,
}) {
  const result = await database.query(
    `INSERT INTO notification_dispatches
       (organization_id, event_type, event_key, recipient_email, recipient_kind, subject, payload, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'queued')
     ON CONFLICT (organization_id, event_type, event_key, recipient_email) DO NOTHING
     RETURNING dispatch_id`,
    [
      organizationId,
      eventType,
      eventKey,
      normalizeEmail(recipientEmail),
      recipientKind || null,
      subject || null,
      JSON.stringify(payload || {}),
    ]
  );

  return result.rows[0]?.dispatch_id || null;
}

async function markDispatchSent(database, dispatchId) {
  if (!dispatchId) return;
  await database.query(
    `UPDATE notification_dispatches
     SET status = 'sent', sent_at = NOW(), error_message = NULL
     WHERE dispatch_id = $1`,
    [dispatchId]
  );
}

async function markDispatchFailed(database, dispatchId, errorMessage) {
  if (!dispatchId) return;
  await database.query(
    `UPDATE notification_dispatches
     SET status = 'failed', error_message = $2
     WHERE dispatch_id = $1`,
    [dispatchId, String(errorMessage || "Unknown error")]
  );
}

async function sendLoggedEmail(database, params) {
  const {
    organizationId,
    eventType,
    eventKey,
    recipientEmail,
    recipientKind,
    subject,
    html,
    payload,
    context,
    background,
    category,
    onBehalfOf,
    // The caller already filtered its list by preference (filterEmailsByPreference).
    optOutChecked,
  } = params;

  const dispatchId = await reserveDispatch(database, {
    organizationId,
    eventType,
    eventKey,
    recipientEmail,
    recipientKind,
    subject,
    payload,
  });

  if (!dispatchId) return false;

  // A hub's own address failing is nothing a member school's staff can fix: no bell for them.
  const failureNotification = recipientKind === "hub" ? null : buildFailureNotification(organizationId, {
    title: 'Email delivery failed',
    body: `An email for ${recipientKind || 'a recipient'} could not be delivered to ${recipientEmail}.`,
  });

  // Weekly digests and the daily absence alert are reminders; a reply to a parent's message isn't.
  // `category` is the kind of optional email (one-click unsubscribe); `onBehalfOf` the school it
  // speaks for.
  const sender = /digest|absence|reminder/.test(String(eventType || "")) ? "reminders" : undefined;
  const sendOptions = {
    to: recipientEmail,
    subject,
    html,
    failureNotification,
    ...(sender ? { sender } : {}),
    ...(category ? { category } : {}),
    ...(category && optOutChecked ? { optOutChecked: true } : {}),
    ...(onBehalfOf ? { onBehalfOf } : {}),
  };

  if (background) {
    sendEmailSafely(sendOptions, context || eventType)
      .then((sent) => sent
        ? markDispatchSent(database, dispatchId)
        : markDispatchFailed(database, dispatchId, 'SMTP send failed'))
      .catch((error) => markDispatchFailed(database, dispatchId, error?.message || 'SMTP send failed'));
    return true;
  }

  const sent = await sendEmailSafely(sendOptions, context || eventType);
  if (sent) {
    await markDispatchSent(database, dispatchId);
  } else {
    await markDispatchFailed(database, dispatchId, "SMTP send failed");
  }
  return sent;
}

async function getCurrentTermId(database, organizationId) {
  const result = await database.query(
    `SELECT term_id FROM terms WHERE organization_id = $1 AND current = TRUE LIMIT 1`,
    [organizationId]
  );
  return result.rows[0]?.term_id || null;
}

async function getStudentTermAverages(database, organizationId, termId, studentIds) {
  if (!termId || !studentIds.length) return new Map();
  // Families only hear about approved grades (the assessments flow): a subject with a grade
  // waiting for the teacher is left out until it's posted.
  const onlyPosted = require("./assessmentApproval").flowOn(organizationId)
    ? `AND NOT EXISTS (SELECT 1 FROM assessment_results w WHERE w.student_id = ar.student_id AND w.subject_id = ar.subject_id
                         AND w.term_id = ar.term_id AND w.pending_since IS NOT NULL)`
    : "";
  const result = await database.query(
    `SELECT ar.student_id,
            ROUND(AVG(ar.total_percentage)::numeric, 1) AS avg_score
     FROM assessment_results ar
     JOIN assessments a ON a.assessment_id = ar.assessment_id
     WHERE ar.organization_id = $1
       AND a.term_id = $2
       AND ar.student_id = ANY($3::int[])
       AND ar.total_percentage IS NOT NULL
       ${onlyPosted}
     GROUP BY ar.student_id`,
    [organizationId, termId, studentIds]
  );

  const out = new Map();
  for (const row of result.rows) {
    out.set(Number(row.student_id), Number(row.avg_score));
  }
  return out;
}

async function getStudentAttendanceWeekly(database, organizationId, weekStartKey, weekEndKey, studentIds) {
  if (!studentIds.length) return new Map();
  const result = await database.query(
    `SELECT ar.student_id,
            COUNT(*) AS marks_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(ar.status::text, '')) = 'absent') AS absent_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(ar.status::text, '')) = 'present') AS present_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(ar.status::text, '')) = 'late') AS late_count,
            ROUND(
              100.0 * COUNT(*) FILTER (WHERE LOWER(COALESCE(ar.status::text, '')) = 'present')
              / NULLIF(COUNT(*), 0),
              1
            ) AS attendance_pct
     FROM attendance_records ar
     WHERE ar.organization_id = $1
       AND ar.date BETWEEN $2::date AND $3::date
       AND ar.student_id = ANY($4::int[])
     GROUP BY ar.student_id`,
    [organizationId, weekStartKey, weekEndKey, studentIds]
  );

  const out = new Map();
  for (const row of result.rows) {
    out.set(Number(row.student_id), {
      marksCount: toNumber(row.marks_count, 0),
      absentCount: toNumber(row.absent_count, 0),
      presentCount: toNumber(row.present_count, 0),
      lateCount: toNumber(row.late_count, 0),
      attendancePct: Number(row.attendance_pct),
    });
  }
  return out;
}



async function getWeeklySchoolSignals(database, organizationId, weekStartKey, weekEndKey) {
  try {
    const result = await database.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE action_type = 'Scored'
              OR module_name = 'Assessment'
              OR page_path ILIKE '/common/saveallscores%'
              OR page_path ILIKE '/common/savescore%'
         ) AS assessment_updates,
         COUNT(*) FILTER (
           WHERE module_name IN ('Messaging', 'Announcements')
              OR action_type = 'Messaged'
         ) AS communication_updates
       FROM organization_activity_logs
       WHERE organization_id = $1
         AND created_at >= $2::date
         AND created_at < ($3::date + INTERVAL '1 day')`,
      [organizationId, weekStartKey, weekEndKey]
    );

    const row = result.rows[0] || {};
    return {
      assessmentUpdates: toNumber(row.assessment_updates, 0),
      communicationUpdates: toNumber(row.communication_updates, 0),
    };
  } catch (error) {
    // organization_activity_logs is optional in some environments.
    if (error && error.code === "42P01") {
      return { assessmentUpdates: 0, communicationUpdates: 0 };
    }
    throw error;
  }
}

async function resolveGuardianLinks(database, organizationId) {
  const result = await database.query(
    `SELECT DISTINCT
        LOWER(TRIM(src.email)) AS email,
        src.first_name,
        src.last_name,
        src.student_id
     FROM (
       SELECT gp.email, gp.first_name, gp.last_name, gs.student_id
       FROM guardian_profiles gp
       JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
       WHERE gp.organization_id = $1
         AND gp.email IS NOT NULL
         AND TRIM(gp.email) <> ''

       UNION ALL

       SELECT g.email, g.first_name, g.last_name, g.student_id
       FROM guardians g
       WHERE g.organization_id = $1
         AND g.email IS NOT NULL
         AND TRIM(g.email) <> ''
     ) src
     JOIN students s ON s.student_id = src.student_id AND s.organization_id = $1
     WHERE src.student_id IS NOT NULL
       AND ${activeStudentSql("s")}`,
    [organizationId]
  );

  const guardianMap = new Map();
  for (const row of result.rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    if (!guardianMap.has(email)) {
      guardianMap.set(email, {
        email,
        firstName: String(row.first_name || "").trim(),
        lastName: row.last_name || "",
        studentIds: new Set(),
      });
    }
    guardianMap.get(email).studentIds.add(Number(row.student_id));
  }

  return guardianMap;
}

async function getStudentBasics(database, organizationId, studentIds) {
  if (!studentIds.length) return new Map();
  const result = await database.query(
    `SELECT s.student_id, s.first_name, s.last_name, c.class_name
     FROM students s
     LEFT JOIN classes c ON c.class_id = s.class_id
     WHERE s.organization_id = $1
       AND s.student_id = ANY($2::int[])`,
    [organizationId, studentIds]
  );

  const out = new Map();
  for (const row of result.rows) {
    out.set(Number(row.student_id), {
      studentId: Number(row.student_id),
      firstName: row.first_name || "Student",
      lastName: row.last_name || "",
      className: row.class_name || "",
    });
  }
  return out;
}

async function sendParentAbsenceAlertsForOrganization(database, organizationId, options = {}) {
  await ensureNotificationSchema(database);
  const policy = await getPolicy(database, organizationId);
  if (!policy.enable_parent_absence_alerts) return { sent: 0 };

  const threshold = Math.max(1, toNumber(policy.absence_threshold_weekly, 3));
  const now = options.referenceDate instanceof Date ? options.referenceDate : new Date();
  const zonedNow = nowInTimeZone(now, policy.timezone);
  const weekStart = startOfWeek(zonedNow, toNumber(policy.week_start_day, 1));
  const weekEnd = endOfWeek(weekStart);
  const weekStartKey = toDateKey(weekStart);
  const weekEndKey = toDateKey(weekEnd);

  const result = await database.query(
    `SELECT ar.student_id,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(ar.status::text, '')) = 'absent') AS absent_count,
            COUNT(*) AS marks_count,
            ROUND(
              100.0 * COUNT(*) FILTER (WHERE LOWER(COALESCE(ar.status::text, '')) = 'present')
              / NULLIF(COUNT(*), 0),
              1
            ) AS attendance_pct
     FROM attendance_records ar
     WHERE ar.organization_id = $1
       AND ar.date BETWEEN $2::date AND $3::date
     GROUP BY ar.student_id
     HAVING COUNT(*) FILTER (WHERE LOWER(COALESCE(ar.status::text, '')) = 'absent') >= $4`,
    [organizationId, weekStartKey, weekEndKey, threshold]
  );

  const studentIds = result.rows.map((row) => Number(row.student_id));
  if (!studentIds.length) return { sent: 0 };

  const studentBasics = await getStudentBasics(database, organizationId, studentIds);
  const guardianMap = await resolveGuardianLinks(database, organizationId);
  const { organizationName } = await getOrganizationSummary(database, organizationId);
  const websiteInfo = await getOrganizationWebsiteInfo(database, organizationId);

  let sent = 0;
  for (const row of result.rows) {
    const studentId = Number(row.student_id);
    const info = studentBasics.get(studentId);
    if (!info) continue;

    const recipients = [];
    for (const guardian of guardianMap.values()) {
      if (guardian.studentIds.has(studentId)) {
        recipients.push(guardian.email);
      }
    }

    const emails = uniqueEmails(recipients);
    if (!emails.length) continue;

    // Respect each guardian's per-recipient preference for absence alerts.
    const enabledEmails = await filterEmailsByPreference(database, emails, 'parent_absence_alert');
    if (!enabledEmails.length) continue;

    const studentName = `${info.firstName} ${info.lastName}`.trim();
    const absences = toNumber(row.absent_count, 0);
    const attendancePct = Number(row.attendance_pct);

    for (const email of enabledEmails) {
      const eventKey = `${weekStartKey}:${studentId}`;
      const html = renderCleanEmail({
        title: `Attendance update for ${studentName}`,
        greeting: greetingFor(guardianMap.get(email)?.firstName),
        paragraphs: [
          `<strong>${escapeHtml(studentName)}</strong> was marked absent on ${plural(absences, "day")} during ${weekOf(weekStartKey)}.`,
          `If something is keeping ${escapeHtml(info.firstName)} from school, please let the school know.`,
        ],
        details: [
          ...(info.className ? [{ label: "Class", value: escapeHtml(info.className) }] : []),
          ...(Number.isFinite(attendancePct) ? [{ label: "Attendance this week", value: `${attendancePct.toFixed(1)}%` }] : []),
        ],
        schoolName: organizationName,
        organizationId,
        schoolWebsiteUrl: websiteInfo.websiteUrl || "",
        schoolWebsiteHost: websiteInfo.websiteHost || "",
      });

      const ok = await sendLoggedEmail(database, {
        organizationId,
        eventType: "parent_absence_threshold",
        eventKey,
        recipientEmail: email,
        recipientKind: "guardian",
        subject: subjectLine(`${studentName} was absent ${plural(absences, "day")} this week`),
        category: "parent_absence_alert",
        onBehalfOf: organizationId,
        html,
        payload: {
          studentId,
          weekStartKey,
          weekEndKey,
          absentCount: toNumber(row.absent_count, 0),
        },
        context: "Parent Absence Threshold",
      });

      if (ok) sent += 1;
    }
  }

  return { sent };
}

async function shouldRunDigestNow(database, organizationId, digestType, policy, weekStartKey, nowDate) {
  const hour = nowDate.getHours();
  const minute = nowDate.getMinutes();

  const digestWeekday = normalizeWeekday(policy.digest_weekday, GLOBAL_DIGEST_WEEKDAY);
  if (nowDate.getDay() !== digestWeekday) return false;
  if (hour !== toNumber(policy.digest_send_hour, 18)) return false;

  // Minute window allows scheduler jitter.
  const targetMinute = toNumber(policy.digest_send_minute, 0);
  if (Math.abs(minute - targetMinute) > 10) return false;

  const existing = await database.query(
    `SELECT 1
     FROM notification_digest_runs
     WHERE organization_id = $1
       AND digest_type = $2
       AND week_start_date = $3::date
     LIMIT 1`,
    [organizationId, digestType, weekStartKey]
  );

  return existing.rows.length === 0;
}

async function markDigestRun(database, organizationId, digestType, weekStartKey) {
  await database.query(
    `INSERT INTO notification_digest_runs (organization_id, digest_type, week_start_date)
     VALUES ($1, $2, $3::date)
     ON CONFLICT (organization_id, digest_type, week_start_date) DO NOTHING`,
    [organizationId, digestType, weekStartKey]
  );
}

async function sendWeeklyParentDigestForOrganization(database, organizationId, options = {}) {
  await ensureNotificationSchema(database);
  const policy = await getPolicy(database, organizationId);
  if (!policy.enable_weekly_parent_digest) return { sent: 0, skipped: true };

  const now = options.referenceDate instanceof Date ? options.referenceDate : new Date();
  const zonedNow = nowInTimeZone(now, policy.timezone);
  const weekStart = startOfWeek(zonedNow, toNumber(policy.week_start_day, 1));
  const weekEnd = endOfWeek(weekStart);
  const weekStartKey = toDateKey(weekStart);
  const weekEndKey = toDateKey(weekEnd);

  if (!options.force) {
    const canRun = await shouldRunDigestNow(
      database,
      organizationId,
      "weekly_parent_digest",
      policy,
      weekStartKey,
      zonedNow
    );
    if (!canRun) return { sent: 0, skipped: true };
  }

  const guardianMap = await resolveGuardianLinks(database, organizationId);
  if (!guardianMap.size) {
    await markDigestRun(database, organizationId, "weekly_parent_digest", weekStartKey);
    return { sent: 0 };
  }

  const allStudentIds = new Set();
  for (const guardian of guardianMap.values()) {
    for (const sid of guardian.studentIds) allStudentIds.add(sid);
  }

  const studentIds = Array.from(allStudentIds);
  const studentBasics = await getStudentBasics(database, organizationId, studentIds);
  const attendanceMap = await getStudentAttendanceWeekly(
    database,
    organizationId,
    weekStartKey,
    weekEndKey,
    studentIds
  );
  const currentTermId = await getCurrentTermId(database, organizationId);
  const averageMap = await getStudentTermAverages(database, organizationId, currentTermId, studentIds);
  const { organizationName } = await getOrganizationSummary(database, organizationId);
  const websiteInfo = await getOrganizationWebsiteInfo(database, organizationId);
  const goodThreshold = toNumber(policy.good_score_threshold, 60);

  let sent = 0;
  for (const guardian of guardianMap.values()) {
    const children = [];
    for (const sid of guardian.studentIds) {
      const basic = studentBasics.get(sid);
      if (!basic) continue;
      const attendance = attendanceMap.get(sid) || {};
      const marksCount = toNumber(attendance.marksCount, 0);

      // Only report children with real attendance activity this week; stale
      // data from prior weeks is never reused to pad out an empty digest.
      if (marksCount === 0) continue;

      children.push({
        firstName: basic.firstName,
        name: `${basic.firstName} ${basic.lastName}`.trim(),
        className: basic.className,
        attendance: attendanceInWords({
          marksCount,
          presentCount: toNumber(attendance.presentCount, 0),
          absentCount: toNumber(attendance.absentCount, 0),
          lateCount: toNumber(attendance.lateCount, 0),
        }),
        grades: gradesInWords(averageMap.get(sid), goodThreshold),
      });
    }

    // Respect this guardian's preference for the weekly parent digest.
    const guardianEnabled = await isEmailEnabledForRecipient(database, guardian.email, 'weekly_parent_digest');
    if (!guardianEnabled) continue;

    // Nothing happened for this guardian's children this week: no email at all.
    if (!children.length) continue;

    children.sort((a, b) => a.name.localeCompare(b.name));

    // One short summary per child: attendance this week, and how grades are going this term.
    const cards = children.map((child) => cardHtml(
      escapeHtml(child.name),
      child.className ? escapeHtml(child.className) : "",
      [
        `Attendance: ${escapeHtml(child.attendance)}`,
        child.grades ? `Grades this term: ${escapeHtml(child.grades)}` : "",
      ]
    ));
    const subjectNames = children.length === 1
      ? children[0].name
      : children.length === 2 ? `${children[0].firstName} and ${children[1].firstName}` : "your children";

    const html = renderCleanEmail({
      title: children.length === 1 ? `${children[0].firstName}'s week` : "Your children's week",
      greeting: greetingFor(guardian.firstName),
      paragraphs: [
        `Here's a summary of ${weekOf(weekStartKey)}.`,
        cards.join(""),
      ],
      preheader: children
        .map((child) => `${child.firstName}: ${child.attendance}${child.grades ? `; grades this term: ${child.grades}` : ""}.`)
        .join(" "),
      schoolName: organizationName,
      organizationId,
      schoolWebsiteUrl: websiteInfo.websiteUrl || "",
      schoolWebsiteHost: websiteInfo.websiteHost || "",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_parent_digest",
      eventKey: weekStartKey,
      recipientEmail: guardian.email,
      recipientKind: "guardian",
      subject: subjectLine(`Weekly update for ${subjectNames}`),
      category: "weekly_parent_digest",
      onBehalfOf: organizationId,
      html,
      payload: {
        weekStartKey,
        weekEndKey,
        childrenCount: children.length,
      },
      context: "Weekly Parent Digest",
    });

    if (ok) sent += 1;
  }

  await markDigestRun(database, organizationId, "weekly_parent_digest", weekStartKey);
  return { sent };
}

async function getUserClassAssignments(database, organizationId, userId) {
  const result = await database.query(
    `SELECT uc.class_id,
            c.class_name,
            COALESCE(uc.main, FALSE) AS is_main_teacher
     FROM user_classes uc
     JOIN classes c ON c.class_id = uc.class_id
     WHERE uc.user_id = $1
       AND c.organization_id = $2
     ORDER BY c.class_name`,
    [userId, organizationId]
  );

  return result.rows.map((row) => ({
    classId: Number(row.class_id),
    className: row.class_name,
    isMainTeacher: !!row.is_main_teacher,
  }));
}

async function getTeachingAssignments(database, organizationId, userId) {
  const result = await database.query(
    `SELECT DISTINCT uc.class_id,
            c.class_name,
            COALESCE(uc.main, FALSE) AS is_main_teacher,
            us.subject_id,
            s.subject_name
     FROM user_classes uc
     JOIN classes c ON c.class_id = uc.class_id
     JOIN user_subjects us ON us.user_id = uc.user_id
     JOIN subjects s ON s.subject_id = us.subject_id AND s.class_id = uc.class_id
     WHERE uc.user_id = $1
       AND c.organization_id = $2
     ORDER BY c.class_name, s.subject_name`,
    [userId, organizationId]
  );

  return result.rows.map((row) => ({
    classId: Number(row.class_id),
    className: row.class_name,
    subjectId: Number(row.subject_id),
    subjectName: row.subject_name,
    isMainTeacher: !!row.is_main_teacher,
  }));
}

async function getClassWeeklyAttendanceMap(database, organizationId, weekStartKey, weekEndKey, classIds) {
  if (!classIds.length) return new Map();

  const result = await database.query(
    `SELECT class_id,
            COUNT(*) AS marks_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'present') AS present_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'absent') AS absent_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'late') AS late_count,
            ROUND(
              100.0 * COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'present')
              / NULLIF(COUNT(*), 0),
              1
            ) AS attendance_pct
     FROM attendance_records
     WHERE organization_id = $1
       AND class_id = ANY($2::int[])
       AND date BETWEEN $3::date AND $4::date
     GROUP BY class_id`,
    [organizationId, classIds, weekStartKey, weekEndKey]
  );

  const out = new Map();
  for (const row of result.rows) {
    out.set(Number(row.class_id), {
      marksCount: toNumber(row.marks_count, 0),
      presentCount: toNumber(row.present_count, 0),
      absentCount: toNumber(row.absent_count, 0),
      lateCount: toNumber(row.late_count, 0),
      attendancePct: Number(row.attendance_pct),
    });
  }

  return out;
}

async function getClassSubjectPerformance(database, organizationId, termId, classIds) {
  if (!classIds.length) return [];

  if (!termId) {
    const result = await database.query(
      `SELECT s.class_id,
              c.class_name,
              s.subject_id,
              s.subject_name,
              NULL::numeric AS avg_score
       FROM subjects s
       JOIN classes c ON c.class_id = s.class_id
       WHERE c.organization_id = $1
         AND s.class_id = ANY($2::int[])
       ORDER BY c.class_name, s.subject_name`,
      [organizationId, classIds]
    );

    return result.rows.map((row) => ({
      classId: Number(row.class_id),
      className: row.class_name,
      subjectId: Number(row.subject_id),
      subjectName: row.subject_name,
      avgScore: figureOrNaN(row.avg_score),
    }));
  }

  const result = await database.query(
    `SELECT s.class_id,
            c.class_name,
            s.subject_id,
            s.subject_name,
            ROUND(AVG(ar.total_percentage)::numeric, 1) AS avg_score
     FROM subjects s
     JOIN classes c ON c.class_id = s.class_id
     LEFT JOIN assessments a
       ON a.subject_id = s.subject_id
      AND a.class_id = s.class_id
      AND a.organization_id = $1
      AND a.term_id = $2
     LEFT JOIN assessment_results ar
       ON ar.assessment_id = a.assessment_id
      AND ar.organization_id = $1
      AND ar.total_percentage IS NOT NULL
     WHERE c.organization_id = $1
       AND s.class_id = ANY($3::int[])
     GROUP BY s.class_id, c.class_name, s.subject_id, s.subject_name
     ORDER BY c.class_name, s.subject_name`,
    [organizationId, termId, classIds]
  );

  return result.rows.map((row) => ({
    classId: Number(row.class_id),
    className: row.class_name,
    subjectId: Number(row.subject_id),
    subjectName: row.subject_name,
    avgScore: figureOrNaN(row.avg_score),
  }));
}

// A teacher's or supervisor's classes for the weekly email: each class once, with its attendance
// this week and its subjects' averages this term. Rows are subject rows (classId, className,
// subjectName, avgScore, band); `mainClassIds` are the classes the person is main teacher of.
function classCards(rows, attendanceMap, mainClassIds = new Set()) {
  const byClass = new Map();
  for (const row of rows) {
    if (!byClass.has(row.classId)) {
      byClass.set(row.classId, {
        className: row.className || "",
        main: mainClassIds.has(row.classId),
        attendance: attendanceMap.get(row.classId) || {},
        subjects: [],
      });
    }
    byClass.get(row.classId).subjects.push(row);
  }
  return [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className));
}

function classCardHtml(card) {
  const attendance = card.attendance;
  const pct = Number(attendance.attendancePct);
  const absences = toNumber(attendance.absentCount, 0);
  const late = toNumber(attendance.lateCount, 0);
  const extra = [absences ? plural(absences, "absence") : "no absences", late ? `${late} late` : ""].filter(Boolean).join(", ");
  const attendanceText = Number.isFinite(pct) ? `${pct.toFixed(1)}% this week (${extra})` : "taken this week";
  const subjects = card.subjects.map((subject) => `${escapeHtml(subject.subjectName)}: ${Number.isFinite(subject.avgScore)
    ? `${subject.avgScore.toFixed(1)}% average (${escapeHtml(String(subject.band || "").toLowerCase())})`
    : "no grades yet this term"}`);
  return cardHtml(
    escapeHtml(card.className),
    card.main ? "main teacher" : "",
    [`Attendance: ${attendanceText}`, subjects.length ? listHtml(subjects) : ""]
  );
}

// "Weekly summary for Grade 5 A and Grade 6 B", or "for your 4 classes".
function classesSubject(cards) {
  const names = cards.map((card) => card.className).filter(Boolean);
  const what = names.length && names.length <= 2 ? names.join(" and ") : `your ${plural(cards.length, "class", "classes")}`;
  return subjectLine(`Weekly summary for ${what}`);
}

async function sendWeeklyTeacherDigestForOrganization(database, organizationId, options = {}) {
  await ensureNotificationSchema(database);
  const policy = await getPolicy(database, organizationId);
  if (!policy.enable_weekly_teacher_digest) return { sent: 0, skipped: true };

  const now = options.referenceDate instanceof Date ? options.referenceDate : new Date();
  const zonedNow = nowInTimeZone(now, policy.timezone);
  const weekStart = startOfWeek(zonedNow, toNumber(policy.week_start_day, 1));
  const weekEnd = endOfWeek(weekStart);
  const weekStartKey = toDateKey(weekStart);
  const weekEndKey = toDateKey(weekEnd);

  if (!options.force) {
    const canRun = await shouldRunDigestNow(
      database,
      organizationId,
      "weekly_teacher_digest",
      policy,
      weekStartKey,
      zonedNow
    );
    if (!canRun) return { sent: 0, skipped: true };
  }

  const { organizationName } = await getOrganizationSummary(database, organizationId);
  const websiteInfo = await getOrganizationWebsiteInfo(database, organizationId);
  const termId = await getCurrentTermId(database, organizationId);

  const teachersResult = await database.query(
    `SELECT user_id, first_name, last_name, email
     FROM users
     WHERE organization_id = $1
       AND account_type = 'Teacher'
       AND COALESCE(on_hold, FALSE) = FALSE
       AND email IS NOT NULL
       AND TRIM(email) <> ''
     ORDER BY first_name, last_name`,
    [organizationId]
  );

  let sent = 0;
  for (const teacher of teachersResult.rows) {
    // Skip teachers who have opted out of weekly_teacher_digest.
    if (!(await isUserEmailEnabled(database, teacher.user_id, 'weekly_teacher_digest'))) continue;

    const classAssignments = await getUserClassAssignments(database, organizationId, teacher.user_id);
    const teachingAssignments = await getTeachingAssignments(database, organizationId, teacher.user_id);

    const classIds = Array.from(
      new Set([
        ...classAssignments.map((assignment) => assignment.classId),
        ...teachingAssignments.map((assignment) => assignment.classId),
      ])
    );

    const classAttendanceMap = await getClassWeeklyAttendanceMap(
      database,
      organizationId,
      weekStartKey,
      weekEndKey,
      classIds
    );
    const classSubjectPerformance = await getClassSubjectPerformance(
      database,
      organizationId,
      termId,
      classIds
    );

    const subjectPerformanceMap = new Map(
      classSubjectPerformance.map((item) => [`${item.classId}:${item.subjectId}`, item])
    );

    const teachingRows = teachingAssignments
      .map((assignment) => {
        const attendance = classAttendanceMap.get(assignment.classId) || {};
        const subjectPerf = subjectPerformanceMap.get(`${assignment.classId}:${assignment.subjectId}`) || {};
        const avgScore = Number(subjectPerf.avgScore);

        return {
          classId: assignment.classId,
          className: assignment.className,
          subjectId: assignment.subjectId,
          subjectName: assignment.subjectName,
          marksCount: toNumber(attendance.marksCount, 0),
          presentCount: toNumber(attendance.presentCount, 0),
          absentCount: toNumber(attendance.absentCount, 0),
          lateCount: toNumber(attendance.lateCount, 0),
          attendancePct: Number(attendance.attendancePct),
          avgScore,
          band: scoreBand(avgScore, toNumber(policy.good_score_threshold, 60)),
        };
      })
      .filter((row) => row.marksCount > 0);

    const mainClassIds = new Set(
      classAssignments
        .filter((assignment) => assignment.isMainTeacher)
        .map((assignment) => assignment.classId)
    );
    const mainClassRows = classSubjectPerformance
      .filter((row) => mainClassIds.has(row.classId))
      .map((row) => {
        const attendance = classAttendanceMap.get(row.classId) || {};
        const avgScore = Number(row.avgScore);
        return {
          classId: row.classId,
          className: row.className,
          subjectId: row.subjectId,
          subjectName: row.subjectName,
          classMarksCount: toNumber(attendance.marksCount, 0),
          classPresentCount: toNumber(attendance.presentCount, 0),
          classAbsentCount: toNumber(attendance.absentCount, 0),
          classLateCount: toNumber(attendance.lateCount, 0),
          classAttendancePct: Number(attendance.attendancePct),
          avgScore,
          band: scoreBand(avgScore, toNumber(policy.good_score_threshold, 60)),
        };
      })
      .filter((row) => row.classMarksCount > 0);

    // Nothing to report for this teacher this week: no email at all.
    if (!teachingRows.length && !mainClassRows.length) continue;

    // Each class once: a main teacher's classes list every subject, others the subjects they teach.
    const cards = classCards(
      [...mainClassRows, ...teachingRows.filter((row) => !mainClassIds.has(row.classId))],
      classAttendanceMap,
      mainClassIds
    );

    const html = renderCleanEmail({
      title: "Your classes this week",
      greeting: greetingFor(teacher.first_name),
      paragraphs: [
        `Here's a summary of ${weekOf(weekStartKey)}.`,
        cards.map(classCardHtml).join(""),
      ],
      cta: { text: "Open Managira", url: LOGIN_URL },
      schoolName: organizationName,
      organizationId,
      schoolWebsiteUrl: websiteInfo.websiteUrl || "",
      schoolWebsiteHost: websiteInfo.websiteHost || "",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_teacher_digest",
      eventKey: `${weekStartKey}:${teacher.user_id}`,
      recipientEmail: teacher.email,
      recipientKind: "teacher",
      subject: classesSubject(cards),
      category: "weekly_teacher_digest",
      onBehalfOf: organizationId,
      html,
      payload: {
        weekStartKey,
        weekEndKey,
        teacherId: teacher.user_id,
        classCount: classIds.length,
        subjectUpdates: teachingRows.length,
        mainClassFeedRows: mainClassRows.length,
      },
      context: "Weekly Teacher Digest",
    });

    if (ok) sent += 1;
  }

  await markDigestRun(database, organizationId, "weekly_teacher_digest", weekStartKey);
  return { sent };
}

// Students who may need attention, for the leadership summary: name, class and what put them on
// the list (this week's attendance, the term average). `total` counts everyone on the list.
function riskListHtml(risks, total) {
  const items = risks.map((risk) => {
    const facts = [];
    if (Number.isFinite(risk.attendancePct)) facts.push(`attendance ${risk.attendancePct.toFixed(1)}% this week`);
    if (Number.isFinite(risk.avgScore)) facts.push(`term average ${risk.avgScore.toFixed(1)}%`);
    return `<strong>${escapeHtml(risk.studentName)}</strong>${risk.className ? `, ${escapeHtml(risk.className)}` : ""}: ${facts.join(", ")}`;
  });
  const more = total > risks.length ? `<p style="margin:6px 0 0;font-size:14px;">And ${plural(total - risks.length, "more student")} in Managira.</p>` : "";
  return `<p class="t-strong" style="margin:0 0 4px;font-size:15px;font-weight:600;color:#0f172a;">Students who may need attention</p>${listHtml(items)}${more}`;
}

async function sendWeeklyManagerDigestForOrganization(database, organizationId, options = {}) {
  await ensureNotificationSchema(database);
  const policy = await getPolicy(database, organizationId);
  if (!policy.enable_weekly_manager_digest) return { sent: 0, skipped: true };

  const now = options.referenceDate instanceof Date ? options.referenceDate : new Date();
  const zonedNow = nowInTimeZone(now, policy.timezone);
  const weekStart = startOfWeek(zonedNow, toNumber(policy.week_start_day, 1));
  const weekEnd = endOfWeek(weekStart);
  const weekStartKey = toDateKey(weekStart);
  const weekEndKey = toDateKey(weekEnd);

  if (!options.force) {
    const canRun = await shouldRunDigestNow(
      database,
      organizationId,
      "weekly_manager_digest",
      policy,
      weekStartKey,
      zonedNow
    );
    if (!canRun) return { sent: 0, skipped: true };
  }

  const { organizationName } = await getOrganizationSummary(database, organizationId);
  const websiteInfo = await getOrganizationWebsiteInfo(database, organizationId);
  const recipientsResult = await database.query(
    `SELECT user_id, first_name, last_name, email, account_type
     FROM users
     WHERE organization_id = $1
       AND account_type IN ('Manager', 'Supervisor')
       AND COALESCE(on_hold, FALSE) = FALSE
       AND email IS NOT NULL
       AND TRIM(email) <> ''
     ORDER BY account_type, first_name, last_name`,
    [organizationId]
  );

  if (!recipientsResult.rows.length) {
    await markDigestRun(database, organizationId, "weekly_manager_digest", weekStartKey);
    return { sent: 0 };
  }

  // Current students only: those who graduated or left are no one's follow-up.
  const studentsResult = await database.query(
    `SELECT s.student_id, s.first_name, s.last_name, c.class_name
     FROM students s
     LEFT JOIN classes c ON c.class_id = s.class_id
     WHERE s.organization_id = $1
       AND ${activeStudentSql("s")}`,
    [organizationId]
  );

  const studentIds = studentsResult.rows.map((row) => Number(row.student_id));
  const attendanceMap = await getStudentAttendanceWeekly(
    database,
    organizationId,
    weekStartKey,
    weekEndKey,
    studentIds
  );
  const termId = await getCurrentTermId(database, organizationId);
  const averageMap = await getStudentTermAverages(database, organizationId, termId, studentIds);
  const weeklyAttendanceRes = await database.query(
    `SELECT COUNT(*) AS marks_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'present') AS present_count,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'absent') AS absent_count,
            COUNT(DISTINCT class_id) AS classes_with_marks,
            ROUND(
              100.0 * COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'present')
              / NULLIF(COUNT(*), 0),
              1
            ) AS attendance_pct
     FROM attendance_records
     WHERE organization_id = $1
       AND date BETWEEN $2::date AND $3::date`,
    [organizationId, weekStartKey, weekEndKey]
  );

  const totalClassesRes = await database.query(
    `SELECT COUNT(*) AS total_classes
     FROM classes
     WHERE organization_id = $1`,
    [organizationId]
  );

  const weeklyAttendanceMarks = toNumber(weeklyAttendanceRes.rows[0]?.marks_count, 0);
  const weeklyAbsentMarks = toNumber(weeklyAttendanceRes.rows[0]?.absent_count, 0);
  const weeklyClassesWithMarks = toNumber(weeklyAttendanceRes.rows[0]?.classes_with_marks, 0);
  const weeklyAttendancePct = figureOrNaN(weeklyAttendanceRes.rows[0]?.attendance_pct);
  const totalClasses = Math.max(0, toNumber(totalClassesRes.rows[0]?.total_classes, 0));
  const weeklySignals = await getWeeklySchoolSignals(database, organizationId, weekStartKey, weekEndKey);

  const attendanceThreshold = toNumber(policy.underperform_attendance_threshold, 70);
  const scoreThreshold = toNumber(policy.underperform_score_threshold, 55);

  const risks = [];
  for (const row of studentsResult.rows) {
    const sid = Number(row.student_id);
    const attendance = attendanceMap.get(sid);
    const avgScore = averageMap.get(sid);

    const attendancePct = Number(attendance?.attendancePct);
    const attendanceRisk = Number.isFinite(attendancePct) && attendancePct < attendanceThreshold;
    const scoreRisk = Number.isFinite(avgScore) && avgScore < scoreThreshold;
    if (!attendanceRisk && !scoreRisk) continue;

    risks.push({
      studentName: `${row.first_name || "Student"} ${row.last_name || ""}`.trim(),
      className: row.class_name || "",
      attendancePct,
      avgScore: Number(avgScore),
    });
  }

  risks.sort((a, b) => a.className.localeCompare(b.className) || a.studentName.localeCompare(b.studentName));

  // Only send when something actually happened this week. Risks derived from
  // term-wide averages can persist for weeks with no new activity, so they
  // are not on their own a reason to send a digest. A quiet week sends nothing.
  const hasWeeklyActivity =
    weeklyAttendanceMarks > 0
    || weeklySignals.assessmentUpdates > 0
    || weeklySignals.communicationUpdates > 0;
  if (!hasWeeklyActivity) {
    await markDigestRun(database, organizationId, "weekly_manager_digest", weekStartKey);
    return { sent: 0, skipped: true };
  }

  let sent = 0;
  for (const recipient of recipientsResult.rows) {
    // Skip leaders who have opted out of the weekly leadership report.
    if (!(await isUserEmailEnabled(database, recipient.user_id, 'weekly_manager_digest'))) continue;

    const normalizedRole = String(recipient.account_type || '').trim().toLowerCase();
    const isSupervisor = normalizedRole === 'supervisor' || normalizedRole === 'superviser';

    if (isSupervisor) {
      const classAssignments = await getUserClassAssignments(database, organizationId, recipient.user_id);
      const teachingAssignments = await getTeachingAssignments(database, organizationId, recipient.user_id);
      const classIds = Array.from(
        new Set([
          ...classAssignments.map((assignment) => assignment.classId),
          ...teachingAssignments.map((assignment) => assignment.classId),
        ])
      );

      const classAttendanceMap = await getClassWeeklyAttendanceMap(
        database,
        organizationId,
        weekStartKey,
        weekEndKey,
        classIds
      );
      const classSubjectPerformance = await getClassSubjectPerformance(
        database,
        organizationId,
        termId,
        classIds
      );

      const subjectPerformanceMap = new Map(
        classSubjectPerformance.map((item) => [`${item.classId}:${item.subjectId}`, item])
      );

      const teachingRows = teachingAssignments
        .map((assignment) => {
          const attendance = classAttendanceMap.get(assignment.classId) || {};
          const subjectPerf = subjectPerformanceMap.get(`${assignment.classId}:${assignment.subjectId}`) || {};
          const avgScore = Number(subjectPerf.avgScore);

          return {
            classId: assignment.classId,
            className: assignment.className,
            subjectId: assignment.subjectId,
            subjectName: assignment.subjectName,
            marksCount: toNumber(attendance.marksCount, 0),
            presentCount: toNumber(attendance.presentCount, 0),
            absentCount: toNumber(attendance.absentCount, 0),
            lateCount: toNumber(attendance.lateCount, 0),
            attendancePct: Number(attendance.attendancePct),
            avgScore,
            band: scoreBand(avgScore, toNumber(policy.good_score_threshold, 60)),
          };
        })
        .filter((row) => row.marksCount > 0);

      const classFeedRows = classSubjectPerformance
        .map((row) => {
          const attendance = classAttendanceMap.get(row.classId) || {};
          const avgScore = Number(row.avgScore);
          return {
            classId: row.classId,
            className: row.className,
            subjectId: row.subjectId,
            subjectName: row.subjectName,
            classMarksCount: toNumber(attendance.marksCount, 0),
            classPresentCount: toNumber(attendance.presentCount, 0),
            classAbsentCount: toNumber(attendance.absentCount, 0),
            classLateCount: toNumber(attendance.lateCount, 0),
            classAttendancePct: Number(attendance.attendancePct),
            avgScore,
            band: scoreBand(avgScore, toNumber(policy.good_score_threshold, 60)),
          };
        })
        .filter((row) => row.classMarksCount > 0);

      // Nothing to report for this supervisor this week: no email at all.
      if (!teachingRows.length && !classFeedRows.length) continue;

      // Each class once, with every subject (a supervisor follows the whole class).
      const feedClassIds = new Set(classFeedRows.map((row) => row.classId));
      const cards = classCards(
        [...classFeedRows, ...teachingRows.filter((row) => !feedClassIds.has(row.classId))],
        classAttendanceMap
      );

      const supervisorHtml = renderCleanEmail({
        title: "Your classes this week",
        greeting: greetingFor(recipient.first_name),
        paragraphs: [
          `Here's a summary of ${weekOf(weekStartKey)}.`,
          cards.map(classCardHtml).join(""),
        ],
        cta: { text: "Open Managira", url: LOGIN_URL },
        schoolName: organizationName,
        organizationId,
        schoolWebsiteUrl: websiteInfo.websiteUrl || "",
        schoolWebsiteHost: websiteInfo.websiteHost || "",
      });

      const supervisorOk = await sendLoggedEmail(database, {
        organizationId,
        eventType: "weekly_manager_digest",
        eventKey: `${weekStartKey}:${recipient.user_id}`,
        recipientEmail: recipient.email,
        recipientKind: "Supervisor",
        subject: classesSubject(cards),
        category: "weekly_manager_digest",
        onBehalfOf: organizationId,
        html: supervisorHtml,
        payload: {
          weekStartKey,
          weekEndKey,
          role: "supervisor",
          classCount: classIds.length,
          subjectUpdates: teachingRows.length,
          classFeedRows: classFeedRows.length,
        },
        context: "Weekly Supervisor Digest",
      });

      if (supervisorOk) sent += 1;
      continue;
    }

    const totalStudents = studentIds.length;
    const scoredStudents = studentIds.reduce(
      (count, sid) => count + (Number.isFinite(Number(averageMap.get(sid))) ? 1 : 0),
      0
    );
    const topRisks = risks.slice(0, 25);
    const num = (n) => Number(n).toLocaleString("en-US");

    const snapshot = cardHtml("This week", "", [
      `Attendance: ${Number.isFinite(weeklyAttendancePct)
        ? `${weeklyAttendancePct.toFixed(1)}% (${plural(weeklyAbsentMarks, "absence")})`
        : "not taken this week"}`,
      `Classes that took attendance: ${num(weeklyClassesWithMarks)} of ${num(totalClasses)}`,
      `Students with grades this term: ${num(scoredStudents)} of ${num(totalStudents)}`,
      `Students who may need attention: ${num(risks.length)}`,
    ]);

    const html = renderCleanEmail({
      title: "Your school this week",
      greeting: greetingFor(recipient.first_name),
      paragraphs: [
        `Here's a summary of ${escapeHtml(organizationName)} for ${weekOf(weekStartKey)}.`,
        snapshot,
        ...(topRisks.length ? [riskListHtml(topRisks, risks.length)] : []),
      ],
      cta: { text: "Open Managira", url: LOGIN_URL },
      note: `A student is listed when their attendance this week is under ${attendanceThreshold}% or their term average is under ${scoreThreshold}%.`,
      schoolName: organizationName,
      organizationId,
      schoolWebsiteUrl: websiteInfo.websiteUrl || "",
      schoolWebsiteHost: websiteInfo.websiteHost || "",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_manager_digest",
      eventKey: `${weekStartKey}:${recipient.user_id}`,
      recipientEmail: recipient.email,
      recipientKind: String(recipient.account_type || "Manager"),
      subject: subjectLine(`Weekly summary for ${organizationName}`),
      category: "weekly_manager_digest",
      onBehalfOf: organizationId,
      html,
      payload: {
        weekStartKey,
        weekEndKey,
        role: "manager",
        riskCount: risks.length,
        weeklyAttendanceMarks,
        weeklyClassesWithMarks,
        weeklyAttendancePct,
      },
      context: "Weekly Manager Digest",
    });

    if (ok) sent += 1;
  }

  await markDigestRun(database, organizationId, "weekly_manager_digest", weekStartKey);
  return { sent };
}

async function runAbsenceAlertSweep(options = {}) {
  await ensureNotificationSchema(db);
  const orgResult = await db.query(
    `SELECT organization_id FROM organizations WHERE deleted = FALSE`
  );

  let sent = 0;
  for (const row of orgResult.rows) {
    const result = await sendParentAbsenceAlertsForOrganization(db, row.organization_id, options);
    sent += toNumber(result.sent, 0);
  }

  return { sent };
}

async function runWeeklyDigestSweep(options = {}) {
  await ensureNotificationSchema(db);
  const orgResult = await db.query(
    `SELECT organization_id FROM organizations WHERE deleted = FALSE`
  );

  const summary = {
    parentSent: 0,
    teacherSent: 0,
    managerSent: 0,
  };

  const { isOn } = require("./shards/features");
  for (const row of orgResult.rows) {
    const orgId = row.organization_id;
    // A school with the weekly briefing (utils/weeklyBriefing.js) sends that to families and
    // students, on its own day and time, instead of the weekly parent digest.
    let parent = { sent: 0 };
    if (isOn("weekly_briefing", { organizationId: orgId })) {
      parent = await require("./weeklyBriefing")
        .sendForOrganization(db, orgId, { now: options.referenceDate instanceof Date ? options.referenceDate : new Date(), force: Boolean(options.force) })
        .catch((error) => {
          console.error(`[Weekly briefing] organization ${orgId}:`, error.message);
          return { sent: 0 };
        });
    } else {
      parent = await sendWeeklyParentDigestForOrganization(db, orgId, options);
    }
    const teacher = await sendWeeklyTeacherDigestForOrganization(db, orgId, options);
    const manager = await sendWeeklyManagerDigestForOrganization(db, orgId, options);
    summary.parentSent += toNumber(parent.sent, 0);
    summary.teacherSent += toNumber(teacher.sent, 0);
    summary.managerSent += toNumber(manager.sent, 0);
  }

  // Hub digest runs once across all hubs (not per-org).
  const hub = await sendWeeklyHubDigest(db, options);
  summary.hubSent = toNumber(hub.sent, 0);

  return summary;
}

// One member school in the hub's weekly email.
function schoolCardHtml(org) {
  const num = (n) => Number(n).toLocaleString("en-US");
  return cardHtml(escapeHtml(org.orgName), "", [
    `${plural(org.studentCount, "student")} &middot; ${num(org.staffCount)} staff`,
    `Attendance: ${Number.isFinite(org.attendancePct) ? `${org.attendancePct.toFixed(1)}% this week` : "not taken this week"}`,
    Number.isFinite(org.avgScore) ? `Term average: ${org.avgScore.toFixed(1)}%` : "",
    `Students who may need attention: ${num(org.riskCount)}`,
  ]);
}

async function sendWeeklyHubDigest(database, options = {}) {
  await ensureNotificationSchema(database);

  const now = options.referenceDate instanceof Date ? options.referenceDate : new Date();

  // Fetch all active hubs
  const hubsResult = await database.query(
    `SELECT hub_id, hub_name, hub_email, first_name, last_name
     FROM managira_hubs
     WHERE COALESCE(deleted, FALSE) = FALSE
       AND COALESCE(on_hold, FALSE) = FALSE
       AND hub_email IS NOT NULL
       AND TRIM(hub_email) <> ''`
  );

  if (!hubsResult.rows.length) return { sent: 0 };

  let sent = 0;

  for (const hub of hubsResult.rows) {
    // Owner + hub users who can see reports and kept the weekly overview on.
    const digestRecipients = await require("./hubAccess").getHubRecipients(database, hub.hub_id, 'weekly_hub_digest');
    if (!digestRecipients.length) continue;

    // Get all member orgs for this hub
    const orgsResult = await database.query(
      `SELECT organization_id, organization_name
       FROM organizations
       WHERE hub_id = $1
         AND deleted = FALSE
         AND is_hub_member = TRUE
       ORDER BY organization_name`,
      [hub.hub_id]
    );

    if (!orgsResult.rows.length) continue;

    // For each org, pick its policy to check hub digest enable + compute week bounds
    const orgSummaries = [];
    let weekStartKey = null;
    let weekEndKey = null;
    let anyDigestEnabled = false;
    let digestRunOrganizationId = null;
    let schedulePolicy = null;
    const hubDigestType = `weekly_hub_digest:${hub.hub_id}`;

    for (const org of orgsResult.rows) {
      const policy = await getPolicy(database, org.organization_id);
      if (policy.enable_weekly_hub_digest === false) continue;
      anyDigestEnabled = true;

      if (!schedulePolicy) {
        schedulePolicy = policy;
        digestRunOrganizationId = Number(org.organization_id);
      }

      const zonedNow = nowInTimeZone(now, policy.timezone);
      const weekStart = startOfWeek(zonedNow, toNumber(policy.week_start_day, 1));
      const weekEnd = endOfWeek(weekStart);
      if (!weekStartKey) {
        weekStartKey = toDateKey(weekStart);
        weekEndKey = toDateKey(weekEnd);
      }

      // Student count
      const studentCountRes = await database.query(
        `SELECT COUNT(*) AS cnt FROM students s WHERE s.organization_id = $1 AND ${activeStudentSql("s")}`,
        [org.organization_id]
      );
      const studentCount = toNumber(studentCountRes.rows[0]?.cnt, 0);

      // Staff count
      const staffCountRes = await database.query(
        `SELECT COUNT(*) AS cnt FROM users WHERE organization_id = $1 AND COALESCE(on_hold, FALSE) = FALSE`,
        [org.organization_id]
      );
      const staffCount = toNumber(staffCountRes.rows[0]?.cnt, 0);

      // Org-wide attendance this week
      const attendanceRes = await database.query(
        `SELECT COUNT(*) AS marks_count,
                ROUND(
                 100.0 * COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'present')
                 / NULLIF(COUNT(*), 0),
                 1
               ) AS attendance_pct
         FROM attendance_records
         WHERE organization_id = $1
           AND date BETWEEN $2::date AND $3::date`,
        [org.organization_id, weekStartKey, weekEndKey]
      );
      const attendanceMarks = toNumber(attendanceRes.rows[0]?.marks_count, 0);
      const attendancePct = figureOrNaN(attendanceRes.rows[0]?.attendance_pct);

      // Org-wide average score this term
      const termId = await getCurrentTermId(database, org.organization_id);
      let avgScore = NaN;
      if (termId) {
        const scoreRes = await database.query(
          `SELECT ROUND(AVG(ar.total_percentage)::numeric, 1) AS avg_score
           FROM assessment_results ar
           JOIN assessments a ON a.assessment_id = ar.assessment_id
           WHERE ar.organization_id = $1
             AND a.term_id = $2
             AND ar.total_percentage IS NOT NULL`,
          [org.organization_id, termId]
        );
        avgScore = figureOrNaN(scoreRes.rows[0]?.avg_score);
      }

      // At-risk student count (attendance < threshold OR score < threshold)
      const attendanceThreshold = toNumber(policy.underperform_attendance_threshold, 70);
      const scoreThreshold = toNumber(policy.underperform_score_threshold, 55);
      let riskCount = 0;

      const allStudentsRes = await database.query(
        `SELECT s.student_id FROM students s WHERE s.organization_id = $1 AND ${activeStudentSql("s")}`,
        [org.organization_id]
      );
      const allStudentIds = allStudentsRes.rows.map((r) => Number(r.student_id));

      if (allStudentIds.length) {
        const attMap = await getStudentAttendanceWeekly(database, org.organization_id, weekStartKey, weekEndKey, allStudentIds);
        const scoreMap = await getStudentTermAverages(database, org.organization_id, termId, allStudentIds);

        for (const sid of allStudentIds) {
          const att = attMap.get(sid);
          const sc = scoreMap.get(sid);
          const attRisk = Number.isFinite(att?.attendancePct) && att.attendancePct < attendanceThreshold;
          const scRisk = Number.isFinite(sc) && sc < scoreThreshold;
          if (attRisk || scRisk) riskCount += 1;
        }
      }

      const weeklySignals = await getWeeklySchoolSignals(database, org.organization_id, weekStartKey, weekEndKey);

      orgSummaries.push({
        orgName: org.organization_name || "School",
        studentCount,
        staffCount,
        attendanceMarks,
        attendancePct,
        avgScore,
        riskCount,
        assessmentUpdates: weeklySignals.assessmentUpdates,
        communicationUpdates: weeklySignals.communicationUpdates,
      });
    }

    if (!anyDigestEnabled || !orgSummaries.length) continue;
    if (!weekStartKey || !digestRunOrganizationId || !schedulePolicy) continue;

    if (!options.force) {
      const scheduleNow = nowInTimeZone(now, schedulePolicy.timezone);
      const canRun = await shouldRunDigestNow(
        database,
        digestRunOrganizationId,
        hubDigestType,
        schedulePolicy,
        weekStartKey,
        scheduleNow
      );
      if (!canRun) continue;
    }

    // riskCount is derived from term-wide averages and can stay nonzero for
    // weeks with no new activity, so it is not treated as activity on its own.
    const hasHubWeeklyActivity = orgSummaries.some((orgSummary) =>
      orgSummary.attendanceMarks > 0
      || orgSummary.assessmentUpdates > 0
      || orgSummary.communicationUpdates > 0
    );
    // A quiet week across the hub sends nothing.
    if (!hasHubWeeklyActivity) {
      await markDigestRun(database, digestRunOrganizationId, hubDigestType, weekStartKey);
      continue;
    }

    const totalStudents = orgSummaries.reduce((sum, o) => sum + o.studentCount, 0);
    const totalStaff = orgSummaries.reduce((sum, o) => sum + o.staffCount, 0);
    const totalRisk = orgSummaries.reduce((sum, o) => sum + o.riskCount, 0);
    const hubName = hub.hub_name || "your hub";

    const cards = [
      cardHtml("All schools", "", [
        `${plural(totalStudents, "student")} &middot; ${totalStaff.toLocaleString("en-US")} staff`,
        `Students who may need attention: ${totalRisk.toLocaleString("en-US")}`,
      ]),
      ...orgSummaries.map(schoolCardHtml),
    ].join("");

    let anySent = false;
    for (const recipient of digestRecipients) {
      const isOwner = String(recipient.email).toLowerCase() === String(hub.hub_email).toLowerCase();
      const html = renderCleanEmail({
        title: "Your schools this week",
        greeting: greetingFor(isOwner ? hub.first_name : recipient.firstName),
        paragraphs: [
          `Here's a summary of ${escapeHtml(hubName)}'s ${plural(orgSummaries.length, "school")} for ${weekOf(weekStartKey)}.`,
          cards,
        ],
        cta: { text: "Open your hub", url: `${APP_URL}/hub/dashboard` },
        hubId: hub.hub_id,
      });

      const ok = await sendLoggedEmail(database, {
        organizationId: digestRunOrganizationId,
        eventType: "weekly_hub_digest",
        eventKey: isOwner ? `${hub.hub_id}:${weekStartKey}` : `${hub.hub_id}:${weekStartKey}:${String(recipient.email).toLowerCase()}`,
        recipientEmail: recipient.email,
        recipientKind: "hub",
        subject: subjectLine(`Weekly summary for ${hubName}`),
        category: "weekly_hub_digest",
        html,
        payload: {
          weekStartKey,
          weekEndKey,
          hubId: hub.hub_id,
          orgCount: orgSummaries.length,
          totalStudents,
          totalRisk,
        },
        context: "Weekly Hub Digest",
      });

      if (ok) {
        sent += 1;
        anySent = true;
      }
    }
    if (anySent) await markDigestRun(database, digestRunOrganizationId, hubDigestType, weekStartKey);
  }

  return { sent };
}

async function triggerAbsenceAlertsForStudents(database, organizationId, studentIds = []) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return { sent: 0 };
  // Current implementation keeps this simple and safe by running one org-level sweep.
  // Deduplication prevents duplicate sends.
  return sendParentAbsenceAlertsForOrganization(database, organizationId, {});
}

async function notifyStaffOnGuardianReportCreated(database, {
  organizationId,
  reportId,
}) {
  await ensureNotificationSchema(database);

  const reportRes = await database.query(
    `SELECT r.report_id,
            r.student_id,
            r.subject,
            r.message,
            s.first_name AS student_first_name,
            s.last_name AS student_last_name,
            g.first_name AS guardian_first_name,
            g.last_name AS guardian_last_name
     FROM guardian_reports r
     LEFT JOIN students s ON s.student_id = r.student_id
     LEFT JOIN guardian_profiles g ON g.guardian_id = r.guardian_id
     WHERE r.organization_id = $1
       AND r.report_id = $2
     LIMIT 1`,
    [organizationId, reportId]
  );

  if (!reportRes.rows.length) return { sent: 0 };
  const report = reportRes.rows[0];

  // Staff on hold, or no longer at this school, aren't told (as in the fallback below).
  const recipientsRes = await database.query(
    `SELECT u.user_id, u.email, u.first_name, u.last_name, u.account_type
     FROM guardian_report_recipients grr
     JOIN users u ON u.user_id = grr.user_id
     WHERE grr.report_id = $1
       AND u.organization_id = $2
       AND COALESCE(u.on_hold, FALSE) = FALSE
       AND u.email IS NOT NULL
       AND TRIM(u.email) <> ''`,
    [reportId, organizationId]
  );

  let recipientRows = recipientsRes.rows;

  // Fallback routing: class teachers + supervisors + managers if no explicit CC recipients were selected.
  if (!recipientRows.length && report.student_id) {
    const fallbackRes = await database.query(
      `SELECT DISTINCT u.user_id, u.email, u.first_name, u.last_name, u.account_type
       FROM users u
       LEFT JOIN user_classes uc ON uc.user_id = u.user_id
       LEFT JOIN students s ON s.class_id = uc.class_id
       WHERE u.organization_id = $1
         AND COALESCE(u.on_hold, FALSE) = FALSE
         AND u.email IS NOT NULL
         AND TRIM(u.email) <> ''
         AND (
           (u.account_type = 'Teacher' AND s.student_id = $2)
           OR u.account_type IN ('Manager', 'Supervisor')
         )`,
      [organizationId, report.student_id]
    );
    recipientRows = fallbackRes.rows;
  }

  const recipients = uniqueEmails(recipientRows.map((row) => row.email));
  if (!recipients.length) return { sent: 0 };

  // Filter out staff who opted out of guardian-report-created notifications.
  const optedIn = await filterEmailsByPreference(database, recipients, 'guardian_report_created_staff');
  if (!optedIn.length) return { sent: 0 };

  const { organizationName } = await getOrganizationSummary(database, organizationId);
  const firstNames = new Map(recipientRows.map((row) => [normalizeEmail(row.email), row.first_name]));
  const guardianName = `${report.guardian_first_name || ""} ${report.guardian_last_name || ""}`.trim();
  const studentName = `${report.student_first_name || ""} ${report.student_last_name || ""}`.trim();
  const topic = String(report.subject || "").trim();
  let sent = 0;

  for (const email of optedIn) {
    const html = renderCleanEmail({
      title: guardianName ? `New message from ${guardianName}` : "New message from a parent",
      greeting: greetingFor(firstNames.get(normalizeEmail(email))),
      paragraphs: [
        `${guardianName ? escapeHtml(guardianName) : "A parent"} sent a message${studentName ? ` about ${escapeHtml(studentName)}` : ""}${topic ? `: “${escapeHtml(topic)}”` : "."}`,
        quoteHtml(report.message),
      ].filter(Boolean),
      cta: { url: parentMessageUrl(report.report_id), text: "Open conversation" },
      note: "Please reply in Managira so the whole conversation stays in one place.",
      schoolName: organizationName,
      organizationId,
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "guardian_report_created",
      eventKey: String(report.report_id),
      recipientEmail: email,
      recipientKind: "staff",
      subject: subjectLine(`New message from ${guardianName || "a parent"}${topic ? `: ${topic}` : ""}`),
      category: "guardian_report_created_staff",
      onBehalfOf: organizationId,
      html,
      payload: { reportId: report.report_id },
      context: "Guardian Report Created",
      background: true,
    });

    if (ok) sent += 1;
  }

  return { sent };
}

async function notifyStaffOnGuardianReply(database, {
  organizationId,
  reportId,
  replyMessage,
}) {
  await ensureNotificationSchema(database);

  // Skip email if there was a staff reply within the last 20 minutes (active conversation)
  const recentActivity = await database.query(
    `SELECT 1 FROM guardian_report_replies
     WHERE report_id = $1 AND sender_type = 'staff'
       AND created_at > NOW() - INTERVAL '20 minutes'
     LIMIT 1`,
    [reportId]
  );
  if (recentActivity.rows.length > 0) {
    return { sent: 0, skipped: 'active_conversation' };
  }

  const reportRes = await database.query(
    `SELECT r.report_id, r.subject, r.student_id, g.first_name AS guardian_first_name, g.last_name AS guardian_last_name
     FROM guardian_reports r
     LEFT JOIN guardian_profiles g ON g.guardian_id = r.guardian_id
     WHERE r.organization_id = $1 AND r.report_id = $2 LIMIT 1`,
    [organizationId, reportId]
  );
  if (!reportRes.rows.length) return { sent: 0 };

  // Staff on hold, or no longer at this school, aren't told (as in the fallback below).
  const recipientsRes = await database.query(
    `SELECT DISTINCT u.email, u.first_name
     FROM guardian_report_recipients grr
     JOIN users u ON u.user_id = grr.user_id
     WHERE grr.report_id = $1
       AND u.organization_id = $2
       AND COALESCE(u.on_hold, FALSE) = FALSE
       AND u.email IS NOT NULL
       AND TRIM(u.email) <> ''`,
    [reportId, organizationId]
  );

  let recipientRows = recipientsRes.rows;
  if (!recipientRows.length) {
    const fallbackRes = await database.query(
      `SELECT DISTINCT u.email, u.first_name
       FROM guardian_reports r
       JOIN students s ON s.student_id = r.student_id
       LEFT JOIN user_classes uc ON uc.class_id = s.class_id
       JOIN users u ON u.organization_id = r.organization_id
       WHERE r.report_id = $1
         AND u.email IS NOT NULL
         AND TRIM(u.email) <> ''
         AND COALESCE(u.on_hold, FALSE) = FALSE
         AND (
           (u.account_type = 'Teacher' AND u.user_id = uc.user_id)
           OR u.account_type IN ('Manager', 'Supervisor')
         )`,
      [reportId]
    );
    recipientRows = fallbackRes.rows;
  }

  const recipients = uniqueEmails(recipientRows.map((row) => row.email));
  if (!recipients.length) return { sent: 0 };

  // Filter out staff who opted out of guardian-report-reply notifications.
  const optedIn = await filterEmailsByPreference(database, recipients, 'guardian_report_reply_staff');
  if (!optedIn.length) return { sent: 0 };

  const { organizationName } = await getOrganizationSummary(database, organizationId);
  const report = reportRes.rows[0];
  const firstNames = new Map(recipientRows.map((row) => [normalizeEmail(row.email), row.first_name]));
  const guardianName = `${report.guardian_first_name || ""} ${report.guardian_last_name || ""}`.trim();
  const topic = String(report.subject || "").trim();

  let sent = 0;
  for (const email of optedIn) {
    const html = renderCleanEmail({
      title: guardianName ? `${guardianName} replied` : "A parent replied",
      greeting: greetingFor(firstNames.get(normalizeEmail(email))),
      paragraphs: [
        `${guardianName ? escapeHtml(guardianName) : "A parent"} replied${topic ? ` to “${escapeHtml(topic)}”` : ""}:`,
        quoteHtml(replyMessage),
      ].filter(Boolean),
      cta: { url: parentMessageUrl(reportId), text: "Open conversation" },
      note: "Please reply in Managira so the whole conversation stays in one place.",
      schoolName: organizationName,
      organizationId,
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "guardian_report_reply",
      eventKey: String(reportId),
      recipientEmail: email,
      recipientKind: "staff",
      subject: subjectLine(`New reply: ${topic || `message from ${guardianName || "a parent"}`}`),
      category: "guardian_report_reply_staff",
      onBehalfOf: organizationId,
      html,
      payload: { reportId },
      context: "Guardian Report Reply",
      background: true,
    });

    if (ok) sent += 1;
  }

  return { sent };
}

/**
 * Broadcast an event or announcement to all relevant recipients by email.
 *
 * @param {object} database - pg pool / client
 * @param {object} params
 * @param {number} params.organizationId
 * @param {"event"|"announcement"} params.contentType
 * @param {string} params.visibility - "org" (internal) | "both" | "public"
 * @param {string} params.title - event name or short announcement label
 * @param {string} params.body - event details or announcement message
 * @param {string} [params.eventDate] - ISO date string (events only)
 * @param {number} [params.contentId] - record id for dedup key
 */
async function broadcastEventAnnouncement(database, params) {
  await ensureNotificationSchema(database);

  const {
    organizationId,
    contentType,
    visibility,
    title,
    body,
    eventDate,
    contentId,
  } = params;

  const { organizationName } = await getOrganizationSummary(database, organizationId);

  // --- Resolve recipients based on visibility ---
  // "org"    = internal staff only (teachers, supervisors, managers)
  // "public" = external audience only (parents / guardians)
  // "both"   = everyone (staff + parents / guardians)
  const includeStaff    = visibility === "org" || visibility === "both";
  const includeParents  = visibility === "public" || visibility === "both";

  // First names for the greeting, by address.
  const firstNames = new Map();
  let staffEmails = [];
  if (includeStaff) {
    const staffResult = await database.query(
      `SELECT LOWER(TRIM(email)) AS email, first_name
       FROM users
       WHERE organization_id = $1
         AND COALESCE(on_hold, FALSE) = FALSE
         AND email IS NOT NULL
         AND TRIM(email) <> ''
         AND account_type IN ('Teacher', 'Supervisor', 'Manager')`,
      [organizationId]
    );
    staffEmails = staffResult.rows.map((r) => r.email);
    staffResult.rows.forEach((r) => { if (!firstNames.has(r.email)) firstNames.set(r.email, r.first_name); });
  }

  let guardianEmails = [];
  if (includeParents) {
    const guardianMap = await resolveGuardianLinks(database, organizationId);
    for (const guardian of guardianMap.values()) {
      if (!guardian.email) continue;
      guardianEmails.push(guardian.email);
      if (!firstNames.has(guardian.email)) firstNames.set(guardian.email, guardian.firstName);
    }
  }

  const allRecipients = uniqueEmails([...staffEmails, ...guardianEmails]);
  // Filter out anyone who has disabled broadcasts.
  const optedIn = await filterEmailsByPreference(database, allRecipients, 'broadcast_event_or_announcement');
  if (!optedIn.length) return { sent: 0, recipientCount: 0 };

  // --- Build email ---
  // An event is named by its own name and date. An announcement has no title of its own: its
  // first line is the subject, and the email is the announcement itself.
  const isEvent = contentType === "event";
  const eventName = String(title || "").replace(/\s+/g, " ").trim();
  const day = isEvent && eventDate ? formatDay(eventDate, { weekday: true }) : "";
  const firstLine = String(body || title || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const subject = isEvent
    ? subjectLine(day ? `${eventName || "New event"} on ${formatDay(eventDate, { weekday: true, year: false })}` : eventName || "New event")
    : subjectLine(firstLine || `Announcement from ${organizationName}`);
  const staffSet = new Set(staffEmails);

  // --- Send ---
  const eventKey = `${contentType}:${contentId || Date.now()}`;
  let sent = 0;

  for (const email of optedIn) {
    const html = renderCleanEmail(isEvent
      ? {
          title: eventName || "New event",
          greeting: greetingFor(firstNames.get(email)),
          paragraphs: textParagraphs(body),
          details: day ? [{ label: "Date", value: escapeHtml(day) }] : [],
          schoolName: organizationName,
          organizationId,
        }
      : {
          title: subject,
          showTitle: false,
          greeting: greetingFor(firstNames.get(email)),
          paragraphs: textParagraphs(body || title),
          schoolName: organizationName,
          organizationId,
        });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: `broadcast_${contentType}`,
      eventKey,
      recipientEmail: email,
      recipientKind: staffSet.has(email) ? "staff" : "guardian",
      subject,
      category: "broadcast_event_or_announcement",
      optOutChecked: true,
      onBehalfOf: organizationId,
      html,
      payload: { contentType, contentId, visibility },
      context: `Broadcast ${contentType}`,
      background: true,
    });
    if (ok) sent += 1;
  }

  return { sent, recipientCount: optedIn.length };
}

// ════════════════════════════════════════════════════════════════════════════
// NEW NOTIFICATION FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * 1. Notify parent/guardian when their child's class changes.
 */
async function notifyGuardiansOnClassChange(database, { organizationId, studentId, studentName, oldClassName, newClassName }) {
  if (!oldClassName || !newClassName || oldClassName === newClassName) return;
  const { organizationName } = await getOrganizationSummary(database, organizationId);

  // The student's parents, once per address (a parent on both lists is emailed once), and only
  // while the student is still at the school.
  const guardiansResult = await database.query(
    `SELECT DISTINCT ON (LOWER(TRIM(src.email))) LOWER(TRIM(src.email)) AS email, src.first_name
     FROM (
       SELECT gp.email, gp.first_name
       FROM guardian_profiles gp
       JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
       WHERE gs.student_id = $1 AND gp.organization_id = $2
         AND gp.email IS NOT NULL AND TRIM(gp.email) <> ''
       UNION ALL
       SELECT g.email, g.first_name
       FROM guardians g
       WHERE g.student_id = $1 AND g.organization_id = $2
         AND g.email IS NOT NULL AND TRIM(g.email) <> ''
     ) src
     JOIN students s ON s.student_id = $1 AND s.organization_id = $2 AND ${activeStudentSql("s")}
     ORDER BY LOWER(TRIM(src.email))`,
    [studentId, organizationId]
  );

  for (const row of guardiansResult.rows) {
    if (!row.email) continue;
    if (!(await isEmailEnabledForRecipient(database, row.email, 'student_class_change'))) continue;
    const html = renderCleanEmail({
      title: `New class for ${studentName}`,
      greeting: greetingFor(row.first_name),
      paragraphs: [
        `<strong>${escapeHtml(studentName)}</strong> has moved from ${escapeHtml(oldClassName)} to <strong>${escapeHtml(newClassName)}</strong>.`,
        "If you have any questions, please contact the school.",
      ],
      schoolName: organizationName,
      organizationId,
    });
    sendEmailInBackground({
      to: row.email,
      subject: subjectLine(`${studentName} has moved to ${newClassName}`),
      html,
      category: "student_class_change",
      onBehalfOf: organizationId,
      failureNotification: buildFailureNotification(organizationId, {
        title: 'Class change email failed',
        body: `The class change email for ${studentName} could not be delivered to ${row.email}.`,
      }),
    }, "Class Change Notification");
  }
}

/**
 * 2. Notify a teacher when their class/subject assignments change.
 */
async function notifyTeacherOnReassignment(database, { organizationId, userId, teacherName, teacherEmail, oldClasses, newClasses, oldSubjects, newSubjects }) {
  if (!teacherEmail) return;
  if (userId && !(await isUserEmailEnabled(database, userId, 'teacher_reassignment'))) return;
  const { organizationName } = await getOrganizationSummary(database, organizationId);

  const addedClasses = newClasses.filter(c => !oldClasses.includes(c));
  const removedClasses = oldClasses.filter(c => !newClasses.includes(c));
  const addedSubjects = newSubjects.filter(s => !oldSubjects.includes(s));
  const removedSubjects = oldSubjects.filter(s => !newSubjects.includes(s));

  if (!addedClasses.length && !removedClasses.length && !addedSubjects.length && !removedSubjects.length) return;

  const changes = [];
  if (addedClasses.length) changes.push(`Classes added: ${addedClasses.map(escapeHtml).join(", ")}`);
  if (removedClasses.length) changes.push(`Classes removed: ${removedClasses.map(escapeHtml).join(", ")}`);
  if (addedSubjects.length) changes.push(`Subjects added: ${addedSubjects.map(escapeHtml).join(", ")}`);
  if (removedSubjects.length) changes.push(`Subjects removed: ${removedSubjects.map(escapeHtml).join(", ")}`);

  const html = renderCleanEmail({
    title: "Your classes and subjects were updated",
    greeting: greetingFor(teacherName),
    paragraphs: [
      `Your teaching assignments at ${escapeHtml(organizationName)} have changed:`,
      listHtml(changes),
    ],
    details: [
      { label: "Your classes", value: newClasses.length ? newClasses.map(escapeHtml).join(", ") : "None" },
      { label: "Your subjects", value: newSubjects.length ? newSubjects.map(escapeHtml).join(", ") : "None" },
    ],
    note: "Questions about these changes? Please contact your school administrator.",
    schoolName: organizationName,
    organizationId,
  });
  sendEmailInBackground({
    to: teacherEmail,
    subject: "Your classes and subjects were updated",
    html,
    category: "teacher_reassignment",
    onBehalfOf: organizationId,
    failureNotification: buildFailureNotification(organizationId, {
      title: 'Teacher reassignment email failed',
      body: `The reassignment email for ${teacherName || 'a teacher'} could not be delivered to ${teacherEmail}.`,
    }),
  }, "Teacher Reassignment");
}

/**
 * 3. Notify teachers when an assessment is locked/unlocked/activated/deactivated.
 */
async function notifyTeachersOnAssessmentControl(database, { organizationId, groupId, termId, action }) {
  const { organizationName } = await getOrganizationSummary(database, organizationId);

  // Get assessment group info
  const groupResult = await database.query(
    `SELECT group_name FROM assessment_groups WHERE group_id = $1 AND organization_id = $2`,
    [groupId, organizationId]
  );
  const groupName = groupResult.rows[0]?.group_name || "Assessment";

  // Get term info
  const termResult = await database.query(
    `SELECT term_name FROM terms WHERE term_id = $1`,
    [termId]
  );
  const termName = termResult.rows[0]?.term_name || "";

  const actionMessages = {
    lock: { verb: "locked", detail: "Scores can no longer be entered or changed." },
    unlock: { verb: "unlocked", detail: "You can enter and change scores again." },
    activate: { verb: "activated", detail: "It is now visible to staff." },
    deactivate: { verb: "deactivated", detail: "It is no longer visible to staff." },
  };
  const msg = actionMessages[action] || { verb: String(action || "updated"), detail: "" };

  // Find teachers assigned to classes that have this assessment group
  const teachersResult = await database.query(
    `SELECT DISTINCT u.email, u.first_name
     FROM users u
     JOIN user_classes uc ON uc.user_id = u.user_id
     JOIN assessments a ON a.class_id = uc.class_id
     WHERE a.group_id = $1 AND a.organization_id = $2 AND a.term_id = $3
       AND u.organization_id = $2
       AND u.account_type = 'Teacher'
       AND COALESCE(u.on_hold, FALSE) = FALSE
       AND u.email IS NOT NULL AND TRIM(u.email) <> ''`,
    [groupId, organizationId, termId]
  );

  for (const teacher of teachersResult.rows) {
    if (!(await isEmailEnabledForRecipient(database, teacher.email, 'assessment_control_teacher'))) continue;
    const html = renderCleanEmail({
      title: `Assessment ${msg.verb}: ${groupName}`,
      greeting: greetingFor(teacher.first_name),
      paragraphs: [
        `The assessment <strong>${escapeHtml(groupName)}</strong>${termName ? ` for ${escapeHtml(termName)}` : ""} was ${escapeHtml(msg.verb)}. ${msg.detail}`.trim(),
      ],
      schoolName: organizationName,
      organizationId,
    });
    sendEmailInBackground({
      to: teacher.email,
      subject: subjectLine(`Assessment ${msg.verb}: ${groupName}`),
      html,
      category: "assessment_control_teacher",
      onBehalfOf: organizationId,
      failureNotification: buildFailureNotification(organizationId, {
        title: 'Assessment update email failed',
        body: `The assessment ${msg.verb} email for ${groupName} could not be delivered to ${teacher.email}.`,
      }),
    }, "Assessment Control");
  }
}

/**
 * 4. Build class+subject info for employee invite email.
 */
async function resolveAssignmentNames(database, classIds, subjectIds) {
  let classNames = [];
  let subjectNames = [];

  if (classIds.length) {
    const classResult = await database.query(
      `SELECT class_name FROM classes WHERE class_id = ANY($1::int[]) ORDER BY class_name`,
      [classIds]
    );
    classNames = classResult.rows.map(r => r.class_name);
  }
  if (subjectIds.length) {
    const subjectResult = await database.query(
      `SELECT subject_name FROM subjects WHERE subject_id = ANY($1::int[]) ORDER BY subject_name`,
      [subjectIds]
    );
    subjectNames = subjectResult.rows.map(r => r.subject_name);
  }
  return { classNames, subjectNames };
}

/**
 * 5. Notify staff when their account is placed on hold or resumed.
 */
async function notifyEmployeeOnHoldChange(database, { organizationId, userId, onHold }) {
  const { organizationName } = await getOrganizationSummary(database, organizationId);

  const userResult = await database.query(
    `SELECT first_name, last_name, email FROM users WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId]
  );
  const user = userResult.rows[0];
  if (!user || !user.email) return;
  if (!(await isUserEmailEnabled(database, userId, 'account_hold_or_resume'))) return;

  const status = onHold ? "suspended" : "reactivated";
  const heading = onHold ? "Your account is on hold" : "Your account is active again";
  const html = renderCleanEmail({
    title: heading,
    greeting: greetingFor(user.first_name),
    paragraphs: onHold
      ? [
          `Your Managira account at ${escapeHtml(organizationName)} has been put on hold, so you can't sign in for now.`,
          "If you think this is a mistake, please contact your school administrator.",
        ]
      : [`Your Managira account at ${escapeHtml(organizationName)} is active again. You can sign in as usual.`],
    ...(onHold ? {} : { cta: { text: "Sign in", url: LOGIN_URL } }),
    schoolName: organizationName,
    organizationId,
  });
  sendEmailInBackground({
    to: user.email,
    subject: heading,
    html,
    category: "account_hold_or_resume",
    onBehalfOf: organizationId,
    failureNotification: buildFailureNotification(organizationId, {
      title: 'Account status email failed',
      body: `The account ${status} email for ${user.first_name || 'a staff member'} could not be delivered to ${user.email}.`,
    }),
  }, "Account Hold/Resume");
}

/**
 * 6. Send "application received" confirmation to the parent after public registration.
 */
async function notifyGuardianAdmissionReceived(database, { organizationId, guardianEmail, guardianFirstName, studentName }) {
  if (!guardianEmail) return;
  if (!(await isEmailEnabledForRecipient(database, guardianEmail, 'admission_application_received'))) return;
  // The address was typed on a public form: at most a few confirmations a day reach it, and the
  // email never repeats what was typed (no names), so the form can't be used to mail anyone else.
  if (!require("./humanCheck").emailAllowance(guardianEmail)) return;
  const { organizationName } = await getOrganizationSummary(database, organizationId);

  const html = renderCleanEmail({
    title: "Application received",
    greeting: "Hello,",
    paragraphs: [
      `Thank you for applying to ${escapeHtml(organizationName)}. We received your application, and the school will review it and let you know its decision.`,
    ],
    schoolName: organizationName,
    organizationId,
  });
  sendEmailInBackground({
    to: guardianEmail,
    subject: subjectLine(`Your application to ${organizationName} was received`),
    html,
    category: "admission_application_received",
    onBehalfOf: organizationId,
    failureNotification: buildFailureNotification(organizationId, {
      title: 'Admission confirmation email failed',
      body: `The admission confirmation email for ${studentName} could not be delivered to ${guardianEmail}.`,
    }),
  }, "Admission Confirmation");
}

/**
 * 7. Notify guardian when staff replies to their report.
 */
async function notifyGuardianOnStaffReply(database, { organizationId, reportId, guardianEmail, guardianFirstName, staffName, replyMessage, studentName, reportSubject }) {
  if (!guardianEmail) return;
  if (!(await isEmailEnabledForRecipient(database, guardianEmail, 'staff_reply_to_guardian'))) return;

  // Skip email if there was a guardian reply within the last 20 minutes (active conversation)
  const recentActivity = await database.query(
    `SELECT 1 FROM guardian_report_replies
     WHERE report_id = $1 AND sender_type = 'guardian'
       AND created_at > NOW() - INTERVAL '20 minutes'
     LIMIT 1`,
    [reportId]
  );
  if (recentActivity.rows.length > 0) return;

  const { organizationName } = await getOrganizationSummary(database, organizationId);

  // The member of staff who replied ("Staff" is what the caller says when it has no name).
  const named = String(staffName || "").trim();
  const sender = named && !/^staff$/i.test(named) ? named : "";
  const topic = String(reportSubject || "").trim();
  const html = renderCleanEmail({
    title: sender ? `New reply from ${sender}` : "New reply from the school",
    greeting: greetingFor(guardianFirstName),
    paragraphs: [
      `${sender ? `<strong>${escapeHtml(sender)}</strong>` : "The school"} replied to your message${topic ? ` “${escapeHtml(topic)}”` : ""}${studentName ? ` about ${escapeHtml(studentName)}` : ""}:`,
      quoteHtml(replyMessage),
    ].filter(Boolean),
    cta: { text: "View conversation", url: `${APP_URL}/guardian/reports/${Number(reportId)}` },
    schoolName: organizationName,
    organizationId,
  });
  sendEmailInBackground({
    to: guardianEmail,
    subject: subjectLine(topic ? `New reply: ${topic}` : `New reply from ${sender || "the school"}`),
    html,
    category: "staff_reply_to_guardian",
    onBehalfOf: organizationId,
    failureNotification: buildFailureNotification(organizationId, {
      title: 'Guardian reply email failed',
      body: `The report reply email${studentName ? ` for ${studentName}` : ''} could not be delivered to ${guardianEmail}.`,
    }),
  }, "Staff Reply to Guardian");
}

module.exports = {
  ensureNotificationSchema,
  runAbsenceAlertSweep,
  runWeeklyDigestSweep,
  sendWeeklyHubDigest,
  triggerAbsenceAlertsForStudents,
  notifyStaffOnGuardianReportCreated,
  notifyStaffOnGuardianReply,
  broadcastEventAnnouncement,
  notifyGuardiansOnClassChange,
  notifyTeacherOnReassignment,
  notifyTeachersOnAssessmentControl,
  resolveAssignmentNames,
  notifyEmployeeOnHoldChange,
  notifyGuardianAdmissionReceived,
  notifyGuardianOnStaffReply,
};
