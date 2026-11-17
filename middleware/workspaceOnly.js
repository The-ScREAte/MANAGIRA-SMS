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
const notTeacher = (fn) => (req) => (["teacher", "driver"].includes(roleOf(req)) ? null : fn(req));
const classOf = (value) => (/^\d+$/.test(String(value || "")) ? String(value) : null);

const RULES = {
  "/common/editStudent": async (req, db) => {
    const home = await studentHome(db, req, Number(req.query.studentId), { termId: req.query.termId || null, classId: req.query.classId || null });
    if (home && home.startsWith("/common/classDashboard/")) return `${home}${home.includes("?") ? "&" : "?"}edit=1`;
    return hub("/common/admissions", "all-students", "All Students")(req);
  },
  "/common/attendanceCollection": (req) => {
    const classId = classOf(req.query.classId);
    return classId ? `/common/classDashboard/${classId}/attendance${req.query.termId ? `?termId=${encodeURIComponent(req.query.termId)}` : ""}` : null;
  },
  "/common/assessment": notTeacher(management("assessment-scores", "Assessments")),
  "/common/modifyAssessment": notTeacher(management("assessment-scores", "Assessments")),
  "/common/createTest": notTeacher(management("assessment-scores", "Assessments")),
  "/common/registerSchoolYear": notTeacher(management("school-year", "School years")),
  "/common/addClassSubject": notTeacher(management("graduation", "Classes & subjects")),
  "/documents": notTeacher(management("documents", "Docs & sheets")),
  "/common/transcripts": hub("/common/reports", "transcripts", "Transcripts"),
};

module.exports = (db) => async (req, res, next) => {
  const rule = req.method === "GET" ? RULES[req.path.replace(/\/+$/, "") || "/"] : null;
  if (!rule) return next();
  if (String(req.query.embed || "").toLowerCase() === "workspace") return next();
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
