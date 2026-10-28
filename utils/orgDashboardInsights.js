// Numbers, alerts and recent activity for the org dashboard (views/common/orgDashboard.ejs).
// Each widget is gated by the viewer's permissions and plan features, and every
// query is best-effort: a failing widget is simply left out, never the page.
const {
  normalizeCurrencyCode,
  getCurrencyForCountry,
  getLocaleForCurrency,
  formatCurrencyAmount,
} = require("./currencyLocalization");

const PLATFORM_ROLES = ["admin", "internal worker", "mini admin"];
const CLOSED_BILL_STATUSES = ["cancelled", "canceled", "void", "voided", "waived"];

const safe = (promise) => Promise.resolve(promise).catch(() => null);

function resolveCurrency(organizationCurrency, organizationCountry) {
  const code =
    normalizeCurrencyCode(organizationCurrency) ||
    normalizeCurrencyCode(getCurrencyForCountry(String(organizationCountry || "").trim().toUpperCase())) ||
    "USD";
  const locale = getLocaleForCurrency(code);
  return (value) => formatCurrencyAmount(Number(value) || 0, code, locale);
}

/**
 * @param {object} db
 * @param {object} opts
 * @param {number} opts.organizationId
 * @param {number} opts.termId
 * @param {Array}  opts.classes          classes shown on the dashboard (with employees)
 * @param {string[]} opts.permissions    res.locals.userPermissions
 * @param {string[]} opts.features       res.locals.allowedFeatures
 * @param {boolean} opts.termActive      today falls inside the term
 * @param {boolean} opts.isSchoolDay     today counts for attendance
 * @param {string}  opts.todayKey        YYYY-MM-DD
 * @param {string}  opts.todayLabel      e.g. "Weekend"
 */
async function loadOrgDashboardInsights(db, opts) {
  const {
    organizationId,
    termId,
    classes = [],
    permissions = [],
    features = [],
    termActive = false,
    isSchoolDay = false,
    todayKey,
    todayLabel = "",
    role = "",
    actorId = 0,
  } = opts;
  const roleKey = String(role || "").trim().toLowerCase();
  // Recent activity is role based: managers see everyone, supervisors see everyone
  // except managers, everyone else sees only their own actions.
  const activityScope = ["manager", "organization", "org_admin"].includes(roleKey)
    ? "all"
    : (["supervisor", "superviser"].includes(roleKey) ? "no-managers" : "mine");

  const can = (key) => permissions.includes(key);
  const hasFeature = (...names) => names.some((name) => features.includes(name));
  const classIds = classes.map((cls) => Number(cls.class_id)).filter(Number.isInteger);

  const show = {
    staff: can("manage_employees"),
    admissions: can("approve_admissions") && hasFeature("Student and Guardian Profile", "Student and Guadian Profile"),
    attendance: can("mark_attendance") && hasFeature("Attendance Tracking", "Attendance tracking feature") && termActive && classIds.length > 0,
    fees: can("manage_paygira") && hasFeature("PayGira"),
    activity: activityScope !== "mine" || Number(actorId) > 0,
    // School-wide transport is for managers and supervisors, not teachers/drivers.
    transport: can("manage_students") && activityScope !== "mine",
    assessments: can("manage_assessments") && hasFeature("Assessment Tracking", "Assessment tracking feature") && classIds.length > 0,
  };

  const [staff, admissions, attendanceRows, fees, overdue, activity, org, assessmentRows, transport, myTasks] = await Promise.all([
    show.staff
      ? safe(db.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE reset_password_token IS NOT NULL)::int AS pending,
                  COUNT(*) FILTER (WHERE COALESCE(on_hold, FALSE))::int AS on_hold
             FROM users
            WHERE organization_id = $1
              AND LOWER(COALESCE(account_type::text, '')) <> ALL($2::text[])`,
          [organizationId, PLATFORM_ROLES]
        ).then((r) => r.rows[0]))
      : null,
    show.admissions
      ? safe(db.query(`SELECT COUNT(*)::int AS n FROM pending_students WHERE organization_id = $1 AND status = 'pending'`, [organizationId]).then((r) => r.rows[0].n))
      : null,
    show.attendance && isSchoolDay
      ? safe(db.query(
          `SELECT DISTINCT class_id FROM attendance_records
            WHERE organization_id = $1 AND date = $2::date AND class_id = ANY($3::int[])`,
          [organizationId, todayKey, classIds]
        ).then((r) => r.rows))
      : null,
    show.fees
      ? safe(db.query(
          `SELECT COALESCE(SUM(a.amount), 0)::float AS billed,
                  COALESCE(SUM(a.amount_paid), 0)::float AS paid
             FROM finance_bill_assignments a
             JOIN finance_bills b ON b.bill_id = a.bill_id
            WHERE a.organization_id = $1 AND b.term_id = $2
              AND LOWER(COALESCE(a.status, '')) <> ALL($3::text[])`,
          [organizationId, termId, CLOSED_BILL_STATUSES]
        ).then((r) => r.rows[0]))
      : null,
    show.fees
      ? safe(db.query(
          `SELECT COUNT(DISTINCT student_id)::int AS n
             FROM finance_bill_assignments
            WHERE organization_id = $1 AND status = 'overdue'`,
          [organizationId]
        ).then((r) => r.rows[0].n))
      : null,
    show.activity
      ? safe(db.query(
          `SELECT user_name, user_role, module_name, action_type, description, created_at
             FROM organization_activity_logs
            WHERE organization_id = $1
              AND COALESCE(module_name, '') <> 'Authentication'
              AND COALESCE(action_type, '') NOT IN ('Login', 'Logout')
              AND (
                $2 = 'all'
                OR ($2 = 'no-managers' AND COALESCE(user_role, '') NOT IN ('Manager', 'Organization', 'Admin'))
                OR ($2 = 'mine' AND user_id = $3)
              )
            ORDER BY created_at DESC
            LIMIT 6`,
          [organizationId, activityScope, Number(actorId) || 0]
        ).then((r) => r.rows))
      : null,
    show.fees
      ? safe(db.query(`SELECT organization_currency, organization_country FROM organizations WHERE organization_id = $1`, [organizationId]).then((r) => r.rows[0]))
      : null,
    // Assessments past their due date (or due within 7 days) that have no scores yet.
    show.assessments
      ? safe(db.query(
          `SELECT a.class_id, a.subject_id, c.class_name, s.subject_name,
                  COUNT(*) FILTER (WHERE a.edit_window_end < NOW())::int AS overdue,
                  COUNT(*) FILTER (WHERE a.edit_window_end >= NOW())::int AS due_soon
             FROM assessments a
             JOIN classes c ON c.class_id = a.class_id
             LEFT JOIN subjects s ON s.subject_id = a.subject_id
            WHERE a.organization_id = $1
              AND a.term_id = $2
              AND a.class_id = ANY($3::int[])
              AND COALESCE(a.is_active, TRUE)
              AND a.edit_window_end IS NOT NULL
              AND a.edit_window_end < NOW() + INTERVAL '7 days'
              AND NOT EXISTS (SELECT 1 FROM assessment_results r WHERE r.assessment_id = a.assessment_id)
            GROUP BY a.class_id, a.subject_id, c.class_name, s.subject_name
            ORDER BY c.class_name, s.subject_name`,
          [organizationId, termId, classIds]
        ).then((r) => r.rows))
      : null,
    show.transport
      ? safe(db.query(
          `SELECT
             (SELECT COUNT(*)::int FROM transport_buses WHERE organization_id = $1) AS buses,
             (SELECT COUNT(*)::int FROM transport_buses WHERE organization_id = $1 AND LOWER(COALESCE(status, '')) = 'maintenance') AS in_maintenance,
             (SELECT COUNT(*)::int FROM transport_buses b
                WHERE b.organization_id = $1
                  AND LOWER(COALESCE(b.status, '')) <> 'maintenance'
                  AND b.driver_user_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM transport_drivers d WHERE d.organization_id = b.organization_id AND d.assigned_bus_id = b.bus_id)) AS no_driver,
             (SELECT COUNT(*)::int FROM transport_routes WHERE organization_id = $1 AND LOWER(COALESCE(route_status, 'active')) = 'active') AS routes,
             (SELECT COUNT(DISTINCT student_id)::int FROM transport_student_assignments WHERE organization_id = $1 AND COALESCE(active, TRUE)) AS riders,
             (SELECT COUNT(*)::int FROM transport_trip_sessions
                WHERE organization_id = $1 AND status = 'active' AND ended_at IS NULL
                  AND started_at >= NOW() - INTERVAL '12 hours') AS on_road`,
          [organizationId]
        ).then((r) => r.rows[0]))
      : null,
    Number(actorId) > 0
      ? safe(db.query(
          `SELECT COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE)::int AS overdue,
                  COUNT(*) FILTER (WHERE t.due_date = CURRENT_DATE)::int AS today
             FROM org_tasks t JOIN org_task_assignees a ON a.task_id = t.task_id
            WHERE t.organization_id = $1 AND a.user_id = $2 AND a.status = 'open' AND t.due_date IS NOT NULL`,
          [organizationId, Number(actorId)]
        ).then((r) => r.rows[0]))
      : null,
  ]);

  const kpis = [];
  const attention = [];

  if (staff) {
    if (staff.pending) attention.push({ tone: "amber", icon: "fa-envelope-open-text", text: `${staff.pending} staff member${staff.pending === 1 ? " hasn't" : "s haven't"} set a password yet`, href: "/common/management", action: "View staff" });
    if (staff.on_hold) attention.push({ tone: "red", icon: "fa-user-lock", text: `${staff.on_hold} staff account${staff.on_hold === 1 ? " is" : "s are"} on hold`, href: "/common/management", action: "Review" });
  }

  if (Number.isInteger(admissions)) {
    kpis.push({ key: "admissions", icon: "fa-inbox", value: admissions.toLocaleString("en-US"), label: "Admissions waiting", note: admissions ? "Ready for review" : "Nothing to review", href: "/common/admissions" });
    if (admissions) attention.push({ tone: "blue", icon: "fa-inbox", text: `${admissions} admission${admissions === 1 ? "" : "s"} waiting for review`, href: "/common/admissions", action: "Review" });
  }

  if (show.attendance) {
    if (!isSchoolDay) {
      kpis.push({ key: "attendance", icon: "fa-clipboard-check", value: "—", label: "Attendance today", note: `${todayLabel || "No school"} · nothing to mark` });
    } else if (Array.isArray(attendanceRows)) {
      const marked = new Set(attendanceRows.map((row) => Number(row.class_id)));
      const missing = classes.filter((cls) => !marked.has(Number(cls.class_id)));
      kpis.push({ key: "attendance", icon: "fa-clipboard-check", value: `${marked.size}/${classIds.length}`, label: "Attendance today", note: missing.length ? `${missing.length} class${missing.length === 1 ? "" : "es"} not marked` : "Every class is marked" });
      if (missing.length) {
        attention.push({
          tone: "amber",
          icon: "fa-clipboard-check",
          text: `${missing.length} class${missing.length === 1 ? " hasn't" : "es haven't"} marked attendance today`,
          links: missing.slice(0, 12).map((cls) => ({ label: cls.class_name, href: `/common/attendanceCollection?classId=${cls.class_id}&termId=${termId}` })),
        });
      }
    }
  }

  if (fees) {
    const money = resolveCurrency(org?.organization_currency, org?.organization_country);
    const rate = fees.billed > 0 ? Math.round((fees.paid / fees.billed) * 100) : null;
    kpis.push({ key: "fees", icon: "fa-wallet", value: money(fees.paid), label: "Fees collected this term", note: rate === null ? "No bills this term" : `${rate}% of ${money(fees.billed)} billed`, href: "/account/settings/finance", progress: rate });
  }
  if (transport && (transport.buses || transport.routes)) {
    const parts = [`${transport.routes} route${transport.routes === 1 ? "" : "s"}`, `${transport.riders} rider${transport.riders === 1 ? "" : "s"}`];
    if (transport.on_road) parts.push(`${transport.on_road} on the road now`);
    kpis.push({ key: "transport", icon: "fa-bus", value: `${transport.buses} bus${transport.buses === 1 ? "" : "es"}`, label: "Transport", note: parts.join(" · "), href: "/transportation/manage" });
    if (transport.no_driver) {
      attention.push({ tone: "amber", icon: "fa-bus", text: `${transport.no_driver} bus${transport.no_driver === 1 ? " has" : "es have"} no driver assigned`, note: transport.in_maintenance ? `${transport.in_maintenance} more in maintenance` : "", href: "/transportation/manage", action: "Assign" });
    }
  }

  if (Number.isInteger(overdue) && overdue > 0) {
    attention.push({ tone: "red", icon: "fa-triangle-exclamation", text: `${overdue} student${overdue === 1 ? " has" : "s have"} overdue fees`, href: "/account/settings/finance/arrears", action: "View arrears" });
  }

  if (Array.isArray(assessmentRows) && assessmentRows.length) {
    const chip = (row) => ({
      label: [row.class_name, row.subject_name].filter(Boolean).join(" · "),
      href: `/common/assessment?classId=${row.class_id}&subjectId=${row.subject_id}&termId=${termId}`,
    });
    const late = assessmentRows.filter((row) => row.overdue > 0);
    const soon = assessmentRows.filter((row) => row.due_soon > 0);
    const lateCount = late.reduce((sum, row) => sum + row.overdue, 0);
    const soonCount = soon.reduce((sum, row) => sum + row.due_soon, 0);
    if (lateCount) {
      attention.push({ tone: "red", icon: "fa-pen-to-square", text: `${lateCount} assessment${lateCount === 1 ? " is" : "s are"} past due with no scores`, links: late.slice(0, 8).map(chip), more: Math.max(0, late.length - 8) });
    }
    if (soonCount) {
      attention.push({ tone: "blue", icon: "fa-hourglass-half", text: `${soonCount} assessment${soonCount === 1 ? " is" : "s are"} due in the next 7 days`, links: soon.slice(0, 8).map(chip), more: Math.max(0, soon.length - 8) });
    }
  }

  const noTeacher = classes.filter((cls) => !(cls.employees || []).some((emp) => emp && emp.name && String(emp.name).trim()));
  if (show.staff && noTeacher.length) {
    attention.push({ tone: "amber", icon: "fa-chalkboard-user", text: `${noTeacher.length} class${noTeacher.length === 1 ? " has" : "es have"} no teacher assigned`, note: noTeacher.slice(0, 6).map((cls) => cls.class_name).join(", ") + (noTeacher.length > 6 ? "…" : ""), href: "/common/management", action: "Assign" });
  }

  if (myTasks && myTasks.overdue) {
    attention.push({ tone: "red", icon: "fa-list-check", text: `${myTasks.overdue} of your task${myTasks.overdue === 1 ? " is" : "s are"} overdue`, href: "/common/orgDashboard#tasks", action: "View tasks" });
  }
  if (myTasks && myTasks.today) {
    attention.push({ tone: "blue", icon: "fa-list-check", text: `${myTasks.today} task${myTasks.today === 1 ? " is" : "s are"} due today`, href: "/common/orgDashboard#tasks", action: "View tasks" });
  }

  const order = { red: 0, amber: 1, blue: 2 };
  attention.sort((a, b) => order[a.tone] - order[b.tone]);

  const anyAttentionSource = true;

  return {
    kpis,
    attention: anyAttentionSource ? attention : null,
    activity: Array.isArray(activity) ? activity : null,
    activityScope,
  };
}

module.exports = { loadOrgDashboardInsights };
