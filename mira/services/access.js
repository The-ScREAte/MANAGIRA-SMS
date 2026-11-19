// Who may use which tool. Mira works with each person's own permissions:
// the main app works out what they hold (GET /internal/api/mira/access, the
// same userHasPermission the pages use), and this file says which permission
// each tool needs. Tools a person can't use are never offered, a call to one
// is refused here before anything runs, and the person is told plainly which
// permission they're missing - or that their school's plan doesn't include it.
const { callInternalApi } = require("../internalApiClient");

const P = {
  employees: "manage_employees", employeesAdd: "employees_add", employeesRemove: "employees_remove",
  students: "manage_students", studentsAdd: "students_add", enrollment: "students_enrollment", alumni: "students_alumni",
  guardians: "manage_guardians", contacts: "see_contacts",
  classes: "manage_classes_subjects", assessments: "manage_assessments", questions: "set_assessment_questions",
  attendance: "mark_attendance", records: "manage_records", yearsTerms: "manage_school_year_terms",
  admissions: "approve_admissions", promotions: "approve_promotions",
  terminal: "reports_terminal", reportBuilder: "reports_builder", reportSettings: "reports_settings",
  announcements: "events_announcements", events: "events_events", publish: "publish_events_announcements",
  mailroom: "mailroom",
  transport: "manage_transportation", buses: "transport_buses", drivers: "transport_drivers", routes: "transport_routes",
  schedules: "transport_schedules", riders: "transport_students", riderRoutes: "transport_student_routes",
  orgBills: "paygira_org_bills", payments: "paygira_payments",
  profile: "settings_profile", website: "settings_website", integrations: "settings_integrations", sso: "manage_sso",
  customForms: "custom_forms",
};

const ELEVATED_ROLES = new Set(["organization", "manager", "supervisor", "admin", "mini admin"]);

// tool -> { anyOf?: [permission], allOf?: [permission], roles?: "elevated", feature?: key }
// Mira is for staff only (parents and students are refused before any of
// this, see middleware/requireMiraActivated.js). Every tool is listed: one
// with no rule here is refused (tests/actions.test.js checks each has one).
const rules = {};
const need = (permissions, tools, extra = {}) => tools.forEach((tool) => { rules[tool] = { anyOf: [].concat(permissions), ...extra }; });

// Students, guardians and contacts
need(P.students, ["find_student", "list_students"]);
need(P.studentsAdd, ["check_student_duplicates", "create_students"]);
need([P.students, P.attendance], ["get_attendance"]);
need([P.orgBills, P.payments], ["get_fees"]);
need([P.contacts, P.guardians, P.mailroom], ["find_contact"]);
need([P.guardians, P.contacts], ["get_guardian_details"]);
need([P.mailroom, P.guardians, P.contacts], ["draft_message"]);
need(P.mailroom, ["draft_family_messages"], { feature: "mira_outreach" });
need(P.alumni, ["list_archived_students", "unarchive_students"]);
rules.find_low_attendance = { allOf: [P.reportBuilder, P.attendance], feature: "mira_outreach" };
// Forms & requests: the same people as the staff Forms page (the server keeps teachers to their classes).
need([P.customForms, P.students], ["get_form_requests", "remind_form_outstanding"], { feature: "mira_forms" });
// Admissions
need(P.admissions, ["list_pending_admissions", "get_pending_admission_details", "update_pending_admission", "approve_pending_admission", "reject_pending_admission"]);
// Assessments
need(P.assessments, ["list_assessments", "create_test", "modify_test", "delete_test", "set_test_status", "set_test_date_window", "list_question_sets", "list_question_set_students"]);
need(P.questions, ["set_test_questions", "delete_question_set", "review_question_set", "reuse_question_set", "set_student_assessment_status", "get_attempt_for_grading", "save_attempt_grade", "show_work_to_parents"]);
need([P.assessments, P.questions], ["post_question_set_scores", "unpost_question_set_scores"]);
// Report cards, merit sheets and report settings
need(P.terminal, ["generate_report_pdf", "post_or_send_report_cards", "get_merit_sheet", "generate_merit_sheet_pdf", "generate_report_card_summary"]);
need(P.reportSettings, ["get_report_settings", "set_report_card_display_options", "set_grading_scale_band", "delete_grading_scale_band", "list_remarks", "add_remark", "delete_remark", "set_promotion_settings"]);
// Report Builder
need(P.reportBuilder, ["report_builder_catalog", "run_report", "list_saved_reports", "save_report", "delete_saved_report", "share_saved_report", "schedule_saved_report", "favorite_saved_report", "export_report", "import_report_template"]);
// Statistics
need(P.records, ["get_organization_statistics", "compare_classes"]);
// School years, classes, subjects, enrollment and promotions
need(P.yearsTerms, ["create_school_year", "rename_school_year", "delete_school_year", "add_term_to_school_year", "delete_term", "get_close_group_candidates", "close_graduation_year_group"]);
need(P.classes, ["create_classes", "rename_class", "delete_class", "reorder_classes", "create_subject", "assign_subject_to_classes", "rename_subject", "delete_subject", "create_graduation_year_group", "rename_graduation_year_group", "delete_graduation_year_group"]);
need([P.students, P.enrollment], ["list_enrollments", "get_enrollment_roster"]);
need(P.enrollment, ["set_enrollment_roster", "delete_enrollment"]);
need(P.promotions, ["list_promotion_schedules", "get_promotion_preview", "schedule_promotion", "apply_scheduled_promotion", "cancel_scheduled_promotion", "reverse_promotion", "delete_reversed_promotion"]);
// Staff
need(P.employees, ["list_employees"]);
need(P.employeesAdd, ["create_employee"]);
need(P.employeesRemove, ["set_employee_hold"]);
// Transportation
need(P.transport, ["list_transport_buses", "list_transport_drivers", "list_transport_routes", "list_transport_stops", "list_transport_schedules"]);
need(P.buses, ["create_transport_bus", "set_transport_bus_status", "delete_transport_bus"]);
need(P.drivers, ["create_transport_driver", "set_transport_driver_status", "delete_transport_driver"]);
need(P.routes, ["create_transport_route", "set_transport_route_status", "delete_transport_route", "create_transport_stop", "delete_transport_stop"]);
need(P.schedules, ["create_transport_schedule", "set_transport_schedule_status", "delete_transport_schedule"]);
need([P.riders, P.riderRoutes], ["assign_student_transportation", "remove_student_transportation"]);
need([P.transport, P.students], ["get_student_transportation", "get_transportation_live_status"]);
// Events, announcements and messages
need(P.events, ["list_events", "create_event", "update_event", "delete_event"]);
need(P.announcements, ["list_school_announcements", "create_school_announcement", "update_school_announcement", "delete_school_announcement"]);
need(P.publish, ["create_announcement"]);
need(P.mailroom, ["send_message", "list_sent_messages"]);
need(P.profile, ["set_organization_notification_preferences"]);
// Email delivery problems: managers and supervisors, as on the Email Issues page.
["list_failed_emails", "check_email_availability", "fix_failed_email"].forEach((tool) => { rules[tool] = { roles: "elevated" }; });
// Website and settings
need(P.website, ["list_website_gallery_images", "list_website_articles", "get_website_about_us", "get_website_settings", "upload_website_image", "update_website_image", "delete_website_image", "create_website_article", "update_website_article", "delete_website_article", "update_website_about_us", "set_website_layout", "set_website_theme", "set_website_self_enrollment", "update_website_section", "list_website_messages"]);
need(P.profile, ["get_school_customization", "update_school_profile", "set_school_font", "set_display_preferences", "set_school_nickname", "set_student_id_settings"]);
need(P.integrations, ["get_integrations_status"]);
need(P.sso, ["get_sso_status"]);

// Open to every member of staff: their own calendar, documents, notification choices and
// feedback, and school structure; the page each one calls keeps teachers to their classes.
[
  "get_my_calendar", "get_calendar_sync_status", "add_to_my_calendar", "find_free_time", "whats_new",
  "list_activities", "create_activity", "get_bus_riding_today", "get_class", "get_term", "list_projects",
  "list_school_years", "list_subjects", "list_graduation_year_groups", "list_documents", "get_document",
  "create_document", "set_document_title", "set_document_text", "set_sheet_cells", "resize_sheet",
  "insert_class_data_into_sheet", "share_document_with_user", "remove_document_share", "assign_document_to_class",
  "unassign_document_from_class", "delete_document", "get_upcoming_birthdays", "get_notification_preferences",
  "set_notification_preferences", "submit_feedback",
].forEach((tool) => { if (!rules[tool]) rules[tool] = { open: true }; });

// Read tools that belong to a feature of their own (hidden where it's off).
const READ_TOOL_FEATURES = {
  get_gpa: ["gpa"], get_lunch: ["class_lunch"], list_custom_forms: ["custom_forms"], get_form_answers: ["custom_forms"],
  get_briefing: ["weekly_briefing"], get_class_settings: ["class_settings"],
};
// Read tools whose pages a driver never opens (the server refuses them too).
const NOT_FOR_DRIVERS = new Set([
  "search_records", "get_student_profile", "get_staff_profile", "get_class_staff", "get_family", "list_family_invitations",
  "get_scores", "get_report_card_status", "get_transcript", "get_gpa", "get_lunch", "get_attendance_summary",
  "list_custom_forms", "get_form_answers", "get_tasks", "get_activity_log", "get_class_settings", "get_parent_messages",
  "get_briefing", "get_announcement_reads", "get_student_ledger", "get_overdue_balances", "list_bills", "find_students", "get_class_readiness",
]);
// Read tools (tools/read/) carry their own rule: the page's permissions.
require("../tools/read").tools.forEach((tool) => {
  if (rules[tool.name]) throw new Error(`${tool.name} has two access rules`);
  rules[tool.name] = tool.access;
  // The read tools are released together (mira_read_more), each also needing its own area's feature.
  const own = READ_TOOL_FEATURES[tool.name] || [];
  rules[tool.name] = { ...tool.access, notDrivers: NOT_FOR_DRIVERS.has(tool.name) || tool.access.notDrivers, features: [...new Set(["mira_read_more", ...own, ...[].concat(tool.access.features || [], tool.access.feature || [])])] };
  delete rules[tool.name].feature;
});

const TOOL_ACCESS = rules;

// ---- The person's access, from the main app, kept briefly ----
const ACCESS_TTL_MS = 60 * 1000;
const ACCESS_CACHE_MAX = 2000;
const accessCache = new Map();

function cacheKey(tenant) {
  return [tenant.organizationId, tenant.viewerType, tenant.userId, tenant.userRole, tenant.accountType].join(":");
}

async function loadAccess(tenant) {
  const key = cacheKey(tenant);
  const cached = accessCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value;
  try {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId), viewerType: tenant.viewerType || "staff" });
    if (tenant.viewerType === "staff") {
      params.set("userId", String(tenant.userId || ""));
      params.set("userRole", tenant.userRole || "");
      params.set("accountType", tenant.accountType || "");
      params.set("userEmail", tenant.userEmail || "");
    }
    const result = await callInternalApi(`/internal/api/mira/access?${params}`);
    value = {
      ok: true,
      held: new Set(result.held || []),
      notInPlan: new Set(result.notInPlan || []),
      labels: new Map((result.permissions || []).map((p) => [p.key, p.label])),
      permissions: result.permissions || [],
      classes: Array.isArray(result.classes) ? result.classes : null,
      features: result.features || {},
    };
  } catch (error) {
    // Unknown access is no access: lookups and actions wait until it can be read.
    console.error("[mira/access] could not load this person's access:", error.message);
    return { ok: false, held: new Set(), notInPlan: new Set(), labels: new Map(), permissions: [], classes: null, features: {} };
  }
  if (accessCache.size >= ACCESS_CACHE_MAX) accessCache.delete(accessCache.keys().next().value);
  accessCache.set(key, { value, expiresAt: Date.now() + ACCESS_TTL_MS });
  return value;
}

function isElevated(tenant) {
  return [tenant.userRole, tenant.accountType].some((role) => ELEVATED_ROLES.has(String(role || "").trim().toLowerCase()));
}

const label = (access, key) => access.labels.get(key) || key;
const listOf = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`);

// { allowed: true } or { allowed: false, reason } - the reason is said to the person as is.
function checkTool(name, tenant, access) {
  const rule = TOOL_ACCESS[name];
  if ((tenant.viewerType || "staff") !== "staff") {
    return { allowed: false, reason: "Mira is available to school staff only." };
  }
  // Unknown access refuses: a tool without a rule never runs.
  if (!rule) return { allowed: false, reason: "I can't do that from Mira yet." };
  // Every feature the rule names must be on for the school (rule.feature, rule.features).
  const needs = [].concat(rule.features || [], rule.feature || []);
  if (needs.some((key) => !access.features?.[key])) {
    return { allowed: false, reason: "This isn't available for your school yet." };
  }
  // Drivers hold only driving: tools that never serve a driver aren't offered to one.
  if (rule.notDrivers && String(tenant.userRole || tenant.accountType || "").trim().toLowerCase() === "driver") {
    return { allowed: false, reason: rule.reason || "Drivers can see their own routes and riders in Mira, not this." };
  }
  if (!rule.anyOf && !rule.allOf && !rule.roles) return { allowed: true };
  if (!access.ok) {
    return { allowed: false, reason: "I couldn't check your permissions just now, so I haven't done this. Please try again in a moment." };
  }
  if (rule.roles === "elevated" && !isElevated(tenant)) {
    return { allowed: false, reason: rule.reason || "Only managers and supervisors can see or fix email delivery problems." };
  }
  const missingAll = (rule.allOf || []).filter((key) => !access.held.has(key));
  const anyOk = !rule.anyOf || rule.anyOf.some((key) => access.held.has(key));
  if (!missingAll.length && anyOk) return { allowed: true };

  const needed = missingAll.length ? missingAll : rule.anyOf;
  if (needed.every((key) => access.notInPlan.has(key))) {
    return { allowed: false, reason: `Your school's plan doesn't include ${listOf(needed.map((key) => label(access, key)))}, so this isn't available.` };
  }
  const names = needed.map((key) => `**${label(access, key)}**`);
  // allOf: every one is needed ("A and B permissions"); anyOf: any one would do ("A or B permission").
  const what = missingAll.length > 1
    ? `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} permissions`
    : `the ${listOf(names)} permission`;
  return {
    allowed: false,
    reason: `You don't have ${what}, so I can't do this for you. A manager at your school can give it to you in Users / Employees.`,
  };
}

// For the model: who this is, what they can and can't do. Short, and only
// what changes how Mira answers.
function describeAccess(tenant, access) {
  if (!access.ok) {
    return "Their permissions couldn't be read just now. Don't look anything up or change anything this turn; say you couldn't check their permissions and ask them to try again in a moment.";
  }
  // Driver-only permissions mean nothing to anyone else, so only drivers hear about them.
  const isDriver = [tenant.userRole, tenant.accountType].some((role) => String(role || "").trim().toLowerCase() === "driver");
  const top = access.permissions.filter((p) => !p.parent && (isDriver || p.group !== "Driver"));
  const shortLabel = (p) => String(p.label).split(": ").pop();
  const childrenHeld = (key) => access.permissions.filter((p) => p.parent === key && access.held.has(p.key)).map(shortLabel);
  // What they hold, with the parts of it they hold; what they don't, with what it would cover.
  const held = top.filter((p) => access.held.has(p.key)).map((p) => {
    const parts = childrenHeld(p.key);
    return parts.length ? `${p.label} (${parts.join(", ")})` : p.label;
  });
  const describe = (p) => (p.description ? `${p.label} - ${p.description}` : p.label);
  const notHeld = top.filter((p) => !access.held.has(p.key) && !access.notInPlan.has(p.key)).map(describe);
  const notInPlan = top.filter((p) => access.notInPlan.has(p.key)).map((p) => p.label);
  const parts = [
    `Permissions ${tenant.displayName} holds: ${held.length ? held.join("; ") : "none beyond using Mira"}.`,
    notHeld.length ? `They do NOT have (tell them so at once if a request needs one of these): ${notHeld.join("; ")}.` : "",
    notInPlan.length ? `Not in the school's plan: ${notInPlan.join(", ")}.` : "",
    access.classes ? (access.classes.length ? `They work with these classes only: ${access.classes.join(", ")}.` : "They aren't assigned to any class.") : "",
    "When asked what they can do, use these permission names as given - don't add abilities that aren't listed.",
  ];
  return parts.filter(Boolean).join(" ");
}

// For Settings: what Mira can do for them, and what isn't part of their access.
function accessSummary(tenant, access) {
  if (!access.ok) return { ok: false, can: [], cannot: [], classes: null };
  const isDriver = [tenant.userRole, tenant.accountType].some((role) => String(role || "").trim().toLowerCase() === "driver");
  const top = access.permissions.filter((p) => !p.parent && (isDriver || p.group !== "Driver"));
  return {
    ok: true,
    can: top.filter((p) => access.held.has(p.key)).map((p) => p.label),
    cannot: top.filter((p) => !access.held.has(p.key)).map((p) => p.label),
    classes: access.classes,
  };
}

module.exports = { TOOL_ACCESS, loadAccess, checkTool, describeAccess, accessSummary, isElevated };
