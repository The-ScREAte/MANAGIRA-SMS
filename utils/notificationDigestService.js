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
      sent_at TIMESTAMP,
      UNIQUE (event_type, event_key, recipient_email)
    )
  `);

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
     ON CONFLICT (event_type, event_key, recipient_email) DO NOTHING
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

  if (background) {
    sendEmailInBackground({ to: recipientEmail, subject, html }, context || eventType);
    await markDispatchSent(database, dispatchId);
    return true;
  }

  const sent = await sendEmailSafely({ to: recipientEmail, subject, html }, context || eventType);
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
      const attendance = Number.isFinite(item.attendancePct)
        ? `${item.attendancePct.toFixed(1)}%`
        : "N/A";
      const score = Number.isFinite(item.avgScore)
        ? `${item.avgScore.toFixed(1)}%`
        : "N/A";
      return `<tr>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(item.name)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(item.className)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${item.absentCount}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${attendance}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${score}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(item.scoreBand)}</td>
      </tr>`;
    })
    .join("");

  return `<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">
    <thead>
      <tr>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Child</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Class</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Absences (week)</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Attendance</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Avg Score</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Performance</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
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

  // Global temporary rule: all weekly digests are sent on Saturday.
  if (nowDate.getDay() !== GLOBAL_DIGEST_WEEKDAY) return false;
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

  let sent = 0;
  for (const guardian of guardianMap.values()) {
    const children = [];
    for (const sid of guardian.studentIds) {
      const basic = studentBasics.get(sid);
      if (!basic) continue;
      const attendance = attendanceMap.get(sid) || {};
      const avgScore = averageMap.get(sid);
      children.push({
        name: `${basic.firstName} ${basic.lastName}`,
        className: basic.className,
        absentCount: toNumber(attendance.absentCount, 0),
        attendancePct: Number(attendance.attendancePct),
        avgScore: Number(avgScore),
        scoreBand: scoreBand(avgScore, toNumber(policy.good_score_threshold, 60)),
      });
    }

    if (!children.length) continue;

    // Respect this guardian's preference for the weekly parent digest.
    const guardianEnabled = await isEmailEnabledForRecipient(database, guardian.email, 'weekly_parent_digest');
    if (!guardianEnabled) continue;

    children.sort((a, b) => a.name.localeCompare(b.name));

    const html = renderCleanEmail({
      title: `${organizationName} Weekly Parent Digest`,
      greeting: `Hello ${escapeHtml(`${guardian.firstName} ${guardian.lastName}`.trim())},`,
      paragraphs: [
        `Here is your weekly summary for all linked children (${weekStartKey} to ${weekEndKey}).`,
        buildChildrenTableRows(children),
      ],
      details: [
        { label: "School", value: escapeHtml(organizationName) },
        { label: "Children in digest", value: String(children.length) },
      ],
      note: "This message is sent by Managira for your school.",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_parent_digest",
      eventKey: weekStartKey,
      recipientEmail: guardian.email,
      recipientKind: "guardian",
      subject: `${organizationName} weekly summary for your child's progress`,
      html,
      payload: { weekStartKey, weekEndKey, childrenCount: children.length },
      context: "Weekly Parent Digest",
    });

    if (ok) sent += 1;
  }

  await markDigestRun(database, organizationId, "weekly_parent_digest", weekStartKey);
  return { sent };
}

async function getTeacherAssignments(database, organizationId, teacherId) {
  const result = await database.query(
    `SELECT uc.class_id,
            c.class_name,
            us.subject_id,
            s.subject_name
     FROM user_classes uc
     JOIN classes c ON c.class_id = uc.class_id
     JOIN user_subjects us ON us.user_id = uc.user_id
     JOIN subjects s ON s.subject_id = us.subject_id AND s.class_id = uc.class_id
     WHERE uc.user_id = $1
       AND c.organization_id = $2
     ORDER BY c.class_name, s.subject_name`,
    [teacherId, organizationId]
  );

  return result.rows.map((row) => ({
    classId: Number(row.class_id),
    className: row.class_name,
    subjectId: Number(row.subject_id),
    subjectName: row.subject_name,
  }));
}

function buildTeacherSectionsRows(sections) {
  if (!sections.length) {
    return "<p>No class/subject assignments with data were found for this week.</p>";
  }

  const rows = sections
    .map((sec) => {
      const attendance = Number.isFinite(sec.attendancePct)
        ? `${sec.attendancePct.toFixed(1)}%`
        : "N/A";
      const avgScore = Number.isFinite(sec.avgScore)
        ? `${sec.avgScore.toFixed(1)}%`
        : "N/A";
      return `<tr>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(sec.className)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(sec.subjectName)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${attendance}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${avgScore}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(sec.band)}</td>
      </tr>`;
    })
    .join("");

  return `<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">
    <thead>
      <tr>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Class</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Subject</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Attendance</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Avg Score</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Rating</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
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

    const assignments = await getTeacherAssignments(database, organizationId, teacher.user_id);
    if (!assignments.length) continue;

    const sections = [];
    for (const assignment of assignments) {
      const attendanceResult = await database.query(
        `SELECT ROUND(
                 100.0 * COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'present')
                 / NULLIF(COUNT(*), 0),
                 1
               ) AS attendance_pct
         FROM attendance_records
         WHERE organization_id = $1
           AND class_id = $2
           AND date BETWEEN $3::date AND $4::date`,
        [organizationId, assignment.classId, weekStartKey, weekEndKey]
      );

      let avgScore = null;
      if (termId) {
        const scoreResult = await database.query(
          `SELECT ROUND(AVG(ar.total_percentage)::numeric, 1) AS avg_score
           FROM assessment_results ar
           JOIN assessments a ON a.assessment_id = ar.assessment_id
           WHERE ar.organization_id = $1
             AND a.term_id = $2
             AND a.class_id = $3
             AND a.subject_id = $4
             AND ar.total_percentage IS NOT NULL`,
          [organizationId, termId, assignment.classId, assignment.subjectId]
        );
        avgScore = toNumber(scoreResult.rows[0]?.avg_score, NaN);
      }

      const attendancePct = toNumber(attendanceResult.rows[0]?.attendance_pct, NaN);
      sections.push({
        className: assignment.className,
        subjectName: assignment.subjectName,
        attendancePct,
        avgScore,
        band: scoreBand(avgScore, toNumber(policy.good_score_threshold, 60)),
      });
    }

    const html = renderCleanEmail({
      title: `${organizationName} Weekly Teaching Digest`,
      greeting: `Hello ${escapeHtml(`${teacher.first_name || ""} ${teacher.last_name || ""}`.trim() || "Teacher")},`,
      paragraphs: [
        `Here is your weekly teaching digest (${weekStartKey} to ${weekEndKey}) for your assigned classes and subjects.`,
        buildTeacherSectionsRows(sections),
      ],
      details: [
        { label: "School", value: escapeHtml(organizationName) },
        { label: "Assignments in digest", value: String(sections.length) },
      ],
      note: "This report is generated by Managira using your class and subject assignments.",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_teacher_digest",
      eventKey: `${weekStartKey}:${teacher.user_id}`,
      recipientEmail: teacher.email,
      recipientKind: "teacher",
      subject: `${organizationName} weekly classroom summary`,
      html,
      payload: { weekStartKey, weekEndKey, teacherId: teacher.user_id, sectionCount: sections.length },
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
      return `<tr>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(risk.studentName)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(risk.className)}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${attendance}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${avgScore}</td>
        <td style=\"padding:8px;border-bottom:1px solid #e5e7eb;\">${escapeHtml(risk.reason)}</td>
      </tr>`;
    })
    .join("");

  return `<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">
    <thead>
      <tr>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Student</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Class</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Attendance</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Avg Score</th>
        <th style=\"text-align:left;padding:8px;border-bottom:2px solid #d1d5db;\">Risk Trigger</th>
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

  let sent = 0;
  for (const recipient of recipientsResult.rows) {
    // Skip leaders who have opted out of the weekly leadership report.
    if (!(await isUserEmailEnabled(database, recipient.user_id, 'weekly_manager_digest'))) continue;

    const fullName = `${recipient.first_name || ""} ${recipient.last_name || ""}`.trim() || recipient.account_type;
    const html = renderCleanEmail({
      title: `${organizationName} Weekly Leadership Report`,
      greeting: `Hello ${escapeHtml(fullName)},`,
      paragraphs: [
        `Weekly risk summary (${weekStartKey} to ${weekEndKey}) for classes and students under your oversight.`,
        buildRiskRows(risks),
      ],
      details: [
        { label: "School", value: escapeHtml(organizationName) },
        { label: "Underperforming students", value: String(risks.length) },
        { label: "Attendance risk threshold", value: `${attendanceThreshold}%` },
        { label: "Score risk threshold", value: `${scoreThreshold}%` },
      ],
      note: "This summary is generated by Managira to support timely intervention.",
    });

    const ok = await sendLoggedEmail(database, {
      organizationId,
      eventType: "weekly_manager_digest",
      eventKey: `${weekStartKey}:${recipient.user_id}`,
      recipientEmail: recipient.email,
      recipientKind: String(recipient.account_type || "Manager"),
      subject: `${organizationName} weekly leadership summary`,
      html,
      payload: { weekStartKey, weekEndKey, riskCount: risks.length },
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
        ? `${org.attendancePct.toFixed(1)}%`
        : "N/A";
      const avgScore = Number.isFinite(org.avgScore)
        ? `${org.avgScore.toFixed(1)}%`
        : "N/A";
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(org.orgName)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${org.studentCount}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${org.staffCount}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${attendance}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${avgScore}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${org.riskCount}</td>
      </tr>`;
    })
    .join("");

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">School</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Students</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Staff</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Avg Attendance</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Avg Score</th>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">At-Risk Students</th>
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

    for (const org of orgsResult.rows) {
      const policy = await getPolicy(database, org.organization_id);
      if (policy.enable_weekly_hub_digest === false) continue;
      anyDigestEnabled = true;

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
        `SELECT ROUND(
                 100.0 * COUNT(*) FILTER (WHERE LOWER(COALESCE(status::text, '')) = 'present')
                 / NULLIF(COUNT(*), 0),
                 1
               ) AS attendance_pct
         FROM attendance_records
         WHERE organization_id = $1
           AND date BETWEEN $2::date AND $3::date`,
        [org.organization_id, weekStartKey, weekEndKey]
      );
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
        attendancePct,
        avgScore,
        riskCount,
      });
    }

    if (!anyDigestEnabled || !orgSummaries.length) continue;
    if (!weekStartKey) continue;

    // Check Saturday + dedup via digest run for hub
    const zonedNow = nowInTimeZone(now, "UTC");
    if (!options.force) {
      if (zonedNow.getDay() !== GLOBAL_DIGEST_WEEKDAY) continue;

      const existing = await database.query(
        `SELECT 1 FROM notification_digest_runs
         WHERE organization_id = $1 AND digest_type = $2 AND week_start_date = $3::date LIMIT 1`,
        [hub.hub_id, "weekly_hub_digest", weekStartKey]
      );
      if (existing.rows.length) continue;
    }

    const totalStudents = orgSummaries.reduce((sum, o) => sum + o.studentCount, 0);
    const totalStaff = orgSummaries.reduce((sum, o) => sum + o.staffCount, 0);
    const totalRisk = orgSummaries.reduce((sum, o) => sum + o.riskCount, 0);

    const hubName = hub.hub_name || "Hub";
    const fullName = `${hub.first_name || ""} ${hub.last_name || ""}`.trim() || hubName;

    const html = renderCleanEmail({
      title: `${hubName} Weekly Hub Overview`,
      greeting: `Hello ${escapeHtml(fullName)},`,
      paragraphs: [
        `Here is your weekly overview across all member schools (${weekStartKey} to ${weekEndKey}).`,
        buildHubOrgRows(orgSummaries),
      ],
      details: [
        { label: "Hub", value: escapeHtml(hubName) },
        { label: "Member schools", value: String(orgSummaries.length) },
        { label: "Total students", value: String(totalStudents) },
        { label: "Total staff", value: String(totalStaff) },
        { label: "At-risk students (across all schools)", value: String(totalRisk) },
      ],
      note: "This summary is generated by Managira for hub-level oversight.",
    });

    // Use hub_id as a pseudo organization_id for dispatch logging.
    const ok = await sendLoggedEmail(database, {
      organizationId: hub.hub_id,
      eventType: "weekly_hub_digest",
      eventKey: weekStartKey,
      recipientEmail: hub.hub_email,
      recipientKind: "hub",
      subject: `${hubName} weekly hub summary`,
      html,
      payload: { weekStartKey, weekEndKey, orgCount: orgSummaries.length, totalStudents, totalRisk },
      context: "Weekly Hub Digest",
    });

    if (ok) {
      sent += 1;
      // Record digest run (use hub_id; digest_runs table allows any int for org_id column).
      await database.query(
        `INSERT INTO notification_digest_runs (organization_id, digest_type, week_start_date)
         VALUES ($1, $2, $3::date)
         ON CONFLICT (organization_id, digest_type, week_start_date) DO NOTHING`,
        [hub.hub_id, "weekly_hub_digest", weekStartKey]
      );
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
    sendEmailInBackground({ to: row.email, subject: `[${organizationName}] Class Change: ${studentName}`, html }, "Class Change Notification");
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
  sendEmailInBackground({ to: teacherEmail, subject: `[${organizationName}] Your Assignments Have Changed`, html }, "Teacher Reassignment");
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
    sendEmailInBackground({ to: teacher.email, subject: `[${organizationName}] Assessment ${msg.verb}: ${groupName}`, html }, "Assessment Control");
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
  sendEmailInBackground({ to: user.email, subject: `[${organizationName}] Account ${status}`, html }, "Account Hold/Resume");
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
  sendEmailInBackground({ to: guardianEmail, subject: `[${organizationName}] Application Received for ${studentName}`, html }, "Admission Confirmation");
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
  sendEmailInBackground({ to: guardianEmail, subject: `[${organizationName}] Reply on report: ${reportSubject || "Your Report"}`, html }, "Staff Reply to Guardian");
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
