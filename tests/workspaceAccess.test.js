const test = require("node:test");
const assert = require("node:assert/strict");
const { workspaceAccess } = require("../utils/workspaceAccess");
const { effectivePermissionsForRole, rolePresetPermissions, resolvePermissionSelection, permissionOptionsFor, HIGH_RISK_PERMISSIONS, PERMISSIONS_SAVED_KEY } = require("../middleware/permissionMiddleware");
const { REPORTS, normalizeColumns, normalizeCriteria } = require("../utils/reportBuilder");

const on = (items) => Object.entries(items).filter(([key, value]) => key !== "any" && value).map(([key]) => key);

test("one permission shows its menu with only that item", () => {
  const employees = workspaceAccess({ permissions: ["manage_employees"], role: "Teacher" });
  assert.deepEqual(on(employees.management), ["employees"]);
  assert.equal(employees.reports.any, false);
  assert.equal(employees.admissions.any, false);

  const reports = workspaceAccess({ permissions: ["manage_reports", "reports_builder"], role: "Teacher" });
  assert.equal(reports.management.any, false);
  assert.deepEqual(on(reports.reports), ["builder"]);

  const transcripts = workspaceAccess({ permissions: ["generate_transcripts"], features: ["Official School Transcript"], role: "Teacher" });
  assert.deepEqual(on(transcripts.reports), ["transcripts"]);
});

test("a teacher with no permissions gets no workspace menus", () => {
  const none = workspaceAccess({ permissions: [], role: "Teacher" });
  assert.equal(none.management.any || none.reports.any || none.admissions.any, false);
});

test("saved permissions win over role defaults, which only cover people never saved", () => {
  const neverSaved = effectivePermissionsForRole("Teacher", []);
  ["manage_students", "students_add", "manage_reports", "reports_builder", "manage_transportation", "transport_buses"].forEach((key) => assert.ok(neverSaved.includes(key), key));
  assert.ok(!neverSaved.includes("transport_settings"));
  assert.deepEqual(effectivePermissionsForRole("Teacher", ["mailroom"]), ["mailroom"]);
  assert.deepEqual(effectivePermissionsForRole("Teacher", ["mailroom", PERMISSIONS_SAVED_KEY]), ["mailroom"]);
  assert.deepEqual(effectivePermissionsForRole("Teacher", [PERMISSIONS_SAVED_KEY]), []);
  assert.deepEqual(effectivePermissionsForRole("Manager", []), []);
  assert.deepEqual(effectivePermissionsForRole("Driver", ["manage_students"]), []);
});

test("every Report Builder report needs the permission for what it shows", () => {
  const expected = {
    staff: "manage_employees", staff_tasks: "manage_employees", parents: "manage_guardians", parent_messages: "manage_guardians",
    students: "manage_students", attendance: "mark_attendance", fee_balances: "paygira_org_bills", payments: "paygira_payments",
    announcements: "publish_events_announcements", events: "publish_events_announcements",
    activity_log: "manage_records", activity_audit: "manage_records", message_delivery: "mailroom",
  };
  Object.entries(expected).forEach(([key, permission]) => assert.equal(REPORTS[key].permission, permission, key));
  Object.entries(REPORTS).forEach(([key, report]) => assert.ok(report.permission, `${key} has a permission`));
});

test("parent and attendance details drop out of a students report without those permissions", () => {
  const granted = new Set(["manage_students"]);
  const asked = ["student_name", "parent_phone", "parent_name", "days_absent", "fee_balance"];
  assert.deepEqual(normalizeColumns(REPORTS.students, asked, granted), ["student_name"]);
  const { values } = normalizeCriteria(REPORTS.students, { parent_contact: "0244", absences: "any" }, granted);
  assert.deepEqual(values, {});
  assert.ok(!normalizeColumns(REPORTS.students, [], granted).includes("parent_name"));
  const withParents = new Set(["manage_students", "manage_guardians"]);
  assert.deepEqual(normalizeColumns(REPORTS.students, ["parent_phone"], withParents), ["parent_phone"]);
});

test("every follow-up points at a real main permission, and only real keys are shown", () => {
  const options = require("../middleware/permissionMiddleware").PERMISSION_OPTIONS;
  const keys = new Set(options.map((option) => option.key));
  assert.equal(keys.size, options.length, "keys are unique");
  options.forEach((option) => {
    if (option.parent) assert.ok(keys.has(option.parent), option.key);
    else assert.ok(option.group, option.key + " has a group");
    if (!option.retired) assert.ok(option.description, option.key + " has a description");
  });
});

test("PayGira holders saved before follow-ups keep what they had", () => {
  const manager = effectivePermissionsForRole("Manager", ["manage_paygira", "manage_billing"]);
  ["paygira_classroom", "paygira_workspace", "paygira_show_in_management", "paygira_settings", "paygira_payouts"].forEach((key) => assert.ok(manager.includes(key), key));
  const teacher = effectivePermissionsForRole("Teacher", ["manage_paygira"]);
  assert.ok(teacher.includes("paygira_workspace"));
  assert.ok(!teacher.includes("paygira_show_in_management"), "teachers had no Management Tools");
  assert.ok(!teacher.includes("paygira_payouts"), "payouts went with Manage Billing");
});

test("follow-ups count only under their main permission and are not expanded once chosen", () => {
  const saved = (...keys) => effectivePermissionsForRole("Teacher", [...keys, PERMISSIONS_SAVED_KEY]);
  assert.deepEqual(saved("manage_paygira", "paygira_classroom"), ["manage_paygira", "paygira_classroom"]);
  assert.deepEqual(saved("mailroom", "paygira_overview"), ["mailroom"]);
  assert.deepEqual(saved("manage_paygira", "paygira_classroom", "paygira_overview"), ["manage_paygira", "paygira_classroom"]);
  assert.deepEqual(saved("manage_students"), ["manage_students"]);
});

test("saving PayGira needs a follow-up, and Main PayGira needs a page", () => {
  assert.match(resolvePermissionSelection(["manage_paygira"]).error, /Classroom PayGira/);
  assert.match(resolvePermissionSelection(["manage_paygira", "paygira_workspace", "paygira_show_in_management"]).error, /at least one PayGira page/);
  assert.match(resolvePermissionSelection(["manage_reports"]).error, /report area/);
  assert.match(resolvePermissionSelection(["publish_events_announcements"]).error, /Announcements, Events/);
  assert.match(resolvePermissionSelection(["manage_settings"]).error, /settings area/);
  assert.equal(resolvePermissionSelection(["manage_students"]).error, null);
  assert.equal(resolvePermissionSelection(["manage_paygira", "paygira_classroom"]).error, null);
  assert.deepEqual(resolvePermissionSelection(["paygira_settings", "mailroom"]).permissions, ["mailroom"]);
});

test("Management shows PayGira only with its own follow-up; inside, only the pages given", () => {
  const features = ["PayGira"];
  const classroom = workspaceAccess({ permissions: ["manage_paygira", "paygira_classroom"], features, role: "Teacher" });
  assert.equal(classroom.management.any, false);
  assert.equal(classroom.paygira.any, false);
  const hidden = workspaceAccess({ permissions: ["manage_paygira", "paygira_workspace", "paygira_bills"], features, role: "Teacher" });
  assert.equal(hidden.management.paygira, false);
  const shown = workspaceAccess({ permissions: ["manage_paygira", "paygira_workspace", "paygira_show_in_management", "paygira_bills"], features, role: "Teacher" });
  assert.deepEqual(on(shown.management), ["paygira"]);
  assert.deepEqual(["overview", "bills", "students", "subscriptions", "payments", "arrears", "payouts", "settings"].filter((page) => shown.paygira[page]), ["bills"]);
  assert.equal(shown.paygira.canDeleteBills, false);
});

test("the form hides retired permissions and PayGira follow-ups without the plan", () => {
  const keys = permissionOptionsFor({ allowedFeatures: ["Terminal Report"] }).map((option) => option.key);
  assert.ok(!keys.includes("manage_promotions"));
  assert.ok(!keys.includes("paygira_bills"));
  assert.ok(!keys.includes("settings_website"), "website settings need the School Website feature");
  assert.ok(!keys.includes("manage_students"), "students need the profile feature");
  const off = permissionOptionsFor({ allowedFeatures: ["Terminal Report"], transportActivated: false, miraActivated: false }).map((option) => option.key);
  ["manage_transportation", "transport_buses", "use_mira", "settings_mira"].forEach((key) => assert.ok(!off.includes(key), key));
  const on_ = permissionOptionsFor({ allowedFeatures: ["Terminal Report"], transportActivated: true, miraActivated: true }).map((option) => option.key);
  ["manage_transportation", "transport_buses", "settings_mira"].forEach((key) => assert.ok(on_.includes(key), key));
  ["paygira_payouts", "paygira_settings", "manage_billing", "manage_employees"].forEach((key) => assert.ok(HIGH_RISK_PERMISSIONS.has(key), key));
});

test("new staff presets leave out high-risk permissions and Transportation", () => {
  const teacher = rolePresetPermissions("Teacher");
  ["manage_students", "students_add", "students_edit", "manage_reports", "reports_terminal"].forEach((key) => assert.ok(teacher.includes(key), key));
  ["students_delete", "manage_transportation", "transport_buses"].forEach((key) => assert.ok(!teacher.includes(key), key));
  assert.ok(!rolePresetPermissions("Supervisor").includes("manage_school_year_terms"));
  assert.deepEqual(resolvePermissionSelection(teacher).error, null);
});

test("plan features decide the menus, whatever permissions someone holds", () => {
  const permissions = ["manage_students", "students_add", "students_enrollment", "manage_guardians", "manage_assessments", "reports_terminal", "reports_settings", "reports_builder", "generate_transcripts", "manage_records", "settings_website", "paygira_workspace", "paygira_show_in_management"];
  const none = workspaceAccess({ permissions, features: [], role: "Teacher" });
  assert.deepEqual(on(none.admissions), []);
  assert.deepEqual(on(none.management).filter((key) => key !== "schoolYears" && key !== "docs"), []);
  assert.deepEqual(on(none.reports), ["builder"]);
  assert.equal(none.management.docs, false);
  const all = workspaceAccess({ permissions, features: ["Student and Guardian Profile", "Assessment Tracking", "Terminal Report", "Official School Transcript", "Organization Analytics & Insights", "School Website", "PayGira"], role: "Teacher" });
  assert.deepEqual(on(all.reports), ["stats", "terminal", "transcripts", "settings", "builder"]);
  assert.ok(all.management.guardians && all.management.assessments && all.management.website && all.management.paygira);
});

test("an empty plan hides plan-tied permissions; only an unreadable plan shows them", () => {
  const empty = permissionOptionsFor({ allowedFeatures: [] }).map((option) => option.key);
  ["manage_students", "manage_reports", "manage_paygira", "manage_assessments", "mark_attendance", "generate_transcripts", "settings_website", "see_contacts"].forEach((key) => assert.ok(!empty.includes(key), key));
  assert.ok(empty.includes("manage_employees"));
  const unknown = permissionOptionsFor({ allowedFeatures: null }).map((option) => option.key);
  assert.ok(unknown.includes("manage_paygira"));
});
