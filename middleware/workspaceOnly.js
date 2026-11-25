"use strict";

// Pages that live inside a workspace (they hide the app header, because the workspace around them
// has one) never open on their own: opened as a page of their own (a typed address, a bookmark, a
// link from an email or another tab: Sec-Fetch-Dest "document"), each is sent to the workspace that
// hosts it, which then shows it in its panel. Inside a workspace (an iframe, ?embed=workspace), from
// a script or through the page-switcher nothing changes. The student page and Custom editor do the
// same in their own controllers (utils/studentHome.js, customFormsController).
const { studentHome } = require("../utils/studentHome");

const hub = (base, panel, label) => (req) => `${base}?panel=${panel}&page=${encodeURIComponent(req.originalUrl)}&label=${encodeURIComponent(label)}`;
const management = (panel, label) => hub("/common/management", panel, label);
const roleOf = (req) => String(req.session?.userRole || req.session?.accountType || "").trim().toLowerCase();
// Teachers work on assessments, documents and the like from their class; Management isn't theirs.
const notTeacher = (fn) => (req, db, ...rest) => (["teacher", "driver"].includes(roleOf(req)) ? null : fn(req, db, ...rest));
const admissions = (panel, label) => hub("/common/admissions", panel, label);
const reports = (panel, label) => hub("/common/reports", panel, label);
// A teacher has no Management: the same pages open in their class's workspace instead.
const staffOrTeacher = (fn, tab) => (req, db) => {
  if (!["teacher", "driver"].includes(roleOf(req))) return fn(req, db);
  const classId = classOf(req.query.classId);
  return classId ? `/common/classDashboard/${classId}${tab ? `/${tab}` : ""}` : null;
};
const classOf = (value) => (/^\d+$/.test(String(value || "")) ? String(value) : null);

// Class & notif. settings, scrolled to its Weekly briefing card.
const briefingHome = () => `/common/management?panel=class-settings&page=${encodeURIComponent("/common/class-settings?focus=briefing")}&label=${encodeURIComponent("Class & notif. settings")}`;

const RULES = {
  // Integrations lives in Management (routes/accountRoute.js).
  "/account/integrations": management("integrations", "Integrations"),
  "/common/editStudent": async (req, db) => {
    const home = await studentHome(db, req, Number(req.query.studentId), { termId: req.query.termId || null, classId: req.query.classId || null });
    if (home && home.startsWith("/common/classDashboard/")) return `${home}${home.includes("?") ? "&" : "?"}edit=1`;
    return hub("/common/admissions", "all-students", "All students")(req);
  },
  "/common/attendanceCollection": (req) => {
    const classId = classOf(req.query.classId);
    return classId ? `/common/classDashboard/${classId}/attendance${req.query.termId ? `?termId=${encodeURIComponent(req.query.termId)}` : ""}` : null;
  },
  "/common/assessment": staffOrTeacher(management("assessment-scores", "Assessments"), "subjects"),
  "/common/modifyAssessment": staffOrTeacher(management("assessment-scores", "Assessments"), "subjects"),
  "/common/createTest": staffOrTeacher(management("assessment-scores", "Assessments"), "subjects"),
  "/common/registerSchoolYear": notTeacher(management("school-year", "School years & terms")),
  "/common/addClassSubject": staffOrTeacher(management("graduation", "Classes & subjects"), "subjects"),
  "/documents": staffOrTeacher(management("documents", "Docs & sheets"), "docs"),
  "/common/transcripts": hub("/common/reports", "transcripts", "Transcripts"),
  // A report card opened by a link (a student's page, an email) shows inside Reports, with its menu.
  "/print/printStudentReport": hub("/common/reports", "term-management", "Report card"),
  // A parent's page opens at that parent in Management › Parents & guardians (the list's own record).

  // Every page the three hubs and Settings list in their menus opens inside its hub (the same panels
  // as their menu items, so a link, a bookmark or a redirect never lands on the page without the menu).
  "/common/manageRecords": notTeacher(management("school-year", "School years & terms")),
  "/common/manageClassSubjectAndGradYr": notTeacher(management("graduation", "Classes & subjects")),
  "/common/class-settings": notTeacher(management("class-settings", "Class & notif. settings")),
  "/enrollment/manageEnrollment": notTeacher(management("enrollment", "Enrollment")),
  "/enrollment/enroll": notTeacher(management("enrollment", "Enrollment")),
  "/promotion/apply": notTeacher(management("promotion", "Promotion")),
  "/promotion/preview": notTeacher(management("promotion", "Promotion")),
  "/common/manageEmployees": notTeacher(management("employees", "Users / Employees")),
  "/common/createEmployee": notTeacher(management("employees", "Users / Employees")),
  "/common/guardians": notTeacher(management("guardians", "Parents & guardians")),
  "/transportation/manage": notTeacher(management("transportation", "Transportation")),
  "/account/mira": notTeacher(management("mira", "Mira")),
  "/common/manageEventsAnnouncements": notTeacher(management("announcements-events", "Events, announcements & activities")),
  "/common/manageAnnouncements": notTeacher(management("announcements-events", "Events, announcements & activities")),
  "/common/createEventAnnouncement": notTeacher(management("announcements-events", "Events, announcements & activities")),
  "/common/announcementComposer": notTeacher(management("announcements-events", "Events, announcements & activities")),
  "/common/activities": notTeacher(management("announcements-events", "Events, announcements & activities")),
  "/account/managePublicContent": notTeacher(management("public-website", "School website")),
  "/common/migration": notTeacher(management("migration", "Data migration")),
  "/api-access/service-accounts": notTeacher(management("service-accounts", "Service accounts")),
  // The weekly briefing lives inside Class & notif. settings; the old address lands on its card.
  "/common/briefing": notTeacher((req) => briefingHome()),
  "/common/failedEmails": notTeacher(management("email-issues", "Email issues")),
  "/common/allClassAssessmentExams": staffOrTeacher(management("assessment-questions", "Assessment questions"), "assessment-questions"),
  "/common/manageAssessment": staffOrTeacher(management("assessment-scores", "Assessments"), "subjects"),
  "/common/allStudents": admissions("all-students", "All students"),
  "/common/addStudent": admissions("create-student", "Add student"),
  "/common/admissionPending": admissions("pending", "Online applications"),
  "/common/admissionSettings": admissions("online-admission-settings", "Admission settings"),
  "/common/archivedStudents": admissions("former-students", "Graduates & alumni"),
  "/common/closeGraduationYearGroup": admissions("graduate-former", "Graduate & withdraw"),
  "/stats/organization": reports("org-stats", "Organization stats"),
  "/common/closeSchoolYear": reports("term-management", "Terminal reports"),
  "/print/reportSettings": reports("report-settings", "Report settings"),
  "/common/report-builder": reports("report-builder", "Report builder"),
  "/common/guardianDetails": notTeacher(async (req, db) => {
    const id = Number.parseInt(req.query.guardianId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    let key = `${req.query.source === "profile" ? "profile" : "legacy"}:${id}`;
    if (key.startsWith("legacy:")) {
      const listed = await require("../controllers/personCardController").listedParent(db, Number(req.session.organizationId), id).catch(() => null);
      if (listed) key = `${listed.source}:${listed.id}`;
    }
    return `/common/management?panel=guardians&page=${encodeURIComponent(`/common/guardians?open=${key}`)}&label=${encodeURIComponent("Parents & guardians")}`;
  }),
};

// Windows that open in a drawer or a panel (a person's card, a student's file form, the briefing preview):
// opened on their own they go to the page they belong to.
const PATTERNS = [
  [/^\/common\/person-card\/student\/(\d+)$/, async (req, db, m) => studentHome(db, req, Number(m[1]), {}).then((home) => home || admissions("all-students", "All students")(req)).catch(() => null)],
  [/^\/common\/person-card\/staff\/(\d+)$/, notTeacher((req, db, m) => management("employees", "Users / Employees")({ originalUrl: `/common/manageEmployees?user=${m[1]}` }))],
  [/^\/common\/person-card\/guardian\/(\d+)$/, notTeacher((req, db, m) => management("guardians", "Parents & guardians")({ originalUrl: `/common/guardians?open=profile:${m[1]}` }))],
  [/^\/common\/student-documents\/(\d+)\/(new|portfolio|\d+\/edit)$/, async (req, db, m) => {
    const home = await studentHome(db, req, Number(m[1]), {}).catch(() => null);
    return home ? `${home}#${m[2] === "portfolio" ? "portfolio" : "files"}` : null;
  }],
  [/^\/documents\/(edit\/.*|\d+)$/, staffOrTeacher(management("documents", "Docs & sheets"), "docs")],
  [/^\/common\/briefing\/(preview|students)$/, notTeacher(() => briefingHome())],
  [/^\/common\/briefing\/class\/(\d+)$/, notTeacher((req, db, m) => `/common/classDashboard/${m[1]}/settings`)],
  [/^\/common\/migration\/(old-records|roles\/report)$/, notTeacher(management("migration", "Data migration"))],
];

const ruleFor = (path) => {
  const clean = path.replace(/\/+$/, "") || "/";
  if (RULES[clean]) return RULES[clean];
  for (const [pattern, fn] of PATTERNS) {
    const m = pattern.exec(clean);
    if (m) return (req, db) => fn(req, db, m);
  }
  return null;
};

module.exports = (db) => async (req, res, next) => {
  const rule = req.method === "GET" ? ruleFor(req.path) : null;
  if (!rule) return next();
  if (String(req.query.embed || "").toLowerCase() === "workspace") return next();
  // A page drawn for a PDF or a print (utils/pdfService.js sends X-Managira-Render: pdf) is the page
  // itself: sent into a workspace, the PDF waited for a page that never came (View Statistics).
  if (req.get("X-Managira-Render") === "pdf" || req.query.pdf || req.query.print || req.query.export) return next();
  if (String(req.get("Sec-Fetch-Dest") || "").toLowerCase() !== "document") return next();
  if (!req.session || !(req.session.userId || req.session.user) || req.session.guardianId || req.session.studentId) return next();
  try {
    const to = await rule(req, db);
    if (to && to !== req.originalUrl) return res.redirect(to);
  } catch (error) {
    console.error("[workspaceOnly]", error.message);
  }
  return next();
};
