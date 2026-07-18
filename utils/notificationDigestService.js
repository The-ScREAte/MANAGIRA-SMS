const db = require("../config/db");
const {
  sendEmailSafely,
  sendEmailInBackground,
  renderCleanEmail,
  escapeHtml,
} = require("./emailHelper");
const {
  isUserEmailEnabled,
  isGuardianEmailEnabled,
  isHubEmailEnabled,
  isEmailEnabledForRecipient,
  filterEmailsByPreference,
} = require("./emailPreferences");
const { getOrganizationWebsiteInfo } = require("./schoolWebsiteAccess");

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

  const failureNotification = buildFailureNotification(organizationId, {
    title: 'Email delivery failed',
    body: `An email for ${recipientKind || 'a recipient'} could not be delivered to ${recipientEmail}.`,
  });

  const sendOptions = { to: recipientEmail, subject, html, failureNotification };

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
  const result = await database.query(
    `SELECT ar.student_id,
            ROUND(AVG(ar.total_percentage)::numeric, 1) AS avg_score
     FROM assessment_results ar
     JOIN assessments a ON a.assessment_id = ar.assessment_id
     WHERE ar.organization_id = $1
       AND a.term_id = $2
       AND ar.student_id = ANY($3::int[])
       AND ar.total_percentage IS NOT NULL
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

function describeStandingFromPercentile(percentileRank) {
  const p = Number(percentileRank);
  if (!Number.isFinite(p)) return "Assessment profile is still being built";
  if (p <= 0.2) return "Top-performing group in class assessments";
  if (p <= 0.5) return "Strong position in class assessments";
  if (p <= 0.8) return "Steady progress in class assessments";
  return "Building momentum in class assessments";
}

async function getStudentClassStandingMap(database, organizationId, termId, studentIds) {
  if (!termId || !studentIds.length) return new Map();

  const result = await database.query(
    `WITH class_scores AS (
       SELECT s.student_id,
              s.class_id,
              AVG(ar.total_percentage) AS avg_score
       FROM students s
       JOIN assessment_results ar
         ON ar.student_id = s.student_id
        AND ar.organization_id = $1
       JOIN assessments a
         ON a.assessment_id = ar.assessment_id
       WHERE s.organization_id = $1
         AND a.term_id = $2
         AND ar.total_percentage IS NOT NULL
       GROUP BY s.student_id, s.class_id
     ),
     ranked AS (
       SELECT student_id,
              class_id,
              avg_score,
              PERCENT_RANK() OVER (PARTITION BY class_id ORDER BY avg_score DESC) AS percentile_rank
       FROM class_scores
     )
     SELECT student_id, class_id, percentile_rank
     FROM ranked
     WHERE student_id = ANY($3::int[])`,
    [organizationId, termId, studentIds]
  );

  const out = new Map();
  for (const row of result.rows) {
    const studentId = Number(row.student_id);
    const percentileRank = Number(row.percentile_rank);
    out.set(studentId, {
      classId: Number(row.class_id),
      percentileRank,
      standingLabel: describeStandingFromPercentile(percentileRank),
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
     WHERE src.student_id IS NOT NULL`,
    [organizationId]
  );

  const guardianMap = new Map();
  for (const row of result.rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    if (!guardianMap.has(email)) {
      guardianMap.set(email, {
        email,
        firstName: row.first_name || "Parent",
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
      className: row.class_name || "Unassigned class",
    });
  }
  return out;
}

function buildChildrenTableRows(children) {
  if (!children.length) return "<p>No child records were found for this period.</p>";

  const rows = children
    .map((item) => {
      return `<tr>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(item.name)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(item.className)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(item.attendanceSummary || "No attendance marks yet")}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(item.academicStanding || "Assessment profile is still being built")}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(item.weeklyFocus || "Steady routines support progress")}</td>
      </tr>`;
    })
    .join("");

  return `<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">
    <thead>
      <tr>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Child</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Class</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Attendance Snapshot</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Academic Update</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">This Week</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildDigestHighlights(items) {
  const lines = Array.isArray(items)
    ? items.filter((item) => typeof item === "string" && item.trim() !== "")
    : [];

  if (!lines.length) return "";

  return `<ul style="margin:8px 0 0;padding-left:18px;color:#1f2937;font-size:14px;line-height:1.6;">${lines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("")}</ul>`;
}

function buildWeeklyDigestFooterNote() {
  return `<div style="text-align:center;">
    We will update you every step of the way.<br>
    Follow <a href="https://www.linkedin.com/company/managira" target="_blank" rel="noopener" style="color:#0f766e;text-decoration:underline;">Managira</a> for more updates. LinkedIn.<br>
    <strong style="color:#b91c1c;">THIS IS A NO-REPLY MESSAGE. PLEASE DO NOT REPLY TO THIS EMAIL.</strong>
  </div>`;
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

    for (const email of enabledEmails) {
      const eventKey = `${weekStartKey}:${studentId}`;
      const html = renderCleanEmail({
        title: `${organizationName} Attendance Alert`,
        greeting: `Dear Parent/Guardian,`,
        paragraphs: [
          `<strong>${escapeHtml(`${info.firstName} ${info.lastName}`)}</strong> has been marked absent ${toNumber(row.absent_count, 0)} times this week.`,
          `Please contact the school if there is any issue affecting your child's attendance and progress.`,
        ],
        details: [
          { label: "School", value: escapeHtml(organizationName) },
          { label: "Student", value: escapeHtml(`${info.firstName} ${info.lastName}`) },
          { label: "Class", value: escapeHtml(info.className) },
          { label: "Week", value: `${weekStartKey} to ${weekEndKey}` },
          { label: "Absences", value: String(toNumber(row.absent_count, 0)) },
          {
            label: "Attendance",
            value: Number.isFinite(Number(row.attendance_pct))
              ? `${Number(row.attendance_pct).toFixed(1)}%`
              : "N/A",
          },
        ],
        note: "This message is from Managira on behalf of your school.",
      });

      const ok = await sendLoggedEmail(database, {
        organizationId,
        eventType: "parent_absence_threshold",
        eventKey,
        recipientEmail: email,
        recipientKind: "guardian",
        subject: `${organizationName}: Attendance alert for ${info.firstName} ${info.lastName}`,
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
  const rollingStart = new Date(weekStart);
  rollingStart.setDate(rollingStart.getDate() - 14);
  const rollingStartKey = toDateKey(rollingStart);
  const rollingAttendanceMap = await getStudentAttendanceWeekly(
    database,
    organizationId,
    rollingStartKey,
    weekEndKey,
    studentIds
  );
  const currentTermId = await getCurrentTermId(database, organizationId);
  const averageMap = await getStudentTermAverages(database, organizationId, currentTermId, studentIds);
  const classStandingMap = await getStudentClassStandingMap(database, organizationId, currentTermId, studentIds);
  const weeklySignals = await getWeeklySchoolSignals(database, organizationId, weekStartKey, weekEndKey);
  const { organizationName } = await getOrganizationSummary(database, organizationId);

  let sent = 0;
  for (const guardian of guardianMap.values()) {
    const children = [];
    for (const sid of guardian.studentIds) {
      const basic = studentBasics.get(sid);
      if (!basic) continue;
      const attendance = attendanceMap.get(sid) || {};
      const rollingAttendance = rollingAttendanceMap.get(sid) || {};
      const avgScore = averageMap.get(sid);
      const standing = classStandingMap.get(sid);
      const marksCount = toNumber(attendance.marksCount, 0);
      const rollingMarksCount = toNumber(rollingAttendance.marksCount, 0);
      const absentCount = toNumber(attendance.absentCount, 0);
      const rollingAbsentCount = toNumber(rollingAttendance.absentCount, 0);
      const presentCount = toNumber(attendance.presentCount, 0);
      const rollingPresentCount = toNumber(rollingAttendance.presentCount, 0);
      const lateCount = toNumber(attendance.lateCount, 0);
      const rollingLateCount = toNumber(rollingAttendance.lateCount, 0);

      let attendanceSummary = "No attendance marks recorded yet.";
      if (marksCount > 0 && Number.isFinite(Number(attendance.attendancePct))) {
        attendanceSummary = `${Number(attendance.attendancePct).toFixed(1)}% this week (${presentCount} present, ${absentCount} absent${lateCount > 0 ? `, ${lateCount} late` : ""})`;
      } else if (rollingMarksCount > 0 && Number.isFinite(Number(rollingAttendance.attendancePct))) {
        attendanceSummary = `${Number(rollingAttendance.attendancePct).toFixed(1)}% over the last 3 weeks (${rollingPresentCount} present, ${rollingAbsentCount} absent${rollingLateCount > 0 ? `, ${rollingLateCount} late` : ""})`;
      }

      const hasAssessmentSignal = Number.isFinite(Number(avgScore)) || !!standing;
      const academicStanding = standing?.standingLabel
        || (Number.isFinite(Number(avgScore))
          ? `${scoreBand(avgScore, toNumber(policy.good_score_threshold, 60))} assessment trend`
          : "Assessment profile is still being built");

      let weeklyFocus = "We will share new classroom updates as soon as teachers publish them.";
      if (standing && Number.isFinite(standing.percentileRank) && standing.percentileRank <= 0.2) {
        weeklyFocus = "Recent classroom entries place your child in a top-performing group.";
      } else if (weeklySignals.assessmentUpdates > 0 && hasAssessmentSignal) {
        weeklyFocus = "Assessment updates were recorded this week without exposing exact scores.";
      } else if (marksCount > 0) {
        weeklyFocus = "Attendance routines stayed active this week.";
      } else if (rollingMarksCount > 0) {
        weeklyFocus = "No fresh entries this week, so this digest includes a calm 3-week attendance view.";
      }

      children.push({
        name: `${basic.firstName} ${basic.lastName}`,
        className: basic.className,
        marksCount,
        rollingMarksCount,
        absentCount,
        attendancePct: Number(attendance.attendancePct),
        avgScore: Number(avgScore),
        hasAssessmentSignal,
        attendanceSummary,
        academicStanding,
        weeklyFocus,
      });
    }

    if (!children.length) continue;

    const hasCurrentWeekAttendance = children.some((child) => child.marksCount > 0);
    const hasThreeWeekAttendance = children.some((child) => child.rollingMarksCount > 0);
    const hasAssessmentSignals = children.some((child) => child.hasAssessmentSignal);
    const hasSendableActivity =
      hasCurrentWeekAttendance
      || hasThreeWeekAttendance
      || hasAssessmentSignals
      || weeklySignals.assessmentUpdates > 0
      || weeklySignals.communicationUpdates > 0;
    if (!hasSendableActivity) continue;

    const fallbackMode = !hasCurrentWeekAttendance && hasThreeWeekAttendance;

    // Respect this guardian's preference for the weekly parent digest.
    const guardianEnabled = await isEmailEnabledForRecipient(database, guardian.email, 'weekly_parent_digest');
    if (!guardianEnabled) continue;

    children.sort((a, b) => a.name.localeCompare(b.name));

    const digestHighlights = [];
    if (weeklySignals.assessmentUpdates > 0) {
      digestHighlights.push("Assessment activity was recorded this week and reflected in classroom progress insights.");
    }
    if (weeklySignals.communicationUpdates > 0) {
      digestHighlights.push("School communication updates were shared this week.");
    }
    if (fallbackMode) {
      digestHighlights.push(`No fresh attendance entries were recorded this week, so this digest includes context from ${rollingStartKey} to ${weekEndKey}.`);
    }
    if (!digestHighlights.length) {
      digestHighlights.push("No disruptive alerts this week. Continue your current home support routine.");
    }

    const highlightsHtml = `<ul style=\"margin:8px 0 0;padding-left:18px;color:#1f2937;font-size:14px;line-height:1.6;\">${digestHighlights
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("")}</ul>`;

    const html = renderCleanEmail({
      title: `${organizationName} Weekly Parent Digest`,
      greeting: `Hello ${escapeHtml(`${guardian.firstName} ${guardian.lastName}`.trim())},`,
      paragraphs: [
        fallbackMode
          ? `Here is your family progress digest. Because this week had limited classroom updates, we prepared a useful 3-week snapshot (${rollingStartKey} to ${weekEndKey}).`
          : `Here is your weekly summary for all linked children (${weekStartKey} to ${weekEndKey}).`,
        highlightsHtml,
        buildChildrenTableRows(children),
      ],
      details: [
        { label: "School", value: escapeHtml(organizationName) },
        { label: "Children in digest", value: String(children.length) },
        { label: "Assessment updates this week", value: String(weeklySignals.assessmentUpdates) },
        { label: "Messages/announcements this week", value: String(weeklySignals.communicationUpdates) },
        { label: "Digest basis", value: fallbackMode ? "3-week fallback context" : "Current-week updates" },
      ],
      followManagira: false,
      note: buildWeeklyDigestFooterNote(),
      noReply: false,
      schoolWebsiteUrl: websiteInfo.websiteUrl || "",
      schoolWebsiteHost: websiteInfo.websiteHost || "",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_parent_digest",
      eventKey: weekStartKey,
      recipientEmail: guardian.email,
      recipientKind: "guardian",
      subject: `${organizationName} Parent Update`,
      html,
      payload: {
        weekStartKey,
        weekEndKey,
        rollingStartKey,
        childrenCount: children.length,
        fallbackMode,
        assessmentUpdates: weeklySignals.assessmentUpdates,
        communicationUpdates: weeklySignals.communicationUpdates,
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
      avgScore: Number(row.avg_score),
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
    avgScore: Number(row.avg_score),
  }));
}

function buildTeachingUpdateRows(rows) {
  if (!rows.length) {
    return "<p>No subject-level updates were recorded this week.</p>";
  }

  const htmlRows = rows
    .map((row) => {
      const attendanceText = row.marksCount > 0 && Number.isFinite(row.attendancePct)
        ? `${row.attendancePct.toFixed(1)}% (${row.presentCount} present, ${row.absentCount} absent${row.lateCount > 0 ? `, ${row.lateCount} late` : ""})`
        : "No attendance marks this week";
      const performanceText = Number.isFinite(row.avgScore)
        ? `${row.avgScore.toFixed(1)}% average, ${row.band}`
        : `${row.band}`;
      const weeklyFocus = row.absentCount > 0
        ? `${row.absentCount} absence${row.absentCount === 1 ? "" : "s"} recorded this week${row.lateCount > 0 ? `, plus ${row.lateCount} late mark${row.lateCount === 1 ? "" : "s"}` : ""}.`
        : `Steady attendance this week${row.lateCount > 0 ? ` with ${row.lateCount} late mark${row.lateCount === 1 ? "" : "s"}` : ""}.`;

      return `<tr>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(row.className)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(row.subjectName)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${attendanceText}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(performanceText)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(weeklyFocus)}</td>
      </tr>`;
    })
    .join("");

  return `<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">
    <thead>
      <tr>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Class</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Subject</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Attendance Snapshot</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Academic Update</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">This Week</th>
      </tr>
    </thead>
    <tbody>${htmlRows}</tbody>
  </table>`;
}

function buildClassSubjectFeedRows(rows) {
  if (!rows.length) {
    return "<p>No class-wide updates were recorded this week.</p>";
  }

  const htmlRows = rows
    .map((row) => {
      const attendanceText = row.classMarksCount > 0 && Number.isFinite(row.classAttendancePct)
        ? `${row.classAttendancePct.toFixed(1)}% (${row.classPresentCount} present, ${row.classAbsentCount} absent${row.classLateCount > 0 ? `, ${row.classLateCount} late` : ""})`
        : "No attendance marks this week";
      const performanceText = Number.isFinite(row.avgScore)
        ? `${row.avgScore.toFixed(1)}% average, ${row.band}`
        : `${row.band}`;
      const weeklyFocus = row.classAbsentCount > 0
        ? `${row.classAbsentCount} absence${row.classAbsentCount === 1 ? "" : "s"} recorded across the class this week${row.classLateCount > 0 ? `, plus ${row.classLateCount} late mark${row.classLateCount === 1 ? "" : "s"}` : ""}.`
        : `Steady class attendance this week${row.classLateCount > 0 ? ` with ${row.classLateCount} late mark${row.classLateCount === 1 ? "" : "s"}` : ""}.`;

      return `<tr>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(row.className)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(row.subjectName)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${attendanceText}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(performanceText)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(weeklyFocus)}</td>
      </tr>`;
    })
    .join("");

  return `<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">
    <thead>
      <tr>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Class</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Subject</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Attendance Snapshot</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Academic Update</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">This Week</th>
      </tr>
    </thead>
    <tbody>${htmlRows}</tbody>
  </table>`;
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
    if (!classAssignments.length && !teachingAssignments.length) continue;

    const classIds = Array.from(
      new Set([
        ...classAssignments.map((assignment) => assignment.classId),
        ...teachingAssignments.map((assignment) => assignment.classId),
      ])
    );
    if (!classIds.length) continue;

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

    if (!teachingRows.length && !mainClassRows.length) continue;

    const mainClassesWithUpdates = new Set(mainClassRows.map((row) => row.classId)).size;
    const teacherHighlights = [];

    if (teachingRows.length) {
      teacherHighlights.push(`${teachingRows.length} subject update${teachingRows.length === 1 ? "" : "s"} were recorded across your classes this week.`);
    }
    if (mainClassRows.length) {
      teacherHighlights.push(`${mainClassesWithUpdates} main class${mainClassesWithUpdates === 1 ? "" : "es"} had class-wide updates ready for review.`);
    }

    const highestAbsenceRow = [...teachingRows, ...mainClassRows]
      .sort((a, b) => {
        const aAbsences = toNumber(a.absentCount, toNumber(a.classAbsentCount, 0));
        const bAbsences = toNumber(b.absentCount, toNumber(b.classAbsentCount, 0));
        return bAbsences - aAbsences;
      })[0];

    if (highestAbsenceRow) {
      const absenceCount = toNumber(highestAbsenceRow.absentCount, toNumber(highestAbsenceRow.classAbsentCount, 0));
      if (absenceCount > 0) {
        teacherHighlights.push(`${highestAbsenceRow.className} ${highestAbsenceRow.subjectName ? `(${highestAbsenceRow.subjectName}) ` : ""}recorded ${absenceCount} absence${absenceCount === 1 ? "" : "s"} and may need a follow-up.`);
      }
    }

    if (!teacherHighlights.length) {
      teacherHighlights.push("Steady classroom activity was recorded this week.");
    }

    const paragraphs = [
      `Here is your weekly teaching summary (${weekStartKey} to ${weekEndKey}).`,
      buildDigestHighlights(teacherHighlights),
    ];

    if (teachingRows.length) {
      paragraphs.push(`<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Your subject updates</h3>${buildTeachingUpdateRows(teachingRows)}`);
    }

    if (mainClassRows.length) {
      paragraphs.push(`<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Main teacher class feed</h3>${buildClassSubjectFeedRows(mainClassRows)}`);
    }

    const html = renderCleanEmail({
      title: `${organizationName} Weekly Teacher Digest`,
      showTitle: false,
      greeting: `Hello ${escapeHtml(`${teacher.first_name || ""} ${teacher.last_name || ""}`.trim() || "Teacher")},`,
      paragraphs,
      details: [
        { label: "School", value: escapeHtml(organizationName) },
        { label: "Assigned classes", value: String(classIds.length) },
        { label: "Subject updates this week", value: String(teachingRows.length) },
        { label: "Main classes with updates", value: String(mainClassesWithUpdates) },
      ],
      followManagira: false,
      note: buildWeeklyDigestFooterNote(),
      noReply: false,
      schoolWebsiteUrl: websiteInfo.websiteUrl || "",
      schoolWebsiteHost: websiteInfo.websiteHost || "",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_teacher_digest",
      eventKey: `${weekStartKey}:${teacher.user_id}`,
      recipientEmail: teacher.email,
      recipientKind: "teacher",
      subject: `${organizationName} Teachers Update`,
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

function buildRiskRows(risks) {
  if (!risks.length) return "<p>No underperforming students were identified this week.</p>";

  const rows = risks
    .map((risk) => {
      const attendance = Number.isFinite(risk.attendancePct)
        ? `${risk.attendancePct.toFixed(1)}%`
        : "N/A";
      const avgScore = Number.isFinite(risk.avgScore)
        ? `${risk.avgScore.toFixed(1)}%`
        : "N/A";
      const focus = `${risk.reason}. Attendance: ${attendance}. Score: ${avgScore}.`;
      return `<tr>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(risk.studentName)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(risk.className)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(focus)}</td>
      </tr>`;
    })
    .join("");

  return `<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">
    <thead>
      <tr>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Student</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Class</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">This Week</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildSchoolSummaryRows(metrics) {
  if (!metrics.length) return "<p>No school-level metrics were available for this week.</p>";

  const rows = metrics
    .map((metric) => `<tr>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(metric.label)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${metric.value}</td>
      </tr>`)
    .join("");

  return `<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">
    <thead>
      <tr>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Metric</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">This Week</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
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

  const studentsResult = await database.query(
    `SELECT s.student_id, s.first_name, s.last_name, c.class_name
     FROM students s
     LEFT JOIN classes c ON c.class_id = s.class_id
     WHERE s.organization_id = $1`,
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
  const weeklyPresentMarks = toNumber(weeklyAttendanceRes.rows[0]?.present_count, 0);
  const weeklyAbsentMarks = toNumber(weeklyAttendanceRes.rows[0]?.absent_count, 0);
  const weeklyClassesWithMarks = toNumber(weeklyAttendanceRes.rows[0]?.classes_with_marks, 0);
  const weeklyAttendancePct = toNumber(weeklyAttendanceRes.rows[0]?.attendance_pct, NaN);
  const totalClasses = Math.max(0, toNumber(totalClassesRes.rows[0]?.total_classes, 0));

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

    let reason = "";
    if (attendanceRisk && scoreRisk) {
      reason = `Attendance < ${attendanceThreshold}% and score < ${scoreThreshold}%`;
    } else if (attendanceRisk) {
      reason = `Attendance < ${attendanceThreshold}%`;
    } else {
      reason = `Score < ${scoreThreshold}%`;
    }

    risks.push({
      studentName: `${row.first_name || "Student"} ${row.last_name || ""}`.trim(),
      className: row.class_name || "Unassigned class",
      attendancePct,
      avgScore: Number(avgScore),
      reason,
    });
  }

  risks.sort((a, b) => a.className.localeCompare(b.className) || a.studentName.localeCompare(b.studentName));

  if (!weeklyAttendanceMarks && !risks.length) {
    await markDigestRun(database, organizationId, "weekly_manager_digest", weekStartKey);
    return { sent: 0, skipped: true };
  }

  let sent = 0;
  for (const recipient of recipientsResult.rows) {
    // Skip leaders who have opted out of the weekly leadership report.
    if (!(await isUserEmailEnabled(database, recipient.user_id, 'weekly_manager_digest'))) continue;

    const normalizedRole = String(recipient.account_type || '').trim().toLowerCase();
    const isSupervisor = normalizedRole === 'supervisor' || normalizedRole === 'superviser';
    const fullName = `${recipient.first_name || ""} ${recipient.last_name || ""}`.trim() || recipient.account_type;

    if (isSupervisor) {
      const classAssignments = await getUserClassAssignments(database, organizationId, recipient.user_id);
      const teachingAssignments = await getTeachingAssignments(database, organizationId, recipient.user_id);
      const classIds = Array.from(
        new Set([
          ...classAssignments.map((assignment) => assignment.classId),
          ...teachingAssignments.map((assignment) => assignment.classId),
        ])
      );

      if (!classIds.length) continue;

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

      if (!teachingRows.length && !classFeedRows.length) continue;

      const classesWithFeedUpdates = new Set(classFeedRows.map((row) => row.classId)).size;
      const supervisorHighlights = [];

      if (teachingRows.length) {
        supervisorHighlights.push(`${teachingRows.length} subject update${teachingRows.length === 1 ? "" : "s"} were captured in your teaching areas.`);
      }
      if (classFeedRows.length) {
        supervisorHighlights.push(`${classesWithFeedUpdates} assigned class${classesWithFeedUpdates === 1 ? "" : "es"} had wider class-feed updates this week.`);
      }

      const supervisorPeakAbsence = [...teachingRows, ...classFeedRows]
        .sort((a, b) => {
          const aAbsences = toNumber(a.absentCount, toNumber(a.classAbsentCount, 0));
          const bAbsences = toNumber(b.absentCount, toNumber(b.classAbsentCount, 0));
          return bAbsences - aAbsences;
        })[0];

      if (supervisorPeakAbsence) {
        const absenceCount = toNumber(supervisorPeakAbsence.absentCount, toNumber(supervisorPeakAbsence.classAbsentCount, 0));
        if (absenceCount > 0) {
          supervisorHighlights.push(`${supervisorPeakAbsence.className} ${supervisorPeakAbsence.subjectName ? `(${supervisorPeakAbsence.subjectName}) ` : ""}logged ${absenceCount} absence${absenceCount === 1 ? "" : "s"} and is worth checking.`);
        }
      }

      if (!supervisorHighlights.length) {
        supervisorHighlights.push("Fresh class updates were available across your assigned sections this week.");
      }

      const supervisorParagraphs = [
        `Here is your weekly supervisor summary (${weekStartKey} to ${weekEndKey}).`,
        buildDigestHighlights(supervisorHighlights),
      ];

      if (teachingRows.length) {
        supervisorParagraphs.push(`<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Your subject updates</h3>${buildTeachingUpdateRows(teachingRows)}`);
      }

      if (classFeedRows.length) {
        supervisorParagraphs.push(`<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Assigned class feed</h3>${buildClassSubjectFeedRows(classFeedRows)}`);
      }

      const supervisorHtml = renderCleanEmail({
        title: `${organizationName} Weekly Supervisor Digest`,
        showTitle: false,
        greeting: `Hello ${escapeHtml(fullName)},`,
        paragraphs: supervisorParagraphs,
        details: [
          { label: "School", value: escapeHtml(organizationName) },
          { label: "Assigned classes", value: String(classIds.length) },
          { label: "Subject updates this week", value: String(teachingRows.length) },
          { label: "Classes with feed updates", value: String(classesWithFeedUpdates) },
        ],
        followManagira: false,
        note: buildWeeklyDigestFooterNote(),
        noReply: false,
        schoolWebsiteUrl: websiteInfo.websiteUrl || "",
        schoolWebsiteHost: websiteInfo.websiteHost || "",
      });

      const supervisorOk = await sendLoggedEmail(database, {
        organizationId,
        eventType: "weekly_manager_digest",
        eventKey: `${weekStartKey}:${recipient.user_id}`,
        recipientEmail: recipient.email,
        recipientKind: "Supervisor",
        subject: `${organizationName} School Update`,
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
    const studentsAtRiskPct = totalStudents > 0 ? (risks.length / totalStudents) * 100 : 0;
    const classCoveragePct = totalClasses > 0 ? (weeklyClassesWithMarks / totalClasses) * 100 : 0;
    const scoredStudents = studentIds.reduce(
      (count, sid) => count + (Number.isFinite(Number(averageMap.get(sid))) ? 1 : 0),
      0
    );
    const scoredCoveragePct = totalStudents > 0 ? (scoredStudents / totalStudents) * 100 : 0;
    const topRisks = risks.slice(0, 25);

    const managerHighlights = [
      `${weeklyAttendanceMarks} attendance mark${weeklyAttendanceMarks === 1 ? "" : "s"} were logged across ${weeklyClassesWithMarks} class${weeklyClassesWithMarks === 1 ? "" : "es"}.`,
      Number.isFinite(weeklyAttendancePct)
        ? `Overall attendance held at ${weeklyAttendancePct.toFixed(1)}% this week.`
        : "Attendance rate could not be calculated from this week's entries.",
      risks.length > 0
        ? `${risks.length} student${risks.length === 1 ? "" : "s"} crossed the attention threshold and need follow-up.`
        : "No students crossed the attention threshold this week.",
    ];

    const managerParagraphs = [
      `Here is your weekly school summary (${weekStartKey} to ${weekEndKey}).`,
      buildDigestHighlights(managerHighlights),
      `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">School snapshot</h3>${buildSchoolSummaryRows([
        { label: "Attendance entered", value: `${weeklyAttendanceMarks} marks` },
        {
          label: "Attendance rate",
          value: Number.isFinite(weeklyAttendancePct)
            ? `${weeklyAttendancePct.toFixed(1)}% (${weeklyPresentMarks} present, ${weeklyAbsentMarks} absent)`
            : "N/A",
        },
        {
          label: "Class coverage",
          value: `${weeklyClassesWithMarks}/${totalClasses} classes (${classCoveragePct.toFixed(1)}%)`,
        },
        {
          label: "Students at risk",
          value: `${risks.length}/${totalStudents} (${studentsAtRiskPct.toFixed(1)}%)`,
        },
        {
          label: "Students with scored profile",
          value: `${scoredStudents}/${totalStudents} (${scoredCoveragePct.toFixed(1)}%)`,
        },
      ])}`,
    ];

    if (topRisks.length) {
      managerParagraphs.push(`<h3 style="margin:20px 0 6px;font-size:15px;color:#0f172a;">Students needing attention</h3>${buildRiskRows(topRisks)}`);
    } else {
      managerParagraphs.push("No at-risk students were identified this week.");
    }

    const html = renderCleanEmail({
      title: `${organizationName} Weekly Manager Digest`,
      showTitle: false,
      greeting: `Hello ${escapeHtml(fullName)},`,
      paragraphs: managerParagraphs,
      details: [
        { label: "School", value: escapeHtml(organizationName) },
        { label: "Attendance risk threshold", value: `${attendanceThreshold}%` },
        { label: "Score risk threshold", value: `${scoreThreshold}%` },
      ],
      followManagira: false,
      note: buildWeeklyDigestFooterNote(),
      noReply: false,
      schoolWebsiteUrl: websiteInfo.websiteUrl || "",
      schoolWebsiteHost: websiteInfo.websiteHost || "",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_manager_digest",
      eventKey: `${weekStartKey}:${recipient.user_id}`,
      recipientEmail: recipient.email,
      recipientKind: String(recipient.account_type || "Manager"),
      subject: `${organizationName} School Update`,
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

  for (const row of orgResult.rows) {
    const orgId = row.organization_id;
    const parent = await sendWeeklyParentDigestForOrganization(db, orgId, options);
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

function buildHubOrgRows(orgSummaries) {
  if (!orgSummaries.length) return "<p>No member school data available for this week.</p>";

  const rows = orgSummaries
    .map((org) => {
      const attendance = Number.isFinite(org.attendancePct)
        ? `${org.attendancePct.toFixed(1)}% attendance`
        : "N/A";
      const avgScore = Number.isFinite(org.avgScore)
        ? `${org.avgScore.toFixed(1)}% average`
        : "N/A";
      const focus = org.riskCount > 0
        ? `${org.riskCount} at-risk student${org.riskCount === 1 ? "" : "s"} flagged.`
        : "No students flagged this week.";
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(org.orgName)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${org.studentCount}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${attendance}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${avgScore}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(focus)}</td>
      </tr>`;
    })
    .join("");

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">School</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Students</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Attendance Snapshot</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Academic Update</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">This Week</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
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
    // Honor hub administrator's preference for the weekly hub overview.
    if (!(await isHubEmailEnabled(database, hub.hub_id, 'weekly_hub_digest'))) continue;

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
        `SELECT COUNT(*) AS cnt FROM students WHERE organization_id = $1`,
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
      const attendancePct = toNumber(attendanceRes.rows[0]?.attendance_pct, NaN);

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
        avgScore = toNumber(scoreRes.rows[0]?.avg_score, NaN);
      }

      // At-risk student count (attendance < threshold OR score < threshold)
      const attendanceThreshold = toNumber(policy.underperform_attendance_threshold, 70);
      const scoreThreshold = toNumber(policy.underperform_score_threshold, 55);
      let riskCount = 0;

      const allStudentsRes = await database.query(
        `SELECT student_id FROM students WHERE organization_id = $1`,
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

      orgSummaries.push({
        orgName: org.organization_name || "School",
        studentCount,
        staffCount,
        attendanceMarks,
        attendancePct,
        avgScore,
        riskCount,
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

    const hasHubWeeklyActivity = orgSummaries.some((orgSummary) =>
      orgSummary.attendanceMarks > 0 || orgSummary.riskCount > 0
    );
    if (!hasHubWeeklyActivity) {
      await markDigestRun(database, digestRunOrganizationId, hubDigestType, weekStartKey);
      continue;
    }

    const totalStudents = orgSummaries.reduce((sum, o) => sum + o.studentCount, 0);
    const totalStaff = orgSummaries.reduce((sum, o) => sum + o.staffCount, 0);
    const totalRisk = orgSummaries.reduce((sum, o) => sum + o.riskCount, 0);

    const hubName = hub.hub_name || "Hub";
    const fullName = `${hub.first_name || ""} ${hub.last_name || ""}`.trim() || hubName;

    const highestRiskOrg = [...orgSummaries].sort((a, b) => b.riskCount - a.riskCount)[0];
    const strongestAttendanceOrg = [...orgSummaries]
      .filter((orgSummary) => Number.isFinite(orgSummary.attendancePct))
      .sort((a, b) => b.attendancePct - a.attendancePct)[0];

    const hubHighlights = [
      `${orgSummaries.length} member school${orgSummaries.length === 1 ? "" : "s"} contributed data to this week's hub summary.`,
      `${totalStudents} students and ${totalStaff} staff are represented across the hub.`,
      totalRisk > 0
        ? `${totalRisk} student${totalRisk === 1 ? "" : "s"} were flagged across member schools and may need local follow-up.`
        : "No students were flagged across the hub this week.",
    ];

    if (strongestAttendanceOrg) {
      hubHighlights.push(`${strongestAttendanceOrg.orgName} led attendance at ${strongestAttendanceOrg.attendancePct.toFixed(1)}% this week.`);
    }
    if (highestRiskOrg && highestRiskOrg.riskCount > 0) {
      hubHighlights.push(`${highestRiskOrg.orgName} had the highest watch count with ${highestRiskOrg.riskCount} flagged student${highestRiskOrg.riskCount === 1 ? "" : "s"}.`);
    }

    const html = renderCleanEmail({
      title: `${hubName} Weekly Hub Digest`,
      greeting: `Hello ${escapeHtml(fullName)},`,
      paragraphs: [
        `Here is your weekly overview across all member schools (${weekStartKey} to ${weekEndKey}).`,
        buildDigestHighlights(hubHighlights),
        `<h3 style="margin:18px 0 6px;font-size:15px;color:#0f172a;">Member schools</h3>${buildHubOrgRows(orgSummaries)}`,
      ],
      details: [
        { label: "Hub", value: escapeHtml(hubName) },
        { label: "Member schools", value: String(orgSummaries.length) },
        { label: "Total students", value: String(totalStudents) },
        { label: "Total staff", value: String(totalStaff) },
        { label: "At-risk students (across all schools)", value: String(totalRisk) },
      ],
      followManagira: false,
      note: buildWeeklyDigestFooterNote(),
      noReply: false,
    });

    const ok = await sendLoggedEmail(database, {
      organizationId: digestRunOrganizationId,
      eventType: "weekly_hub_digest",
      eventKey: `${hub.hub_id}:${weekStartKey}`,
      recipientEmail: hub.hub_email,
      recipientKind: "hub",
      subject: `${hubName} Hub Update`,
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
      await markDigestRun(database, digestRunOrganizationId, hubDigestType, weekStartKey);
    }
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

  const recipientsRes = await database.query(
    `SELECT u.user_id, u.email, u.first_name, u.last_name, u.account_type
     FROM guardian_report_recipients grr
     JOIN users u ON u.user_id = grr.user_id
     WHERE grr.report_id = $1
       AND u.email IS NOT NULL
       AND TRIM(u.email) <> ''`,
    [reportId]
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
  let sent = 0;

  for (const email of optedIn) {
    const guardianDisplayName = escapeHtml(`${report.guardian_first_name || "Parent"} ${report.guardian_last_name || ""}`.trim());
    const html = renderCleanEmail({
      title: `${organizationName}: New message from a parent/guardian`,
      greeting: `Message from ${guardianDisplayName}:`,
      paragraphs: [
        `A parent/guardian has submitted a new report. Please review the details below and respond through the report workflow.`,
      ],
      details: [
        { label: "Report ID", value: `#${report.report_id}` },
        {
          label: "Student",
          value: escapeHtml(`${report.student_first_name || "Student"} ${report.student_last_name || ""}`.trim()),
        },
        { label: "Guardian", value: guardianDisplayName },
        { label: "Subject", value: escapeHtml(report.subject || "General report") },
        { label: "Message", value: escapeHtml(report.message || "") },
      ],
      note: "Please review and respond in the report workflow.",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "guardian_report_created",
      eventKey: String(report.report_id),
      recipientEmail: email,
      recipientKind: "staff",
      subject: `${organizationName}: New parent report (#${report.report_id})`,
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
    `SELECT report_id, subject, student_id FROM guardian_reports WHERE organization_id = $1 AND report_id = $2 LIMIT 1`,
    [organizationId, reportId]
  );
  if (!reportRes.rows.length) return { sent: 0 };

  const recipientsRes = await database.query(
    `SELECT DISTINCT u.email
     FROM guardian_report_recipients grr
     JOIN users u ON u.user_id = grr.user_id
     WHERE grr.report_id = $1
       AND u.email IS NOT NULL
       AND TRIM(u.email) <> ''`,
    [reportId]
  );

  let recipientRows = recipientsRes.rows;
  if (!recipientRows.length) {
    const fallbackRes = await database.query(
      `SELECT DISTINCT u.email
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

  let sent = 0;
  for (const email of optedIn) {
    const html = renderCleanEmail({
      title: `${organizationName}: New reply from a parent/guardian`,
      greeting: `Reply from a parent/guardian on report #${reportId}:`,
      paragraphs: [
        `A parent/guardian has sent a new reply. Please review the conversation and continue follow-up where needed.`,
      ],
      details: [
        { label: "Report ID", value: `#${reportId}` },
        { label: "Subject", value: escapeHtml(reportRes.rows[0].subject || "General report") },
        { label: "Reply", value: escapeHtml(replyMessage || "") },
      ],
      note: "Please review the conversation and continue follow-up where needed.",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "guardian_report_reply",
      eventKey: String(reportId),
      recipientEmail: email,
      recipientKind: "staff",
      subject: `${organizationName}: New guardian reply on report #${reportId}`,
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

  let staffEmails = [];
  if (includeStaff) {
    const staffResult = await database.query(
      `SELECT DISTINCT LOWER(TRIM(email)) AS email
       FROM users
       WHERE organization_id = $1
         AND COALESCE(on_hold, FALSE) = FALSE
         AND email IS NOT NULL
         AND TRIM(email) <> ''
         AND account_type IN ('Teacher', 'Supervisor', 'Manager')`,
      [organizationId]
    );
    staffEmails = staffResult.rows.map((r) => r.email);
  }

  let guardianEmails = [];
  if (includeParents) {
    const guardianMap = await resolveGuardianLinks(database, organizationId);
    for (const guardian of guardianMap.values()) {
      if (guardian.email) guardianEmails.push(guardian.email);
    }
  }

  const allRecipients = uniqueEmails([...staffEmails, ...guardianEmails]);
  // Filter out anyone who has disabled broadcasts.
  const optedIn = await filterEmailsByPreference(database, allRecipients, 'broadcast_event_or_announcement');
  if (!optedIn.length) return { sent: 0, recipientCount: 0 };

  // --- Build email ---
  const isEvent = contentType === "event";
  const emailTitle = isEvent
    ? `${organizationName}: New Event — ${title}`
    : `${organizationName}: Announcement`;

  const details = [{ label: "School", value: escapeHtml(organizationName) }];
  if (isEvent) {
    details.push({ label: "Event", value: escapeHtml(title || "") });
    if (eventDate) details.push({ label: "Date", value: escapeHtml(eventDate) });
  }
  const audienceLabel = visibility === "org" ? "Internal staff"
    : visibility === "public" ? "Parents / Guardians"
    : "Everyone (staff & parents)";
  details.push({ label: "Audience", value: audienceLabel });

  const greetingText = visibility === "org" ? "Hello Team,"
    : visibility === "public" ? "Dear Parent / Guardian,"
    : "Hello,";

  const html = renderCleanEmail({
    title: isEvent
      ? `${organizationName} Event Notification`
      : `${organizationName} Announcement`,
    greeting: greetingText,
    paragraphs: [
      isEvent
        ? `A new event has been published: <strong>${escapeHtml(title || "")}</strong>.`
        : `A new announcement has been posted by ${escapeHtml(organizationName)}.`,
      escapeHtml(body || ""),
    ],
    details,
    note: "This notification was sent by Managira on behalf of your school.",
  });

  // --- Send ---
  const eventKey = `${contentType}:${contentId || Date.now()}`;
  let sent = 0;

  for (const email of optedIn) {
    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: `broadcast_${contentType}`,
      eventKey,
      recipientEmail: email,
      recipientKind: staffEmails.includes(email) ? "staff" : "guardian",
      subject: emailTitle,
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

  // Gather guardian emails for this student
  const guardiansResult = await database.query(
    `SELECT DISTINCT LOWER(TRIM(email)) AS email, first_name
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
     ) src`,
    [studentId, organizationId]
  );

  for (const row of guardiansResult.rows) {
    if (!row.email) continue;
    if (!(await isEmailEnabledForRecipient(database, row.email, 'student_class_change'))) continue;
    const html = renderCleanEmail({
      title: `${organizationName}: Class Change Notification`,
      greeting: `Dear ${row.first_name || "Parent/Guardian"},`,
      paragraphs: [
        `This is to inform you that <strong>${escapeHtml(studentName)}</strong> has been moved to a new class.`,
      ],
      details: [
        { label: "Student", value: escapeHtml(studentName) },
        { label: "Previous Class", value: escapeHtml(oldClassName) },
        { label: "New Class", value: escapeHtml(newClassName) },
      ],
      note: "If you have questions, please contact the school directly.",
    });
    sendEmailInBackground({
      to: row.email,
      subject: `[${organizationName}] Class Change: ${studentName}`,
      html,
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
  if (addedClasses.length) changes.push(`<strong>Classes added:</strong> ${addedClasses.map(escapeHtml).join(", ")}`);
  if (removedClasses.length) changes.push(`<strong>Classes removed:</strong> ${removedClasses.map(escapeHtml).join(", ")}`);
  if (addedSubjects.length) changes.push(`<strong>Subjects added:</strong> ${addedSubjects.map(escapeHtml).join(", ")}`);
  if (removedSubjects.length) changes.push(`<strong>Subjects removed:</strong> ${removedSubjects.map(escapeHtml).join(", ")}`);

  const html = renderCleanEmail({
    title: `${organizationName}: Assignment Update`,
    greeting: `Hello ${escapeHtml(teacherName)},`,
    paragraphs: [
      "Your class and/or subject assignments have been updated. Here is a summary of the changes:",
      changes.join("<br/>"),
    ],
    details: [
      { label: "Current Classes", value: newClasses.length ? newClasses.map(escapeHtml).join(", ") : "None" },
      { label: "Current Subjects", value: newSubjects.length ? newSubjects.map(escapeHtml).join(", ") : "None" },
    ],
    note: "If you have questions about these changes, please contact your administrator.",
  });
  sendEmailInBackground({
    to: teacherEmail,
    subject: `[${organizationName}] Your Assignments Have Changed`,
    html,
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
  const termName = termResult.rows[0]?.term_name || "Current Term";

  const actionMessages = {
    lock: { verb: "locked", detail: "Scoring is now closed. You can no longer enter or edit scores for this assessment." },
    unlock: { verb: "unlocked", detail: "Scoring is now open. You can enter or update scores for this assessment." },
    activate: { verb: "activated", detail: "This assessment is now active and visible." },
    deactivate: { verb: "deactivated", detail: "This assessment has been deactivated and is no longer visible to staff." },
  };
  const msg = actionMessages[action] || { verb: action, detail: "" };

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
      title: `${organizationName}: Assessment ${msg.verb.charAt(0).toUpperCase() + msg.verb.slice(1)}`,
      greeting: `Hello ${escapeHtml(teacher.first_name || "Teacher")},`,
      paragraphs: [
        `The assessment <strong>${escapeHtml(groupName)}</strong> for <strong>${escapeHtml(termName)}</strong> has been <strong>${msg.verb}</strong>.`,
        msg.detail,
      ],
      details: [
        { label: "Assessment", value: escapeHtml(groupName) },
        { label: "Term", value: escapeHtml(termName) },
        { label: "Status", value: msg.verb.charAt(0).toUpperCase() + msg.verb.slice(1) },
      ],
      note: "Log in to your Managira dashboard for more details.",
    });
    sendEmailInBackground({
      to: teacher.email,
      subject: `[${organizationName}] Assessment ${msg.verb}: ${groupName}`,
      html,
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
  const html = renderCleanEmail({
    title: `${organizationName}: Account ${onHold ? "Suspended" : "Reactivated"}`,
    greeting: `Hello ${escapeHtml(user.first_name || "Staff")},`,
    paragraphs: onHold
      ? [
          `Your account at <strong>${escapeHtml(organizationName)}</strong> has been placed on hold.`,
          "While on hold, you will not be able to log in or access the system. If you believe this is an error, please contact your administrator.",
        ]
      : [
          `Your account at <strong>${escapeHtml(organizationName)}</strong> has been reactivated.`,
          "You can now log in and access the system as usual.",
        ],
    details: [
      { label: "Account Status", value: onHold ? "On Hold" : "Active" },
    ],
    note: onHold
      ? "Contact your school administrator if you need assistance."
      : "Welcome back! Log in to your Managira dashboard to continue.",
  });
  sendEmailInBackground({
    to: user.email,
    subject: `[${organizationName}] Account ${status}`,
    html,
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
  const { organizationName } = await getOrganizationSummary(database, organizationId);

  const html = renderCleanEmail({
    title: `${organizationName}: Application Received`,
    greeting: `Dear ${escapeHtml(guardianFirstName || "Parent/Guardian")},`,
    paragraphs: [
      `Thank you for submitting an application for <strong>${escapeHtml(studentName)}</strong> to <strong>${escapeHtml(organizationName)}</strong>.`,
      "Your application has been received and is now under review. The school will contact you once a decision has been made.",
    ],
    details: [
      { label: "Student", value: escapeHtml(studentName) },
      { label: "School", value: escapeHtml(organizationName) },
      { label: "Status", value: "Under Review" },
    ],
    note: "You will receive another email when your application is approved or if additional information is needed.",
  });
  sendEmailInBackground({
    to: guardianEmail,
    subject: `[${organizationName}] Application Received for ${studentName}`,
    html,
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

  const html = renderCleanEmail({
    title: `${organizationName}: New Reply on Your Report`,
    greeting: `Dear ${escapeHtml(guardianFirstName || "Parent/Guardian")},`,
    paragraphs: [
      `<strong>${escapeHtml(staffName)}</strong> has replied to your report${studentName ? ` regarding <strong>${escapeHtml(studentName)}</strong>` : ""}.`,
      `<em>"${escapeHtml(replyMessage)}"</em>`,
    ],
    details: [
      { label: "Report", value: escapeHtml(reportSubject || `Report #${reportId}`) },
      { label: "Reply From", value: escapeHtml(staffName) },
    ],
    note: "Log in to your Parent Portal to view the full conversation and respond.",
  });
  sendEmailInBackground({
    to: guardianEmail,
    subject: `[${organizationName}] Reply on report: ${reportSubject || "Your Report"}`,
    html,
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
