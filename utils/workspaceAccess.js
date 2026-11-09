// Which workspace menus (Management Tools, Reports, Admissions) and items a
// person gets. Each item mirrors the guard on the page it opens, so a menu
// never offers a page that would send them away, and a menu with no items for
// this person stays out of the hamburger.
const FULL_MENU_ROLES = new Set(["organization", "admin", "mini admin", "manager", "supervisor", "superviser"]);
const MANAGER_ROLES = new Set(["organization", "admin", "mini admin", "manager"]);

function workspaceAccess({ permissions, features, role } = {}) {
  const granted = new Set((Array.isArray(permissions) ? permissions : []).map((key) => String(key || "").trim().toLowerCase()));
  const plan = new Set((Array.isArray(features) ? features : []).map((name) => String(name || "").trim().toLowerCase()));
  const can = (...keys) => keys.some((key) => granted.has(key));
  const hasFeature = (...names) => names.some((name) => plan.has(name.toLowerCase()));
  const hasProfile = hasFeature("Student and Guardian Profile", "Student and Guadian Profile");
  const hasAssessments = hasFeature("Assessment Tracking", "Assessment tracking feature");
  const hasTermReports = hasFeature("Terminal Report", "Progressive Student Report");
  const fullMenuRole = FULL_MENU_ROLES.has(String(role || "").trim().toLowerCase());

  const management = {
    schoolYears: can("manage_records", "manage_school_year_terms"),
    classes: can("manage_classes_subjects"),
    assessments: can("manage_assessments") && hasAssessments,
    questions: can("set_assessment_questions") && hasFeature("Set Assessment Questions", "Assessment Questions"),
    enrollment: can("students_enrollment") && hasProfile,
    promotion: can("approve_promotions"),
    employees: can("manage_employees"),
    guardians: can("manage_guardians") && hasProfile,
    // The contact template moved to Admissions > Admission Settings (Parents & guardians).
    contactTemplate: false,
    transportation: can("manage_transportation"),
    mira: can("settings_mira"),
    events: can("publish_events_announcements"),
    activities: can("publish_events_announcements"),
    website: can("settings_website") && hasFeature("School Website", "SchoolWebsite", "Public Website", "PublicWebsite"),
    docs: (fullMenuRole || can("manage_records")) && hasFeature("Create Files", "Files & Sheets", "Docs/Sheets"),
    paygira: can("paygira_workspace") && can("paygira_show_in_management") && hasFeature("PayGira", "Pay Gira", "PayGira & Payments", "PayGira and Payments"),
    integrations: can("settings_integrations"),
    serviceAccounts: can("settings_service_accounts"),
    emailIssues: fullMenuRole,
  };
  const reports = {
    stats: can("manage_records") && hasFeature("Organization Analytics & Insights"),
    terminal: can("reports_terminal", "manage_school_year_terms") && hasTermReports,
    transcripts: can("generate_transcripts") && hasFeature("Official School Transcript"),
    settings: can("reports_settings") && hasTermReports,
    builder: can("reports_builder"),
  };
  const admissions = {
    students: can("manage_students") && hasProfile,
    addStudent: can("students_add") && hasProfile,
    alumni: can("students_alumni") && hasProfile,
    applications: can("approve_admissions") && hasProfile && hasFeature("School Website", "SchoolWebsite"),
    graduation: can("manage_school_year_terms") && hasProfile,
    // Admission Settings: online admission and student fields, and the parents and guardians fields.
    settings: can("settings_admissions", "edit_contact_template") && hasProfile,
  };
  // Each PayGira page, and what can be done on it.
  const inMain = (...keys) => can("paygira_workspace") && can(...keys);
  const paygira = {
    overview: inMain("paygira_overview"),
    bills: inMain("paygira_bills"),
    students: inMain("paygira_org_bills"),
    subscriptions: inMain("paygira_subscriptions"),
    payments: inMain("paygira_payments", "paygira_record_payments", "paygira_delete_payments"),
    arrears: inMain("paygira_recovery"),
    payouts: inMain("paygira_payouts"),
    settings: inMain("paygira_settings"),
  };
  const anyOf = (items) => Object.values(items).some(Boolean);
  return {
    management: { ...management, any: anyOf(management) },
    reports: { ...reports, any: anyOf(reports) },
    admissions: { ...admissions, any: anyOf(admissions) },
    transport: {
      buses: can("transport_buses"),
      drivers: can("transport_drivers"),
      routes: can("transport_routes"),
      schedules: can("transport_schedules"),
      students: can("transport_students", "transport_student_routes"),
      riderList: can("transport_students"),
      studentRoutes: can("transport_student_routes", "transport_students"),
      reports: can("transport_reports"),
      classReports: can("transport_class_reports", "transport_reports"),
      settings: can("transport_settings"),
    },
    driver: { website: can("driver_school_website") && hasFeature("School Website", "SchoolWebsite") },
    events: { announcements: can("events_announcements"), events: can("events_events") },
    employees: { canAdd: can("employees_add"), canEdit: can("employees_edit"), canRemove: can("employees_remove"), canChangeManagers: MANAGER_ROLES.has(String(role || "").trim().toLowerCase()) },
    students: { canAdd: can("students_add"), canEdit: can("students_edit"), canDelete: can("students_delete") },
    settings: {
      profile: can("settings_profile"),
      integrations: can("settings_integrations"),
      serviceAccounts: can("settings_service_accounts"),
    },
    paygira: {
      ...paygira,
      any: anyOf(paygira),
            canDeleteBills: inMain("paygira_bills") && inMain("paygira_delete_bills"),
      canSeePayments: inMain("paygira_payments"),
      canRecordPayments: inMain("paygira_record_payments"),
      canCorrectPayments: inMain("paygira_delete_payments"),
    },
  };
}

// The permissions that open each workspace's own page; the items above decide
// what is listed once inside.
const WORKSPACE_PERMISSIONS = {
  reports: ["reports_terminal", "reports_settings", "reports_builder", "manage_school_year_terms", "generate_transcripts", "manage_records"],
  admissions: ["manage_students", "approve_admissions", "manage_school_year_terms", "settings_admissions", "edit_contact_template"],
};

module.exports = { workspaceAccess, WORKSPACE_PERMISSIONS };
