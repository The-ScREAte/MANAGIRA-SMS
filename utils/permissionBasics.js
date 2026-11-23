"use strict";
// What each role starts with on Add staff and Edit staff: the "basics", a few permissions the job
// needs every day, ticked when the role is chosen. Everything else sits behind "Advanced
// permissions". This is the screen's defaults only: how permissions are stored and checked
// (middleware/permissionMiddleware.js) is untouched, and nobody already saved changes.
//
// Rules (tests/permissionBasics.test.js keeps them true):
//   - every basic is a real permission, and its main permission is there too;
//   - no High Risk permission is a basic of any role but Manager;
//   - money is not mixed with staff access or settings;
//   - a role's basics are about 3 to 8 main permissions (a Driver starts with the Driver
//     dashboard alone; the rest is ticked per driver).
const perms = require("../middleware/permissionMiddleware");

const P = perms.PERMISSIONS;

// A permission's follow-ups are listed too: a follow-up can't be held without its main one.
const BASICS = {
  Teacher: {
    // Their own classes only.
    keys: [P.MANAGE_STUDENTS, P.MARK_ATTENDANCE, P.MANAGE_ASSESSMENTS, P.CLASS_SETTINGS, P.MANAGE_REPORTS, P.REPORTS_TERMINAL],
    why: {
      [P.MANAGE_STUDENTS]: "See the students in their classes (list only: nothing to add, change or delete)",
      [P.MARK_ATTENDANCE]: "Take attendance every day",
      [P.MANAGE_ASSESSMENTS]: "Create assessments and enter scores for their classes",
      [P.CLASS_SETTINGS]: "Choose what parents and students see for the classes they lead",
      [P.REPORTS_TERMINAL]: "Print report cards for their classes",
    },
  },
  Supervisor: {
    keys: [P.MANAGE_STUDENTS, P.STUDENTS_ADD, P.STUDENTS_EDIT, P.MARK_ATTENDANCE, P.MANAGE_ASSESSMENTS, P.MANAGE_REPORTS, P.REPORTS_TERMINAL,
      P.PUBLISH_EVENTS_ANNOUNCEMENTS, P.EVENTS_ANNOUNCEMENTS, P.EVENTS_EVENTS],
    why: {
      [P.MANAGE_STUDENTS]: "See, add and change students (not delete them)",
      [P.MARK_ATTENDANCE]: "Mark attendance and run attendance reports",
      [P.MANAGE_ASSESSMENTS]: "Create assessments and enter scores",
      [P.REPORTS_TERMINAL]: "Print report cards",
      [P.PUBLISH_EVENTS_ANNOUNCEMENTS]: "Post announcements and events to the school",
    },
  },
  // Managers run the school; the few high-risk permissions below are the ones a Manager is
  // trusted with from day one. The rest are in "High risk - Managers only" (Advanced).
  Manager: {
    keys: [P.MANAGE_EMPLOYEES, P.EMPLOYEES_ADD, P.EMPLOYEES_EDIT, P.EMPLOYEES_REMOVE,
      P.MANAGE_STUDENTS, P.STUDENTS_ADD, P.STUDENTS_EDIT, P.STUDENTS_ENROLLMENT, P.STUDENTS_ALUMNI,
      P.MANAGE_CLASSES_SUBJECTS, P.MARK_ATTENDANCE, P.MANAGE_ASSESSMENTS,
      P.MANAGE_REPORTS, P.REPORTS_TERMINAL, P.REPORTS_SETTINGS,
      P.PUBLISH_EVENTS_ANNOUNCEMENTS, P.EVENTS_ANNOUNCEMENTS, P.EVENTS_EVENTS],
    why: {
      [P.MANAGE_EMPLOYEES]: "Run the staff list: add, change and hold staff (high risk)",
      [P.MANAGE_STUDENTS]: "Everything about students except deleting them",
      [P.MANAGE_CLASSES_SUBJECTS]: "Create and change classes and subjects",
      [P.MARK_ATTENDANCE]: "Mark attendance and run attendance reports",
      [P.MANAGE_ASSESSMENTS]: "Create assessments and enter scores",
      [P.MANAGE_REPORTS]: "Report cards and their settings",
      [P.PUBLISH_EVENTS_ANNOUNCEMENTS]: "Post announcements and events",
    },
  },
  // Drivers start with the Driver dashboard alone: their routes and riders.
  Driver: { keys: [], why: {} },
};

// Jobs the built-in roles don't name. They are what a school's own role ("Add a role" on the
// staff form) is best started from: the base is the account type to give it.
const SUGGESTED_ROLES = {
  "Class lead": {
    base: "Teacher",
    keys: [...BASICS.Teacher.keys, P.STUDENTS_EDIT, P.MAILROOM],
    why: "A teacher in charge of a class: also changes their students' details and messages their own families",
    left: "Staff, finance, school settings, the school website",
  },
  "Office / registrar": {
    base: "Supervisor",
    keys: [P.MANAGE_STUDENTS, P.STUDENTS_ADD, P.STUDENTS_EDIT, P.STUDENTS_ENROLLMENT, P.STUDENTS_ALUMNI, P.MANAGE_GUARDIANS, P.SEE_CONTACTS, P.EDIT_CONTACTS, P.APPROVE_ADMISSIONS, P.GENERATE_TRANSCRIPTS, P.MAILROOM],
    why: "Admissions, student and family records, transcripts and messages to families",
    left: "Fees, staff, school settings, deleting students, promotions",
  },
  "Bursar / finance": {
    base: "Supervisor",
    keys: [P.MANAGE_PAYGIRA, P.PAYGIRA_CLASSROOM, P.PAYGIRA_WORKSPACE, P.PAYGIRA_SHOW_IN_MANAGEMENT, P.PAYGIRA_OVERVIEW, P.PAYGIRA_BILLS, P.PAYGIRA_ORG_BILLS, P.PAYGIRA_SUBSCRIPTIONS, P.PAYGIRA_PAYMENTS, P.PAYGIRA_RECORD_PAYMENTS, P.PAYGIRA_RECOVERY, P.SEE_CONTACTS, P.MAILROOM],
    why: "Bills, payments, overdue balances, and reminders to families. No staff access, no settings",
    left: "Deleting bills, correcting payments, paying staff and vendors, payment settings, the school's plan (all high risk)",
  },
  "Transport lead": {
    base: "Driver",
    keys: [P.DRIVER_LEAD, P.DRIVER_STUDENT_DETAILS, P.DRIVER_FAMILY_DETAILS, P.DRIVER_ANY_ROUTE, P.MANAGE_TRANSPORTATION, P.TRANSPORT_BUSES, P.TRANSPORT_DRIVERS, P.TRANSPORT_ROUTES, P.TRANSPORT_SCHEDULES, P.TRANSPORT_STUDENTS, P.TRANSPORT_STUDENT_ROUTES, P.TRANSPORT_REPORTS],
    why: "Leads the drivers: buses, routes, schedules and who rides",
    left: "Transportation settings (high risk), everything outside transportation",
  },
  "Principal / head": {
    base: "Manager",
    keys: [P.MANAGE_STUDENTS, P.STUDENTS_ADD, P.STUDENTS_EDIT, P.STUDENTS_ENROLLMENT, P.STUDENTS_ALUMNI, P.MANAGE_CLASSES_SUBJECTS, P.MARK_ATTENDANCE, P.MANAGE_ASSESSMENTS,
      P.MANAGE_REPORTS, P.REPORTS_TERMINAL, P.REPORTS_SETTINGS, P.APPROVE_PROMOTIONS, P.MANAGE_SCHOOL_YEAR_TERMS,
      P.PUBLISH_EVENTS_ANNOUNCEMENTS, P.EVENTS_ANNOUNCEMENTS, P.EVENTS_EVENTS],
    why: "Runs the school's academic year: students, classes, scores, report cards, promotions and terms",
    left: "Fees, staff access, school settings, billing, integrations",
  },
};

// The few clear bundles the basics are grouped into. Every main permission belongs to one.
const BUNDLES = [
  { id: "students", label: "Students & families" },
  { id: "classroom", label: "Classes, attendance & assessments" },
  { id: "reports", label: "Reports" },
  { id: "communication", label: "Communication" },
  { id: "money", label: "Fees & payments" },
  { id: "transport", label: "Transportation" },
  { id: "school", label: "Staff & school" },
];

const BUNDLE_OF = {
  [P.MANAGE_STUDENTS]: "students", [P.MANAGE_GUARDIANS]: "students", [P.SEE_CONTACTS]: "students", [P.EDIT_CONTACT_TEMPLATE]: "students",
  [P.APPROVE_ADMISSIONS]: "students", [P.APPROVE_PROMOTIONS]: "students",
  [P.MANAGE_CLASSES_SUBJECTS]: "classroom", [P.MANAGE_ASSESSMENTS]: "classroom", [P.ASSESS_OTHER_SCHOOL_YEARS]: "classroom",
  [P.MARK_ATTENDANCE]: "classroom", [P.CLASS_SETTINGS]: "classroom", [P.MANAGE_RECORDS]: "classroom",
  [P.MANAGE_REPORTS]: "reports", [P.GENERATE_TRANSCRIPTS]: "reports",
  [P.PUBLISH_EVENTS_ANNOUNCEMENTS]: "communication", [P.MAILROOM]: "communication", [P.USE_MIRA]: "communication", [P.MIRA_SCHOOL_SKILLS]: "communication",
  [P.MANAGE_PAYGIRA]: "money", [P.MANAGE_BILLING]: "money",
  [P.MANAGE_TRANSPORTATION]: "transport", [P.TRANSPORT_CLASS_REPORTS]: "transport",
  [P.DRIVER_LEAD]: "transport", [P.DRIVER_STUDENT_DETAILS]: "transport", [P.DRIVER_FAMILY_DETAILS]: "transport", [P.DRIVER_REPORT_BUILDER]: "transport",
  [P.DRIVER_SCHOOL_WEBSITE]: "transport", [P.DRIVER_ANY_ROUTE]: "transport",
  [P.MANAGE_EMPLOYEES]: "school", [P.MANAGE_SCHOOL_YEAR_TERMS]: "school", [P.CUSTOM_FORMS]: "school", [P.MANAGE_SETTINGS]: "school",
};

const keyList = (keys, available) => (available ? keys.filter((k) => available.has(k)) : [...keys]);

// A role's basics for this school: only what its plan offers (`available`, a Set of keys).
// `questions`: the assessments flow is on, so a teacher also writes online tests.
function basicsFor(role, { available = null, questions = false } = {}) {
  const base = BASICS[role];
  if (!base) return [];
  let keys = [...base.keys];
  if (questions && keys.includes(P.MANAGE_ASSESSMENTS) && !keys.includes(P.SET_ASSESSMENT_QUESTIONS)) keys.push(P.SET_ASSESSMENT_QUESTIONS);
  if (!available) return keys;
  // A permission outside the plan takes its follow-ups with it.
  const kept = new Set(keyList(keys, available));
  const byKey = new Map(perms.PERMISSION_OPTIONS.map((o) => [o.key, o]));
  const chainKept = (key) => { for (let o = byKey.get(key); o && o.parent; o = byKey.get(o.parent)) if (!kept.has(o.parent)) return false; return true; };
  return keys.filter((k) => kept.has(k) && chainKept(k));
}

function basicsMap(opts) {
  return { Manager: basicsFor("Manager", opts), Teacher: basicsFor("Teacher", opts), Supervisor: basicsFor("Supervisor", opts), Driver: basicsFor("Driver", opts) };
}

// What the picker needs in the page (one small JSON).
function clientData(options) {
  const real = (options || perms.PERMISSION_OPTIONS).filter((o) => !o.retired);
  const parentOf = {};
  const label = {};
  const highRisk = [];
  const driverOnly = [];
  const driverKeys = [];
  real.forEach((o) => {
    if (o.parent) parentOf[o.key] = o.parent;
    label[o.key] = o.label;
    // Org-wide skills sits under Mira for every role, so it is not hidden like the other high-risk ones.
    if (o.highRisk && !o.anyRole) highRisk.push(o.key);
    if (o.group === "Driver") driverOnly.push(o.key);
    if (perms.isDriverPermission(o.key)) driverKeys.push(o.key);
  });
  return { parentOf, label, highRisk, driverOnly, driverKeys, bundleOf: BUNDLE_OF };
}

let logicSource = null;
// Everything views/partials/permissionPicker.ejs needs: the bundles, the page's data as safe JSON
// (inside a script tag) and the screen's rules (public/js/permissionLogic.js, the same file the tests run).
function pageData({ options, roleBasics = {}, canHighRisk = true } = {}) {
  if (logicSource === null) logicSource = require("fs").readFileSync(require("path").join(__dirname, "..", "public", "js", "permissionLogic.js"), "utf8");
  const data = { ...clientData(options), roleBasics, canHighRisk: Boolean(canHighRisk) };
  return {
    bundles: BUNDLES,
    bundleOf: BUNDLE_OF,
    json: JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, ""),
    logic: logicSource,
  };
}

module.exports = { pageData, BASICS, SUGGESTED_ROLES, BUNDLES, BUNDLE_OF, basicsFor, basicsMap, clientData };
