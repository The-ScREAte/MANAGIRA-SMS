"use strict";

// The page finder (Ctrl+K / Cmd+K, public/js/pageFinder.js): one list of the pages a member of staff
// can open, each with the words people use for it. A page is offered only when the same rule that
// builds the menus allows it (utils/workspaceAccess.js `access`), so the finder never lists a page
// the person would be sent away from. Links into Management, Reports and Admissions carry the hub's
// own address (panel, page, label), so the page opens with its menu around it.

const hub = (base, panel, page, label) =>
  `${base}?panel=${encodeURIComponent(panel)}&page=${encodeURIComponent(page)}&label=${encodeURIComponent(label)}`;
const management = (panel, page, label) => hub("/common/management", panel, page, label);
const reports = (panel, page, label) => hub("/common/reports", panel, page, label);
const admissions = (panel, page, label) => hub("/common/admissions", panel, page, label);

// show(access, on): `access` is workspaceAccess(); `on(key)` says whether a feature is released.
const PAGES = [
  { label: "Home", group: "Home", url: "/common/orgDashboard", words: "dashboard overview start classes", show: (a, on, ctx) => !ctx.driver },
  { label: "Dashboard", group: "Home", url: "/driver/dashboard", words: "home bus trip driver today", show: (a, on, ctx) => Boolean(ctx.driver) },
  { label: "Calendar", group: "Home", url: "/common/calendar", words: "events schedule dates", show: (a, on, ctx) => !ctx.driver || on("class_activities") },
  { label: "Birthdays", group: "Home", url: "/common/birthdays", words: "students staff today this week", show: (a, on, ctx) => !ctx.driver },
  { label: "Mail Room", group: "Home", url: "/common/mailroom", words: "message parents families email text sms whatsapp send inbox", show: (a, on, ctx) => ctx.can("mailroom") },

  // Admissions
  { label: "All students", group: "People", url: admissions("all-students", "/common/allStudents", "All Students"), words: "student list roster find student", show: (a) => a.admissions.students },
  { label: "Add a student", group: "People", url: admissions("create-student", "/common/addStudent", "Add New Student"), words: "new student enrol enroll register import", show: (a) => a.admissions.addStudent },
  { label: "Online applications", group: "People", url: admissions("pending", "/common/admissionPending", "Online Applications"), words: "admission applicants website applications", show: (a) => a.admissions.applications },
  { label: "Graduates & alumni", group: "People", url: admissions("former-students", "/common/archivedStudents", "Graduates & Alumni"), words: "former students archived withdrawn transferred", show: (a) => a.admissions.alumni },
  { label: "Admission settings", group: "People", url: admissions("online-admission-settings", "/common/admissionSettings", "Admission Settings"), words: "online admission student fields forms", show: (a) => a.admissions.settings },
  { label: "Users / employees", group: "People", url: management("employees", "/common/manageEmployees", "Users / Employees"), words: "staff teachers add user invite roles permissions", show: (a) => a.management.employees },
  { label: "Parents & guardians", group: "People", url: management("guardians", "/common/guardians", "Guardians"), words: "families contacts parents", show: (a) => a.management.guardians },

  // Management
  { label: "School years & terms", group: "School", url: management("school-year", "/common/manageRecords", "School years & terms"), words: "terms semester academic year register", show: (a) => a.management.schoolYears },
  { label: "Classes & subjects", group: "School", url: management("graduation", "/common/manageClassSubjectAndGradYr", "Classes, Subjects & Grad Years"), words: "grades add class add subject grad year", show: (a) => a.management.classes },
  { label: "Class settings", group: "School", url: management("class-settings", "/common/class-settings", "Class settings"), words: "share with parents lunch attendance calendar", show: (a, on) => a.management.classSettings && on("class_settings") },
  { label: "Enrollment", group: "School", url: management("enrollment", "/enrollment/manageEnrollment", "Enrollment"), words: "term roster put students in classes", show: (a) => a.management.enrollment },
  { label: "Promotion", group: "School", url: management("promotion", "/promotion/apply", "Promotion"), words: "next grade repeat promote students", show: (a) => a.management.promotion },
  { label: "Assessments", group: "Teaching", url: management("assessment-scores", "/common/manageAssessment", "Assessments"), words: "scores tests exams grades gradebook", show: (a) => a.management.assessments },
  { label: "Assessment questions", group: "Teaching", url: management("assessment-questions", "/common/allClassAssessmentExams", "Assessment Questions"), words: "online test testing room question sets", show: (a) => a.management.questions },
  { label: "Custom editor", group: "Teaching", url: management("custom-forms", "/common/custom-forms", "Custom editor"), words: "forms sections fields permission slips", show: (a, on) => a.management.customForms && on("custom_forms") },
  { label: "Docs & sheets", group: "Teaching", url: management("documents", "/documents", "Docs/Sheets"), words: "documents files spreadsheets", show: (a) => a.management.docs },
  { label: "Events, announcements & activities", group: "School", url: management("announcements-events", "/common/manageEventsAnnouncements", "Events, announcements & activities"), words: "publish news notice event", show: (a) => a.management.events },
  { label: "School website", group: "School", url: management("public-website", "/account/managePublicContent", "School Website"), words: "site design public pages gallery", show: (a) => a.management.website },
  { label: "Transportation", group: "School", url: management("transportation", "/transportation/manage", "Transportation"), words: "bus drivers routes stops riders", show: (a) => a.management.transportation },
  { label: "Weekly briefing", group: "School", url: management("weekly-briefing", "/common/briefing", "Weekly briefing"), words: "email families digest", show: (a, on) => a.management.briefing && on("weekly_briefing") },
  { label: "Email issues", group: "School", url: management("email-issues", "/common/failedEmails", "Email Issues"), words: "failed bounced emails", show: (a) => a.management.emailIssues },

  // Reports
  { label: "Terminal reports (report cards)", group: "Reports", url: reports("term-management", "/common/closeSchoolYear", "Terminal reports"), words: "report card print term results", show: (a) => a.reports.terminal },
  { label: "Transcripts", group: "Reports", url: reports("transcripts", "/common/transcripts", "Transcripts"), words: "official record gpa", show: (a) => a.reports.transcripts },
  { label: "Report settings", group: "Reports", url: reports("report-settings", "/print/reportSettings", "Report Settings"), words: "report card design grading remarks signature", show: (a) => a.reports.settings },
  { label: "Report builder", group: "Reports", url: reports("report-builder", "/common/report-builder", "Report Builder"), words: "custom reports export csv excel", show: (a) => a.reports.builder },
  { label: "Organization stats", group: "Reports", url: reports("org-stats", "/stats/organization", "View Statistics"), words: "analytics numbers insights", show: (a) => a.reports.stats },

  // Settings and integrations
  { label: "Integrations", group: "Settings", url: management("integrations", "/account/integrations", "Integrations"), words: "connect google text whatsapp portals add-ons", show: (a) => a.management.integrations },
  { label: "Mira", group: "Settings", url: management("mira", "/account/mira", "Mira"), words: "assistant ai skills access", show: (a) => a.management.mira },
  { label: "Service accounts", group: "Settings", url: management("service-accounts", "/api-access/service-accounts", "Service Accounts"), words: "api keys", show: (a) => a.management.serviceAccounts },
  { label: "Settings", group: "Settings", url: "/account/settings", words: "profile password school details billing plan notifications", show: (a, on, ctx) => !ctx.driver },
  { label: "Settings", group: "Settings", url: "/driver/settings", words: "profile password notifications alerts appearance", show: (a, on, ctx) => Boolean(ctx.driver) },
  { label: "Profile", group: "Settings", url: "/account/settings?section=profile", words: "my details photo password about me appearance", show: (a, on, ctx) => !ctx.driver },
  { label: "Customize school", group: "Settings", url: "/account/settings?section=customize", words: "logo colour color name address calendar weekend holidays school rules", show: (a, on, ctx) => !ctx.driver && Boolean(a.settings && a.settings.profile) },
  { label: "Billing & plan", group: "Settings", url: "/account/settings?section=billing", words: "subscription invoice card payment plan price where parent payments go", show: (a, on, ctx) => !ctx.driver && ctx.can("manage_billing") },
  { label: "Notifications", group: "Settings", url: "/account/settings?section=notifications", words: "alerts emails text message weekly briefing switches", show: (a, on, ctx) => !ctx.driver && on("alert_rules") },
  { label: "Two-step sign-in", group: "Settings", url: "/account/settings?section=two-step", words: "authenticator security 2fa", show: (a, on, ctx) => ctx.twoStep },
  { label: "Your access", group: "Settings", url: "/common/my-access", words: "role permissions what can i do classes", show: (a, on, ctx) => !ctx.owner && !ctx.driver },
  { label: "Help center", group: "Settings", url: "/legal/user-documentation", words: "guides documentation how to support articles", show: () => true },
];

// What people call each PayGira tab, so "bill" finds Bills and not every PayGira page.
const PAYGIRA_WORDS = {
  overview: "collected outstanding summary", "all bills": "invoices charges fees create bill", repeating: "recurring subscriptions monthly fees",
  balances: "ledger student owed fees statement credit", overdue: "arrears late owing recovery reminders", payments: "receipts record payment refund",
  "pay staff & vendors": "payouts salaries suppliers send money", settings: "online methods card fees who pays service fee",
};

// PayGira's own list (utils/workspaceAccess.js PAYGIRA_MENU), each tab a page.
function paygiraPages(access) {
  const out = [];
  for (const place of (access.paygira && access.paygira.menu) || []) {
    for (const tab of place.tabs) {
      out.push({ label: `PayGira: ${tab.label}`, group: "Money", url: tab.url, words: `paygira money ${PAYGIRA_WORDS[String(tab.label).toLowerCase()] || ""}`.trim() });
    }
  }
  return out;
}

// A teacher's or supervisor's own classes, each a page: the class opens in its workspace.
function classPages(classes) {
  return (classes || []).slice(0, 60).map((c) => ({ label: String(c.name || `Class ${c.id}`), group: "Your classes", url: `/common/classDashboard/${Number(c.id)}`, words: "class workspace students" }));
}

// ctx: { driver, perms (array of held permission keys), classes ([{id, name}]), twoStep }
function pagesFor(access, on, ctx = {}) {
  const safeOn = typeof on === "function" ? (key) => Boolean(on(key)) : () => false;
  const held = new Set((ctx.perms || []).map((key) => String(key || "").toLowerCase()));
  const full = { ...ctx, can: (...keys) => keys.some((key) => held.has(key)) };
  const list = PAGES.filter((page) => {
    try { return Boolean(page.show(access, safeOn, full)); } catch (error) { return false; }
  });
  const out = list.concat(classPages(ctx.classes), paygiraPages(access));
  // One entry per address, so a page two rules reach is listed once.
  const seen = new Set();
  return out.filter((page) => (seen.has(page.url) ? false : (seen.add(page.url), true)))
    .map(({ label, group, url, words }) => ({ label, group, url, words: words || "" }));
}

module.exports = { PAGES, pagesFor };
