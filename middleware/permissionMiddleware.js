const db = require("../config/db");
const cacheManager = require("../utils/cacheManager");
const { resolvePlanForOrganization } = require("../utils/accessCache");

const PERMISSION_CACHE_TTL_SEC = Number(process.env.PERMISSION_CACHE_TTL_SEC || 90);
const PERMISSIONS_DDL_LOGS_ENABLED = String(process.env.LOG_PERMISSION_DDL || "").trim().toLowerCase() === "true";

const MANAGER_LIKE_ROLES = new Set(["organization", "admin", "mini admin"]);

const PERMISSIONS = {
  MANAGE_EMPLOYEES: "manage_employees",
  MANAGE_STUDENTS: "manage_students",
  MANAGE_GUARDIANS: "manage_guardians",
  MANAGE_ASSESSMENTS: "manage_assessments",
  SET_ASSESSMENT_QUESTIONS: "set_assessment_questions",
  MARK_ATTENDANCE: "mark_attendance",
  MANAGE_REPORTS: "manage_reports",
  MANAGE_RECORDS: "manage_records",
  MANAGE_PROMOTIONS: "manage_promotions",
  APPROVE_PROMOTIONS: "approve_promotions",
  APPROVE_ADMISSIONS: "approve_admissions",
  PUBLISH_EVENTS_ANNOUNCEMENTS: "publish_events_announcements",
  MANAGE_SCHOOL_YEAR_TERMS: "manage_school_year_terms",
  ASSESS_OTHER_SCHOOL_YEARS: "assess_other_school_years",
  MANAGE_CLASSES_SUBJECTS: "manage_classes_subjects",
  GENERATE_TRANSCRIPTS: "generate_transcripts",
  MANAGE_BILLING: "manage_billing",
  MANAGE_SETTINGS: "manage_settings",
  MANAGE_PAYGIRA: "manage_paygira",
  EMPLOYEES_ADD: "employees_add",
  EMPLOYEES_EDIT: "employees_edit",
  EMPLOYEES_REMOVE: "employees_remove",
  STUDENTS_ADD: "students_add",
  STUDENTS_EDIT: "students_edit",
  STUDENTS_DELETE: "students_delete",
  STUDENTS_ENROLLMENT: "students_enrollment",
  STUDENTS_ALUMNI: "students_alumni",
  MANAGE_TRANSPORTATION: "manage_transportation",
  TRANSPORT_BUSES: "transport_buses",
  TRANSPORT_DRIVERS: "transport_drivers",
  TRANSPORT_ROUTES: "transport_routes",
  TRANSPORT_SCHEDULES: "transport_schedules",
  TRANSPORT_STUDENTS: "transport_students",
  TRANSPORT_SETTINGS: "transport_settings",
  TRANSPORT_STUDENT_ROUTES: "transport_student_routes",
  TRANSPORT_REPORTS: "transport_reports",
  TRANSPORT_CLASS_REPORTS: "transport_class_reports",
  DRIVER_LEAD: "driver_lead",
  DRIVER_REPORT_BUILDER: "driver_report_builder",
  DRIVER_SCHOOL_WEBSITE: "driver_school_website",
  DRIVER_STUDENT_DETAILS: "driver_student_details",
  DRIVER_ANY_ROUTE: "driver_any_route",
  DRIVER_FAMILY_DETAILS: "driver_family_details",
  REPORTS_TERMINAL: "reports_terminal",
  REPORTS_SETTINGS: "reports_settings",
  REPORTS_BUILDER: "reports_builder",
  EVENTS_ANNOUNCEMENTS: "events_announcements",
  EVENTS_EVENTS: "events_events",
  SETTINGS_PROFILE: "settings_profile",
  SETTINGS_WEBSITE: "settings_website",
  SETTINGS_INTEGRATIONS: "settings_integrations",
  SETTINGS_MIRA: "settings_mira",
  SETTINGS_SERVICE_ACCOUNTS: "settings_service_accounts",
  MANAGE_SSO: "manage_sso",
  SETTINGS_ADMISSIONS: "settings_admissions",
  PAYGIRA_CLASSROOM: "paygira_classroom",
  PAYGIRA_WORKSPACE: "paygira_workspace",
  PAYGIRA_SHOW_IN_MANAGEMENT: "paygira_show_in_management",
  PAYGIRA_OVERVIEW: "paygira_overview",
  PAYGIRA_BILLS: "paygira_bills",
  PAYGIRA_DELETE_BILLS: "paygira_delete_bills",
  PAYGIRA_ORG_BILLS: "paygira_org_bills",
  PAYGIRA_SUBSCRIPTIONS: "paygira_subscriptions",
  PAYGIRA_PAYMENTS: "paygira_payments",
  PAYGIRA_RECORD_PAYMENTS: "paygira_record_payments",
  PAYGIRA_DELETE_PAYMENTS: "paygira_delete_payments",
  PAYGIRA_RECOVERY: "paygira_recovery",
  PAYGIRA_PAYOUTS: "paygira_payouts",
  PAYGIRA_SETTINGS: "paygira_settings",
  MAILROOM: "mailroom",
  SEE_CONTACTS: "see_contacts",
  EDIT_CONTACTS: "edit_contacts",
  EDIT_CONTACT_TEMPLATE: "edit_contact_template",
  USE_MIRA: "use_mira",
};

// Not a PERMISSION_OPTIONS entry (so it never renders as its own checkbox) —
// it's an internal marker stored alongside "mailroom" in user_permissions to
// record that an employee's mailroom access is unrestricted (every guardian
// contact org-wide), vs. scoped to just the classes in user_mailroom_classes.
const MAILROOM_ALL_ACCESS_KEY = "mailroom_all_access";

// Also internal: stored whenever the form saves someone, so their rows are read
// exactly as ticked. Anyone without it was saved before follow-ups existed, or
// never saved (see expandUnsavedPermissions).
const PERMISSIONS_SAVED_KEY = "permissions_saved";

// Shown in this order, one per line, under their group. "parent" makes a
// follow-up that only appears (and only counts) once its main permission is on.
const PERMISSION_OPTIONS = [
  { key: PERMISSIONS.MANAGE_EMPLOYEES, label: "Users / Employees", group: "People", highRisk: true, forLeadDrivers: true, description: "See the staff list. Choose what else they can do below" },
  { key: PERMISSIONS.EMPLOYEES_ADD, label: "Add Staff", parent: PERMISSIONS.MANAGE_EMPLOYEES, description: "Create new staff accounts" },
  { key: PERMISSIONS.EMPLOYEES_EDIT, label: "Edit Staff & Access", parent: PERMISSIONS.MANAGE_EMPLOYEES, highRisk: true, description: "Change staff details, roles, classes and permissions" },
  { key: PERMISSIONS.EMPLOYEES_REMOVE, label: "Hold & Remove Staff", parent: PERMISSIONS.MANAGE_EMPLOYEES, highRisk: true, description: "Put staff on hold, remove them or bring them back" },
  { key: PERMISSIONS.MANAGE_STUDENTS, label: "Manage Students", group: "People", description: "See the student list. Choose what else they can do below" },
  { key: PERMISSIONS.STUDENTS_ADD, label: "Add Students", parent: PERMISSIONS.MANAGE_STUDENTS, description: "Add students one by one or in bulk" },
  { key: PERMISSIONS.STUDENTS_EDIT, label: "Edit Students", parent: PERMISSIONS.MANAGE_STUDENTS, description: "Change student details and move them between classes" },
  { key: PERMISSIONS.STUDENTS_ENROLLMENT, label: "Enrollment", parent: PERMISSIONS.MANAGE_STUDENTS, description: "Enroll classes into a school year and term" },
  { key: PERMISSIONS.STUDENTS_ALUMNI, label: "Graduates & Alumni", parent: PERMISSIONS.MANAGE_STUDENTS, description: "See former students and bring them back" },
  { key: PERMISSIONS.STUDENTS_DELETE, label: "Delete Students", parent: PERMISSIONS.MANAGE_STUDENTS, highRisk: true, description: "Permanently remove student records" },
  { key: PERMISSIONS.MANAGE_GUARDIANS, label: "Manage Guardians", group: "People", description: "See and edit parents and guardians" },
  { key: PERMISSIONS.SEE_CONTACTS, label: "See Contacts", group: "People", description: "Open contact cards" },
  { key: PERMISSIONS.EDIT_CONTACTS, label: "Edit Contacts", parent: PERMISSIONS.SEE_CONTACTS, description: "Change details on contact cards" },
  { key: PERMISSIONS.EDIT_CONTACT_TEMPLATE, label: "Edit Contact Template", group: "People", description: "Choose the custom fields on contact cards" },

  { key: PERMISSIONS.MANAGE_CLASSES_SUBJECTS, label: "Manage Classes & Subjects", group: "Academics", description: "Create and change classes, subjects and graduation years" },
  { key: PERMISSIONS.MANAGE_ASSESSMENTS, label: "Manage Assessments & Scores", group: "Academics", description: "Create assessments and enter scores" },
  // Every question page and action also needs Manage Assessments, so it is a follow-up of it.
  { key: PERMISSIONS.SET_ASSESSMENT_QUESTIONS, label: "Set Assessment Questions", parent: PERMISSIONS.MANAGE_ASSESSMENTS, features: ["Set Assessment Questions", "Assessment Questions"], description: "Write online tests for their classes, grade them and post the grades" },
  { key: PERMISSIONS.ASSESS_OTHER_SCHOOL_YEARS, label: "Assess Other School Years", group: "Academics", description: "Enter scores in the classroom for years other than the current one" },
  { key: PERMISSIONS.MARK_ATTENDANCE, label: "Mark Attendance", group: "Academics", description: "Mark attendance and run attendance reports" },
  { key: PERMISSIONS.MANAGE_RECORDS, label: "Manage School Records", group: "Academics", description: "See school years, statistics and the activity log" },
  { key: PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS, label: "Manage School Years & Terms", group: "Academics", highRisk: true, description: "Open and close terms, graduate and withdraw students" },

  { key: PERMISSIONS.APPROVE_ADMISSIONS, label: "Approve Admissions", group: "Admissions & Promotions", description: "Accept or reject online applications" },
  { key: PERMISSIONS.APPROVE_PROMOTIONS, label: "Approve Promotions", group: "Admissions & Promotions", highRisk: true, description: "Apply and reverse student promotions" },
  // Nothing checks this one any more (promotions use Approve Promotions), so it stays off the form.
  { key: PERMISSIONS.MANAGE_PROMOTIONS, label: "Manage Promotions", group: "Admissions & Promotions", retired: true },

  { key: PERMISSIONS.MANAGE_REPORTS, label: "Manage Reports/Printing", group: "Reports", description: "Reports and printing. Choose which ones below", childrenRequired: "Choose at least one report area" },
  { key: PERMISSIONS.REPORTS_TERMINAL, label: "Terminal Reports", parent: PERMISSIONS.MANAGE_REPORTS, features: ["Terminal Report", "Progressive Student Report", "Class Base Merit Sheet", "Class Base Merrit sheet"], description: "Open, print and send report cards and merit sheets" },
  { key: PERMISSIONS.REPORTS_BUILDER, label: "Report Builder", parent: PERMISSIONS.MANAGE_REPORTS, description: "Build reports, limited to what their other permissions allow" },
  { key: PERMISSIONS.REPORTS_SETTINGS, label: "Report Settings", parent: PERMISSIONS.MANAGE_REPORTS, features: ["Terminal Report", "Progressive Student Report", "Class Base Merit Sheet", "Class Base Merrit sheet"], description: "Grading, remarks, signatures and report card layouts" },
  { key: PERMISSIONS.GENERATE_TRANSCRIPTS, label: "Generate Transcripts", group: "Reports", description: "Open official student transcripts" },

  { key: PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS, label: "Publish Events & Announcements", group: "Communication", description: "Post to the whole school. Choose what below", childrenRequired: "Choose Announcements, Events or both" },
  { key: PERMISSIONS.EVENTS_ANNOUNCEMENTS, label: "Announcements", parent: PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS, description: "Write, change and delete announcements" },
  { key: PERMISSIONS.EVENTS_EVENTS, label: "Events", parent: PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS, description: "Create, change and delete events" },
  { key: PERMISSIONS.MAILROOM, label: "Mailroom", group: "Communication", description: "Send SMS, WhatsApp and email to guardians" },
  { key: PERMISSIONS.USE_MIRA, label: "Use Mira (AI Assistant)", group: "Communication", description: "Ask Mira using this person's own permissions" },

  { key: PERMISSIONS.MANAGE_TRANSPORTATION, label: "Transportation", group: "Transportation", forDrivers: true, description: "See the transportation overview. Choose what else they can do below" },
  { key: PERMISSIONS.TRANSPORT_BUSES, label: "Buses", parent: PERMISSIONS.MANAGE_TRANSPORTATION, description: "Add, change and pause buses" },
  { key: PERMISSIONS.TRANSPORT_DRIVERS, label: "Manage Drivers", parent: PERMISSIONS.MANAGE_TRANSPORTATION, description: "Add, change and pause drivers" },
  { key: PERMISSIONS.TRANSPORT_ROUTES, label: "Routes & Stops", parent: PERMISSIONS.MANAGE_TRANSPORTATION, description: "Create routes and the stops on them" },
  { key: PERMISSIONS.TRANSPORT_SCHEDULES, label: "Schedules", parent: PERMISSIONS.MANAGE_TRANSPORTATION, description: "Set weekly bus schedules" },
  { key: PERMISSIONS.TRANSPORT_STUDENTS, label: "Rider List", parent: PERMISSIONS.MANAGE_TRANSPORTATION, description: "Add students to the transport list, or take them off it" },
  { key: PERMISSIONS.TRANSPORT_STUDENT_ROUTES, label: "Student Stops & Routes", parent: PERMISSIONS.MANAGE_TRANSPORTATION, description: "Change a rider's bus, route, stop and pickup details" },
  { key: PERMISSIONS.TRANSPORT_REPORTS, label: "Driver Reports", parent: PERMISSIONS.MANAGE_TRANSPORTATION, description: "Read driver reports and arrival checks, and choose who else sees them" },
  { key: PERMISSIONS.TRANSPORT_SETTINGS, label: "Transportation Settings", parent: PERMISSIONS.MANAGE_TRANSPORTATION, highRisk: true, description: "Map provider, units and the school's location" },

  { key: PERMISSIONS.TRANSPORT_CLASS_REPORTS, label: "Class Bus Reports", group: "Transportation", description: "See bus reports a lead shares with teachers, on the class's Transportation tab" },

  { key: PERMISSIONS.DRIVER_LEAD, label: "Lead Driver", group: "Driver", description: "Leads the other drivers. Turns on Transportation with Manage Drivers and Driver Reports, and adds Management to their menu", presets: [PERMISSIONS.MANAGE_TRANSPORTATION, PERMISSIONS.TRANSPORT_DRIVERS, PERMISSIONS.TRANSPORT_REPORTS] },
  { key: PERMISSIONS.DRIVER_STUDENT_DETAILS, label: "Student Details", group: "Driver", description: "See riders' home address and parent phone on the driver page" },
  { key: PERMISSIONS.DRIVER_FAMILY_DETAILS, label: "Pickup & Emergency", group: "Driver", description: "See the pickup and emergency details the school shares with drivers" },
  { key: PERMISSIONS.DRIVER_REPORT_BUILDER, label: "Reports", group: "Driver", description: "Report Builder, for their own trips and riders plus anything their other permissions allow" },
  { key: PERMISSIONS.DRIVER_SCHOOL_WEBSITE, label: "School Website", group: "Driver", features: ["School Website", "SchoolWebsite"], description: "Show the school website in their menu" },
  { key: PERMISSIONS.DRIVER_ANY_ROUTE, label: "Any Route", group: "Driver", description: "Drive any route, not only the ones assigned to them" },

  { key: PERMISSIONS.MANAGE_PAYGIRA, label: "PayGira", group: "Finance", description: "Fees and payments. Choose where they can work below", childrenRequired: "Choose Classroom PayGira, Main PayGira or both" },
  { key: PERMISSIONS.PAYGIRA_CLASSROOM, label: "Classroom PayGira", parent: PERMISSIONS.MANAGE_PAYGIRA, description: "Only in the class dashboard: collect fees for bills given to them and sign off" },
  { key: PERMISSIONS.PAYGIRA_WORKSPACE, label: "Main PayGira", parent: PERMISSIONS.MANAGE_PAYGIRA, description: "School-wide billing: creating bills, recording payments, fee recovery, payouts and settings. Pick each one below", childrenRequired: "Choose at least one PayGira page" },
  { key: PERMISSIONS.PAYGIRA_SHOW_IN_MANAGEMENT, label: "Show in Management Tools", parent: PERMISSIONS.PAYGIRA_WORKSPACE, description: "Lists PayGira in their Management Tools menu", notAPage: true },
  { key: PERMISSIONS.PAYGIRA_OVERVIEW, label: "Overview", parent: PERMISSIONS.PAYGIRA_WORKSPACE, description: "Collection totals and outstanding balances" },
  { key: PERMISSIONS.PAYGIRA_BILLS, label: "Bill Management", parent: PERMISSIONS.PAYGIRA_WORKSPACE, description: "Create and edit bills, and send reminders" },
  { key: PERMISSIONS.PAYGIRA_DELETE_BILLS, label: "Cancel & Delete Bills", parent: PERMISSIONS.PAYGIRA_WORKSPACE, highRisk: true, notAPage: true, description: "Remove bills and everything assigned under them. Needs Bill Management" },
  { key: PERMISSIONS.PAYGIRA_ORG_BILLS, label: "Org-Wide Bills", parent: PERMISSIONS.PAYGIRA_WORKSPACE, description: "Every student's bills and balances" },
  { key: PERMISSIONS.PAYGIRA_SUBSCRIPTIONS, label: "Subscriptions", parent: PERMISSIONS.PAYGIRA_WORKSPACE, description: "See recurring bills" },
  { key: PERMISSIONS.PAYGIRA_PAYMENTS, label: "Payment Tracking", parent: PERMISSIONS.PAYGIRA_WORKSPACE, description: "Payment history and sign-offs, and export to CSV" },
  { key: PERMISSIONS.PAYGIRA_RECORD_PAYMENTS, label: "Record Payments", parent: PERMISSIONS.PAYGIRA_WORKSPACE, description: "Enter cash, cheque and bank payments" },
  { key: PERMISSIONS.PAYGIRA_DELETE_PAYMENTS, label: "Correct Payments & Reopen Sign-Offs", parent: PERMISSIONS.PAYGIRA_WORKSPACE, highRisk: true, description: "Undo recorded payments and reopen signed-off collections" },
  { key: PERMISSIONS.PAYGIRA_RECOVERY, label: "Fee Recovery", parent: PERMISSIONS.PAYGIRA_WORKSPACE, description: "Arrears lists, notes, reports and reminder emails" },
  { key: PERMISSIONS.PAYGIRA_PAYOUTS, label: "Payouts", parent: PERMISSIONS.PAYGIRA_WORKSPACE, highRisk: true, description: "Send school money to staff and vendors" },
  { key: PERMISSIONS.PAYGIRA_SETTINGS, label: "Payment Settings", parent: PERMISSIONS.PAYGIRA_WORKSPACE, highRisk: true, description: "Payment providers and where school money is paid" },
  { key: PERMISSIONS.MANAGE_BILLING, label: "Manage Billing", group: "Finance", highRisk: true, description: "The school's Managira plan, cards and subscription" },

  { key: PERMISSIONS.MANAGE_SETTINGS, label: "Manage Organization Settings", group: "Administration", highRisk: true, description: "School-wide settings. Choose which ones below", childrenRequired: "Choose at least one settings area" },
  { key: PERMISSIONS.SETTINGS_PROFILE, label: "School Profile & Branding", parent: PERMISSIONS.MANAGE_SETTINGS, description: "School name, logo, theme, display options and calendar" },
  { key: PERMISSIONS.SETTINGS_WEBSITE, label: "School Website", parent: PERMISSIONS.MANAGE_SETTINGS, features: ["School Website", "SchoolWebsite"], description: "Website pages, images, messages and online registration" },
  { key: PERMISSIONS.SETTINGS_ADMISSIONS, label: "Admission Settings", parent: PERMISSIONS.MANAGE_SETTINGS, features: ["Student and Guardian Profile", "Student and Guadian Profile"], description: "Online admission and the fields on student forms" },
  { key: PERMISSIONS.SETTINGS_INTEGRATIONS, label: "Integrations", parent: PERMISSIONS.MANAGE_SETTINGS, highRisk: true, description: "Turn on and connect Google, WhatsApp, SMS and other services" },
  { key: PERMISSIONS.SETTINGS_MIRA, label: "Mira Settings", parent: PERMISSIONS.MANAGE_SETTINGS, description: "Turn Mira on and choose who can use her" },
  { key: PERMISSIONS.SETTINGS_SERVICE_ACCOUNTS, label: "Service Accounts", parent: PERMISSIONS.MANAGE_SETTINGS, highRisk: true, description: "API keys that reach school data" },
  // Decides who can get into the whole school: it only ever works for a Manager (ssoController.managersOnly).
  { key: PERMISSIONS.MANAGE_SSO, label: "Single Sign-On", parent: PERMISSIONS.MANAGE_SETTINGS, highRisk: true, sandboxFeature: "sso", description: "Signing in through the school's own provider (SAML or OpenID Connect). Works for Managers only" },
];

const PERMISSION_BY_KEY = new Map(PERMISSION_OPTIONS.map((option) => [option.key, option]));
// The main permission a key ultimately sits under (itself when it has none).
const rootPermission = (key) => {
  let option = PERMISSION_BY_KEY.get(key);
  while (option && option.parent) option = PERMISSION_BY_KEY.get(option.parent);
  return option ? option.key : key;
};
// How a follow-up reads away from its main permission, e.g. in the staff list.
const permissionFullLabel = (option) => (option.parent ? `${PERMISSION_BY_KEY.get(rootPermission(option.key)).label}: ${option.label}` : option.label);
const HIGH_RISK_PERMISSIONS = new Set(PERMISSION_OPTIONS.filter((option) => option.highRisk).map((option) => option.key));


// Permissions that only make sense when the school's plan includes the feature
// (names as in the features table / session.allowedFeatures, any one is enough).
// Mira depends on its integration being switched on instead.
const PERMISSION_FEATURES = {
  [PERMISSIONS.MANAGE_ASSESSMENTS]: ["Assessment Tracking"],
  [PERMISSIONS.MARK_ATTENDANCE]: ["Attendance Tracking"],
  [PERMISSIONS.MANAGE_REPORTS]: ["Terminal Report", "Progressive Student Report", "Class Base Merit Sheet", "Class Base Merrit sheet", "Official School Transcript"],
  [PERMISSIONS.DRIVER_REPORT_BUILDER]: ["Terminal Report", "Progressive Student Report", "Class Base Merit Sheet", "Class Base Merrit sheet", "Official School Transcript"],
  [PERMISSIONS.MANAGE_STUDENTS]: ["Student and Guardian Profile", "Student and Guadian Profile"],
  [PERMISSIONS.MANAGE_GUARDIANS]: ["Student and Guardian Profile", "Student and Guadian Profile"],
  [PERMISSIONS.APPROVE_ADMISSIONS]: ["School Website", "SchoolWebsite"],
  [PERMISSIONS.SEE_CONTACTS]: ["Student and Guardian Profile", "Student and Guadian Profile"],
  [PERMISSIONS.EDIT_CONTACT_TEMPLATE]: ["Student and Guardian Profile", "Student and Guadian Profile"],
  [PERMISSIONS.GENERATE_TRANSCRIPTS]: ["Official School Transcript"],
  [PERMISSIONS.MANAGE_PAYGIRA]: ["PayGira", "Pay Gira", "PayGira & Payments", "PayGira and Payments"],
};

// The permission choices for this school. Anything outside the plan, and Mira or
// Transportation while switched off, is left out rather than greyed out. Only
// when the plan could not be read at all (null, a database error) is nothing
// hidden, so a brief failure can't wipe someone's permissions on save.
function permissionOptionsFor({ allowedFeatures, miraActivated, transportActivated, organizationId } = {}) {
  const features = Array.isArray(allowedFeatures) ? allowedFeatures : null;
  const have = new Set((features || []).map((name) => String(name || "").trim().toLowerCase()));
  return PERMISSION_OPTIONS.filter((option) => {
    if (option.retired) return false;
    if (option.sandboxFeature && !require("../utils/shards/features").isOn(option.sandboxFeature, { organizationId })) return false;
    if ((option.key === PERMISSIONS.USE_MIRA || option.key === PERMISSIONS.SETTINGS_MIRA) && miraActivated === false) return false;
    if ((option.group === "Transportation" || rootPermission(option.key) === PERMISSIONS.MANAGE_TRANSPORTATION || option.group === "Driver") && transportActivated === false) return false;
    if (!features) return true;
    return planNeedsFor(option.key, organizationId)
      .every((needs) => !needs || needs.some((name) => have.has(name.toLowerCase())));
  });
}

// Permissions only the main manager has until someone is given them by hand.
const GRANT_ONLY_PERMISSIONS = new Set([PERMISSIONS.ASSESS_OTHER_SCHOOL_YEARS]);

const MANAGER_DEFAULT_OPTIONAL_PERMISSIONS = PERMISSION_OPTIONS
  .map((option) => option.key)
  .filter((key) => !GRANT_ONLY_PERMISSIONS.has(key));

const ROLE_DEFAULT_PERMISSIONS = {
  // Manager gets all available permissions by default.
  // These same keys are pre-checked in the create/modify employee UI.
  // Spreading here so MANAGER_DEFAULT_OPTIONAL_PERMISSIONS changes automatically propagate.
  Manager: [...MANAGER_DEFAULT_OPTIONAL_PERMISSIONS],
  Teacher: [
    PERMISSIONS.MANAGE_STUDENTS,
    PERMISSIONS.MANAGE_ASSESSMENTS,
    PERMISSIONS.MARK_ATTENDANCE,
    PERMISSIONS.MANAGE_CLASSES_SUBJECTS,
    PERMISSIONS.MANAGE_REPORTS,
    PERMISSIONS.TRANSPORT_CLASS_REPORTS,
  ],
  Supervisor: [
    PERMISSIONS.MANAGE_STUDENTS,
    PERMISSIONS.MANAGE_GUARDIANS,
    PERMISSIONS.MANAGE_ASSESSMENTS,
    PERMISSIONS.SET_ASSESSMENT_QUESTIONS,
    PERMISSIONS.MARK_ATTENDANCE,
    PERMISSIONS.MANAGE_REPORTS,
    PERMISSIONS.APPROVE_ADMISSIONS,
    PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS,
    PERMISSIONS.MANAGE_CLASSES_SUBJECTS,
    PERMISSIONS.GENERATE_TRANSCRIPTS,
    PERMISSIONS.MANAGE_PROMOTIONS,
    PERMISSIONS.TRANSPORT_CLASS_REPORTS,
  ],
  // Drivers start with only the Driver dashboard (their routes and riders); anything
  // more is ticked per driver, from the Driver and Transportation groups. A lead can
  // also be given Users / Employees.
  Driver: [],
};

// Store the singleton on `global` so it is shared even if this module is
// evaluated more than once via different require() paths (e.g. circular deps
// or case-sensitivity differences on Windows). A module-level variable would
// be private to each module instance, causing the DDL to run multiple times.
async function ensurePermissionsSchema(database = db) {
  if (global._permissionsSchemaPromise) return global._permissionsSchemaPromise;

  global._permissionsSchemaPromise = (async () => {
    if (PERMISSIONS_DDL_LOGS_ENABLED) {
      console.info('[Permissions] ensurePermissionsSchema: running DDL...');
    }
    await database.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        organization_id INT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
        permission_key VARCHAR(100) NOT NULL,
        granted_by INT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, organization_id, permission_key)
      )
    `);

    await database.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'user_permissions_user_id_permission_key_key'
        ) THEN
          ALTER TABLE user_permissions
          DROP CONSTRAINT user_permissions_user_id_permission_key_key;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'user_permissions_user_org_perm_unique'
        ) THEN
          ALTER TABLE user_permissions
          ADD CONSTRAINT user_permissions_user_org_perm_unique
          UNIQUE (user_id, organization_id, permission_key);
        END IF;
      END
      $$;
    `);

    await database.query(
      `CREATE INDEX IF NOT EXISTS idx_user_permissions_user_org ON user_permissions(user_id, organization_id)`
    );
    await database.query(
      `CREATE INDEX IF NOT EXISTS idx_user_permissions_perm_org ON user_permissions(permission_key, organization_id)`
    );
    if (PERMISSIONS_DDL_LOGS_ENABLED) {
      console.info('[Permissions] ensurePermissionsSchema: DDL complete.');
    }
  })();

  // If DDL fails, clear the global so the next call can retry.
  global._permissionsSchemaPromise.catch(() => {
    global._permissionsSchemaPromise = null;
  });

  return global._permissionsSchemaPromise;
}

function normalizeRole(role) {
  return String(role || "").trim();
}

function normalizeRoleLower(role) {
  return normalizeRole(role).toLowerCase();
}

function isManagerRole(role) {
  return normalizeRoleLower(role) === "manager";
}

function isManagerLikeRole(role) {
  return MANAGER_LIKE_ROLES.has(normalizeRoleLower(role));
}

const isPortalRole = (role) => ["guardian", "student"].includes(normalizeRoleLower(role));

function normalizePermissionsList(rawPermissions) {
  const incoming = Array.isArray(rawPermissions)
    ? rawPermissions
    : rawPermissions
    ? [rawPermissions]
    : [];

  const validKeys = new Set(PERMISSION_OPTIONS.map((option) => option.key));

  return [...new Set(incoming.map((value) => String(value || "").trim()).filter((value) => validKeys.has(value)))];
}

function getDefaultPermissionsForRole(role) {
  const normalizedRole = normalizeRole(role);
  return ROLE_DEFAULT_PERMISSIONS[normalizedRole]
    ? [...ROLE_DEFAULT_PERMISSIONS[normalizedRole]]
    : [];
}

function mergePermissionsForRole(role, customPermissions = []) {
  const defaults = getDefaultPermissionsForRole(role);
  const custom = normalizePermissionsList(customPermissions);
  return [...new Set([...defaults, ...custom])];
}

// Drivers can only ever hold what belongs to driving and transportation, whatever is
// saved. Users / Employees is the one addition, and only for a lead (driverPermissions).
function isDriverPermission(key) {
  const option = PERMISSION_OPTIONS.find((item) => item.key === key);
  if (!option) return false;
  const root = rootPermission(key);
  return option.group === "Driver" || root === PERMISSIONS.MANAGE_TRANSPORTATION || root === PERMISSIONS.MANAGE_EMPLOYEES;
}

function driverPermissions(keys = []) {
  const allowed = keys.filter(isDriverPermission);
  return allowed.includes(PERMISSIONS.DRIVER_LEAD)
    ? allowed
    : allowed.filter((key) => rootPermission(key) !== PERMISSIONS.MANAGE_EMPLOYEES);
}

// What someone can really do from their saved rows: once a person's permissions
// have been saved those ticks are the answer; only someone never saved falls
// back to their role's defaults. Managers hold only what they were given, and
// drivers can only hold driving and transportation permissions.
function effectivePermissionsForRole(role, savedPermissions = []) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "Driver") {
    const held = dropOrphanFollowUps(driverPermissions(savedPermissions));
    return held.includes(PERMISSIONS.DRIVER_REPORT_BUILDER) ? [...held, PERMISSIONS.REPORTS_BUILDER] : held;
  }
  if (savedPermissions.includes(PERMISSIONS_SAVED_KEY)) {
    return dropOrphanFollowUps(savedPermissions.filter((key) => key !== PERMISSIONS_SAVED_KEY));
  }
  const held = savedPermissions.length || isManagerRole(normalizedRole)
    ? savedPermissions
    : getDefaultPermissionsForRole(normalizedRole);
  return expandUnsavedPermissions(normalizedRole, held);
}

// Anyone not saved since follow-ups existed keeps exactly what they could already
// do, so nobody loses access until a manager chooses. Transportation came with
// Manage Students, its settings with Manage Settings, Payouts with Manage Billing;
// editing contacts always let people open them; teachers had no Management Tools.
function expandUnsavedPermissions(normalizedRole, held) {
  const expanded = new Set(held);
  if (expanded.has(PERMISSIONS.MANAGE_STUDENTS)) expanded.add(PERMISSIONS.MANAGE_TRANSPORTATION);
  if (expanded.has(PERMISSIONS.EDIT_CONTACTS)) expanded.add(PERMISSIONS.SEE_CONTACTS);
  PERMISSION_OPTIONS.forEach((option) => {
    if (!option.parent || !expanded.has(rootPermission(option.key))) return;
    if (option.key === PERMISSIONS.EDIT_CONTACTS) return;
    if (option.key === PERMISSIONS.PAYGIRA_PAYOUTS && !held.includes(PERMISSIONS.MANAGE_BILLING)) return;
    if (option.key === PERMISSIONS.TRANSPORT_SETTINGS && !held.includes(PERMISSIONS.MANAGE_SETTINGS)) return;
    if (option.key === PERMISSIONS.PAYGIRA_SHOW_IN_MANAGEMENT && normalizedRole === "Teacher") return;
    // It was its own permission before it was a follow-up: only those who held it keep it.
    if (option.key === PERMISSIONS.SET_ASSESSMENT_QUESTIONS) return;
    expanded.add(option.key);
  });
  return [...expanded];
}

function dropOrphanFollowUps(held) {
  const set = new Set(held);
  const hasChain = (key) => {
    const option = PERMISSION_BY_KEY.get(key);
    return !option || !option.parent || (set.has(option.parent) && hasChain(option.parent));
  };
  return held.filter(hasChain);
}

// For saving a form: follow-ups without their main permission are removed, and a
// main permission that needs a follow-up can't be saved without one.
function resolvePermissionSelection(requested = []) {
  const permissions = dropOrphanFollowUps(requested);
  const missing = PERMISSION_OPTIONS.find((option) => {
    if (!option.childrenRequired || !permissions.includes(option.key)) return false;
    return !PERMISSION_OPTIONS.some((child) => child.parent === option.key && !child.notAPage && permissions.includes(child.key));
  });
  return { permissions, error: missing ? `${permissionFullLabel(missing)}: ${missing.childrenRequired}.` : null };
}

// What the form pre-selects for new Teachers and Supervisors: their everyday
// permissions, leaving high-risk ones and Transportation for a manager to add.
// With `questions` (the assessments flow), a new teacher also gets Set Assessment Questions,
// so they can write online tests for their classes from the start.
function rolePresetPermissions(role, { questions = false } = {}) {
  const preset = effectivePermissionsForRole(role, [])
    .filter((key) => !HIGH_RISK_PERMISSIONS.has(key) && rootPermission(key) !== PERMISSIONS.MANAGE_TRANSPORTATION);
  if (questions && preset.includes(PERMISSIONS.MANAGE_ASSESSMENTS) && !preset.includes(PERMISSIONS.SET_ASSESSMENT_QUESTIONS)) {
    preset.push(PERMISSIONS.SET_ASSESSMENT_QUESTIONS);
  }
  return preset;
}

function getSuggestedPermissionsForRole(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "Manager") {
    return [...MANAGER_DEFAULT_OPTIONAL_PERMISSIONS];
  }

  return [];
}

function isTransientPermissionDbError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    message.includes('connection terminated unexpectedly') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('connection reset by peer')
  );
}

async function safePermissionCacheFetch(fetchFn, fallbackValue) {
  try {
    return await fetchFn();
  } catch (error) {
    if (isTransientPermissionDbError(error)) {
      console.warn('[Permissions] transient DB/cache fetch failure, using fallback value.');
      return fallbackValue;
    }
    throw error;
  }
}

async function getPrimaryManagerUserId(database, organizationId) {
  if (!organizationId) return null;

  const cacheKey = `perm:primary-manager:${organizationId}`;
  return safePermissionCacheFetch(
    () => cacheManager.getOrFetch(
      "organization",
      cacheKey,
      async () => {
      const orgResult = await database.query(
        `
        SELECT email, first_name, last_name
        FROM organizations
        WHERE organization_id = $1
        LIMIT 1
      `,
        [organizationId]
      );

      const orgIdentity = orgResult.rows[0] || null;

      if (orgIdentity?.email) {
        const byEmail = await database.query(
          `
          SELECT user_id
          FROM users
          WHERE organization_id = $1
            AND account_type = 'Manager'
            AND email::text ILIKE $2
          ORDER BY created_at ASC NULLS LAST, user_id ASC
          LIMIT 1
        `,
          [organizationId, orgIdentity.email]
        );

        if (byEmail.rows.length > 0) {
          return byEmail.rows[0].user_id;
        }
      }

      if (orgIdentity?.first_name && orgIdentity?.last_name) {
        const byName = await database.query(
          `
          SELECT user_id
          FROM users
          WHERE organization_id = $1
            AND account_type = 'Manager'
            AND LOWER(first_name) = LOWER($2)
            AND LOWER(last_name) = LOWER($3)
          ORDER BY created_at ASC NULLS LAST, user_id ASC
          LIMIT 1
        `,
          [organizationId, orgIdentity.first_name, orgIdentity.last_name]
        );

        if (byName.rows.length > 0) {
          return byName.rows[0].user_id;
        }
      }

      const earliestManager = await database.query(
        `
        SELECT user_id
        FROM users
        WHERE organization_id = $1
          AND account_type = 'Manager'
        ORDER BY created_at ASC NULLS LAST, user_id ASC
        LIMIT 1
      `,
        [organizationId]
      );

      return earliestManager.rows[0]?.user_id || null;
      },
      { ttl: PERMISSION_CACHE_TTL_SEC }
    ),
    null
  );
}

async function getUserPermissions(database, userId, organizationId) {
  if (!userId || !organizationId) return [];
  await ensurePermissionsSchema(database);

  const cacheKey = `perm:user:${organizationId}:${userId}`;
  return safePermissionCacheFetch(
    () => cacheManager.getOrFetch(
      "organization",
      cacheKey,
      async () => {
      const result = await database.query(
        `SELECT permission_key FROM user_permissions WHERE user_id = $1 AND organization_id = $2`,
        [userId, organizationId]
      );
      return result.rows.map((row) => row.permission_key);
      },
      { ttl: PERMISSION_CACHE_TTL_SEC }
    ),
    []
  );
}

function invalidateUserPermissionCache(organizationId, userId) {
  if (!organizationId) {
    return;
  }

  cacheManager.invalidatePattern("organization", `perm:primary-manager:${organizationId}`);

  if (userId) {
    cacheManager.invalidatePattern("organization", `perm:user:${organizationId}:${userId}`);
    cacheManager.invalidatePattern("organization", `perm:user-role:${organizationId}:${userId}`);
  } else {
    cacheManager.invalidatePattern("organization", `perm:user:${organizationId}:`);
    cacheManager.invalidatePattern("organization", `perm:user-role:${organizationId}:`);
  }

  cacheManager.invalidatePattern("organization", `perm:owner-email:${organizationId}:`);
}

// The plan features a permission needs, each list "any one is enough". Where the plan catalog
// is released, its needs replace these (utils/planCatalog.js: Report Builder is its own feature).
function planNeedsFor(permissionKey, organizationId = null) {
  const option = PERMISSION_BY_KEY.get(permissionKey);
  if (!option) return [];
  const root = rootPermission(permissionKey);
  const catalog = require("../utils/planCatalog");
  if (organizationId && catalog.catalogOn(organizationId)) {
    return [catalog.ROOT_NEEDS[root] || PERMISSION_FEATURES[root], catalog.OPTION_NEEDS[permissionKey] || option.features].filter(Boolean);
  }
  return [PERMISSION_FEATURES[root], option.features].filter(Boolean);
}

function withinPlan(permissionKey, features, organizationId = null) {
  const have = new Set((features || []).map((name) => String(name || "").trim().toLowerCase()));
  return planNeedsFor(permissionKey, organizationId).every((names) => names.some((name) => have.has(name.toLowerCase())));
}

// Uses the plan list every request already has cached, so it adds no query. If the
// plan can't be read at all, access is left alone rather than blocked by an outage.
async function planAllowsPermission(database, organizationId, permissionKey) {
  if (!planNeedsFor(permissionKey, organizationId).length) return true;
  const { withCore } = require("../utils/planCatalog");
  try {
    const plan = await resolvePlanForOrganization(database, organizationId);
    if (!plan) return true;
    if (!plan.planId) return withinPlan(permissionKey, withCore([], organizationId), organizationId);
    const features = await cacheManager.getOrFetch(
      "organization",
      `access:allowed-features:${organizationId}:${plan.planId}`,
      async () => (await database.query(
        `SELECT f.feature_name FROM features f JOIN plan_features pf ON pf.feature_id = f.id WHERE pf.plan_id = $1`,
        [plan.planId]
      )).rows.map((row) => row.feature_name),
      { ttl: 90 }
    );
    return Array.isArray(features) ? withinPlan(permissionKey, withCore(features, organizationId), organizationId) : true;
  } catch (_error) {
    return true;
  }
}

async function isOrganizationOwnerEmail(database, organizationId, userEmail) {
  return safePermissionCacheFetch(
    () => cacheManager.getOrFetch(
      "organization",
      `perm:owner-email:${organizationId}:${String(userEmail).toLowerCase()}`,
      async () => {
      const ownerEmailQuery = await database.query(
        `SELECT 1
         FROM organizations
         WHERE organization_id = $1
           AND LOWER(email) = LOWER($2)
         LIMIT 1`,
        [organizationId, userEmail]
      );
      return ownerEmailQuery.rows.length > 0;
      },
      { ttl: PERMISSION_CACHE_TTL_SEC }
    ),
    false
  );
}

async function userHasPermission(database, { userId, userRole, organizationId, accountType, userEmail }, permissionKey) {
  if (!permissionKey) return true;
  if (!organizationId) return false;

  // Parents and students hold no staff permission. Their ids come from other tables, so
  // looking them up below could match a member of staff with the same number.
  if (isPortalRole(userRole) || isPortalRole(accountType)) return false;

  // Outside the school's plan nobody has it, the owner included. This one check
  // covers pages, actions, Mira and reports.
  if (!(await planAllowsPermission(database, organizationId, permissionKey))) return false;

  const normalizedUserRole = normalizeRole(userRole);
  const normalizedAccountType = normalizeRole(accountType);
  const normalizedAccountTypeLower = normalizeRoleLower(accountType);

  // Organization owner session (logs in via organizations table) should always
  // have full access within its own organization/plan.
  if (isManagerRole(normalizedUserRole) && normalizedAccountTypeLower === "organization") {
    return true;
  }

  // The manager whose email is the school's signup email is its owner, with full access.
  // Only a manager: an email alone, which people can edit, never gives anyone this.
  if (userEmail && isManagerRole(normalizedUserRole) && await isOrganizationOwnerEmail(database, organizationId, userEmail)) {
    return true;
  }

  if (isManagerLikeRole(userRole)) return true;
  if (!userId) return false;
  await ensurePermissionsSchema(database);

  const savedPermissions = await getUserPermissions(database, userId, organizationId);
  return effectivePermissionsForRole(normalizedUserRole, savedPermissions).includes(permissionKey);
}

// Pass one key, or a list when any one of them opens the page.
function requirePermission(permissionKey) {
  const permissionKeys = Array.isArray(permissionKey) ? permissionKey : [permissionKey];
  return async (req, res, next) => {
    try {
      const database = req.app.get("db") || db;
      const organizationId = req.session.organizationId;
      const userRole = req.session.userRole || req.session.user?.account_type || null;
      const accountType = req.session.accountType || req.session.user?.account_type || null;
      const userId = req.session.user?.user_id || req.session.userId || null;
      const userEmail = req.session.user?.email || null;

      const check = async () => {
        for (const key of permissionKeys) {
          if (await userHasPermission(database, { userId, userRole, organizationId, accountType, userEmail }, key)) return true;
        }
        return false;
      };
      // A dropped database connection is not "no permission": try once more
      // before sending anyone away from the page they're on.
      let allowed;
      try {
        allowed = await check();
      } catch (firstError) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        allowed = await check();
      }

      if (!allowed) {
        req.flash("error", "You do not have permission to access this page.");
        return res.redirect("/common/orgDashboard");
      }

      next();
    } catch (error) {
      console.error("[PermissionCheckError]", {
        route: req.originalUrl,
        permissionKey,
        organizationId: req.session?.organizationId,
        userId: req.session?.user?.user_id || req.session?.userId || null,
        userRole: req.session?.userRole || req.session?.user?.account_type || null,
        accountType: req.session?.accountType || req.session?.user?.account_type || null,
        sessionId: req.sessionID,
        error: error?.message,
      });
      req.flash("error", "Unable to verify your permissions.");
      return res.redirect("/common/orgDashboard");
    }
  };
}

module.exports = {
  PERMISSIONS,
  MAILROOM_ALL_ACCESS_KEY,
  PERMISSION_OPTIONS,
  permissionOptionsFor,
  ROLE_DEFAULT_PERMISSIONS,
  ensurePermissionsSchema,
  normalizePermissionsList,
  getDefaultPermissionsForRole,
  mergePermissionsForRole,
  effectivePermissionsForRole,
  rolePresetPermissions,
  resolvePermissionSelection,
  permissionFullLabel,
  HIGH_RISK_PERMISSIONS,
  isOrganizationOwnerEmail,
  isPortalRole,
  isManagerRole,
  withinPlan,
  planAllowsPermission,
  PERMISSIONS_SAVED_KEY,
  getSuggestedPermissionsForRole,
  getPrimaryManagerUserId,
  getUserPermissions,
  userHasPermission,
  isDriverPermission,
  driverPermissions,
  invalidateUserPermissionCache,
  requirePermission,
  isManagerLikeRole,
};
