"use strict";
// Student portfolios (feature student_portfolio, utils/portfolio.js): one folder per term, for
// the parent (/guardian/child/portfolio) and the student (/student/portfolio), with the files the
// school shared with the family (utils/studentDocuments.js). Staff see it in the student page's
// Portfolio tab (routes/studentDocumentsRoute.js), with every marked test as a document.
// A marked test opens as a document and downloads as a PDF drawn from that same page.
const portfolio = require("../utils/portfolio");

const orgOf = (req) => Number(req.session.organizationId);
// Parents see the portfolio of the three most recent terms.
const PARENT_TERMS = 3;
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const siteUrl = (req) => `${req.protocol}://${req.get("host")}`;

async function studentRow(db, organizationId, studentId) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.image_url, s.class_id, c.class_name
       FROM students s LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND s.student_id = $2`,
    [organizationId, studentId]
  );
  const row = rows[0];
  return row ? { id: Number(row.student_id), firstName: row.first_name || "", name: [row.first_name, row.last_name].filter(Boolean).join(" "), imageUrl: row.image_url, classId: row.class_id ? Number(row.class_id) : null, className: row.class_name || "" } : null;
}

// A folder without its report card, when the class doesn't share report cards with this audience.
function withoutReportCard(data, shown) {
  if (!data || shown) return;
  if (data.reportCard) data.summary.documents = Math.max(0, data.summary.documents - 1);
  data.reportCard = null;
}

// The folder for the term asked for (or the current one), with the term list.
async function folder(db, req, student, { recent = null } = {}) {
  const organizationId = orgOf(req);
  // Newest first; parents see the most recent few terms only.
  const all = await portfolio.termsFor(db, organizationId, student.id);
  const terms = recent ? all.slice(0, recent) : all;
  const wanted = toId(req.query.termId);
  const term = terms.find((t) => t.id === wanted) || terms.find((t) => t.current) || terms[0] || null;
  const data = term ? await portfolio.build(db, organizationId, student.id, term.id) : null;
  return { terms, term, data };
}

// The marked test as a document page, or as a PDF of that page (?download=1).
async function testPage(req, res, db, student, { back, selfPath, staff = false }) {
  const doc = await portfolio.testDocument(db, orgOf(req), student.id, toId(req.params.attemptId), res.locals.publicImageUrl, { staff });
  if (!doc) {
    req.flash("error", "That test isn't in the portfolio.");
    return res.redirect(back);
  }
  if (req.query.download === "1") {
    try {
      const { renderAppPagePdf, sessionCookieFromHeader, safeFileSegment } = require("../utils/pdfService");
      const pdf = await renderAppPagePdf({ baseUrl: siteUrl(req), sessionCookie: sessionCookieFromHeader(req.headers.cookie), path: selfPath });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFileSegment(`${doc.studentName} ${doc.title}`, "test")}.pdf"`);
      res.setHeader("Cache-Control", "no-store");
      return res.send(pdf);
    } catch (error) {
      console.error("[Portfolio] pdf:", error.message);
      req.flash("error", error.userMessage || "The PDF could not be made. Try again.");
      return res.redirect(selfPath);
    }
  }
  return res.render("print/portfolioTest", { layout: false, doc, back, download: `${selfPath}${selfPath.includes("?") ? "&" : "?"}download=1` });
}

// Files the school shared with the family (feature student_documents), and the documented /
// undocumented labels that come with it.
const studentDocs = require("../utils/studentDocuments");
// audience: "parents" or "students"; the class may keep files from either (Class settings).
async function familyFiles(db, req, studentId, audience) {
  if (!studentDocs.isOn(orgOf(req))) return { files: null, labels: false };
  const classSettings = require("../utils/classSettings");
  const shown = await (audience === "students" ? classSettings.studentsSee : classSettings.parentsSee)(db, orgOf(req), studentId, "files");
  if (!shown) return { files: null, labels: true };
  return { files: await studentDocs.listFor(db, orgOf(req), studentId, { family: true }).catch(() => []), labels: true };
}

// The class may keep the portfolio itself from parents or students (Class settings).
const portfolioShared = (db, req, studentId, audience) => {
  const classSettings = require("../utils/classSettings");
  return (audience === "students" ? classSettings.studentsSee : classSettings.parentsSee)(db, orgOf(req), studentId, "portfolio");
};

// ── Parents ─────────────────────────────────────────────────────────────────────────────
async function guardianChild(db, req) {
  const { guardianHasStudentAccess } = require("./guardianController");
  const studentId = toId(req.query.studentId);
  if (!studentId || !(await guardianHasStudentAccess(db, req.session.guardianId, orgOf(req), studentId))) return null;
  return studentRow(db, orgOf(req), studentId);
}

async function guardianPage(req, res, db) {
  if (!portfolio.featureOn(orgOf(req))) return res.redirect("/guardian/dashboard");
  const child = await guardianChild(db, req);
  if (!child) {
    req.flash("error", "You do not have access to that student.");
    return res.redirect("/guardian/dashboard");
  }
  if (!(await portfolioShared(db, req, child.id, "parents"))) {
    req.flash("error", "The school doesn't share the portfolio for this class.");
    return res.redirect(`/guardian/child?studentId=${child.id}`);
  }
  const { terms, term, data } = await folder(db, req, child, { recent: PARENT_TERMS });
  // The class may keep report cards from parents (Class settings): then the folder has none.
  const showReportCard = await require("../utils/classSettings").parentsSee(db, orgOf(req), child.id, "reportCards");
  withoutReportCard(data, showReportCard);
  const q = `studentId=${child.id}`;
  const { files, labels } = await familyFiles(db, req, child.id, "parents");
  res.render("guardian/childPortfolio", {
    title: `${child.firstName}'s portfolio`,
    child, terms, term, data, showReportCard, files, labels,
    links: {
      file: `/guardian/child/student-file/{id}?${q}`,
      term: `/guardian/child/portfolio?${q}&termId=`,
      test: `/guardian/child/portfolio/test/{id}?${q}`,
      report: data && data.reportCard ? `/guardian/student-report-cards/${data.reportCard.id}/pdf` : null,
    },
  });
}

async function guardianTest(req, res, db) {
  if (!portfolio.featureOn(orgOf(req))) return res.redirect("/guardian/dashboard");
  const child = await guardianChild(db, req);
  if (!child) return res.redirect("/guardian/dashboard");
  if (!(await portfolioShared(db, req, child.id, "parents"))) return res.redirect(`/guardian/child?studentId=${child.id}`);
  return testPage(req, res, db, child, {
    back: `/guardian/child/portfolio?studentId=${child.id}`,
    selfPath: `/guardian/child/portfolio/test/${toId(req.params.attemptId)}?studentId=${child.id}`,
  });
}

// ── Students ────────────────────────────────────────────────────────────────────────────
async function studentPage(req, res, db) {
  if (!portfolio.featureOn(orgOf(req))) return res.redirect("/student/dashboard");
  const me = await studentRow(db, orgOf(req), Number(req.session.studentId));
  if (!me) return res.redirect("/student/dashboard");
  if (!(await portfolioShared(db, req, me.id, "students"))) {
    req.flash("error", "Your school doesn't share the portfolio for your class.");
    return res.redirect("/student/dashboard");
  }
  const { terms, term, data } = await folder(db, req, me);
  // The class may keep report cards from its students (Class settings): then the folder has none.
  const showReportCard = await require("../utils/classSettings").studentsSee(db, orgOf(req), me.id, "reportCards");
  withoutReportCard(data, showReportCard);
  const { files, labels } = await familyFiles(db, req, me.id, "students");
  res.render("student/portfolio", {
    title: "My portfolio",
    // The student sees percentages and how steady they are, not every piece of work.
    childView: true,
    child: me, terms, term, data, showReportCard, files, labels,
    links: { file: "/student/portfolio/file/{id}", term: "/student/portfolio?termId=", test: "/student/portfolio/test/{id}", report: data && data.reportCard ? `/student/portfolio/report-card/${data.reportCard.id}` : null },
  });
}

// GET /student/portfolio/report-card/:id: the student's own posted report card, while their class
// shares report cards with students, through a link that works for a few minutes (storage is private).
async function studentReportCard(req, res, db) {
  if (!portfolio.featureOn(orgOf(req))) return res.redirect("/student/dashboard");
  const studentId = Number(req.session.studentId);
  const { rows } = await db.query(
    "SELECT pdf_s3_key, pdf_url FROM posted_report_cards WHERE posted_report_card_id = $1 AND organization_id = $2 AND student_id = $3 LIMIT 1",
    [toId(req.params.id), orgOf(req), studentId]
  );
  const shown = rows[0] && (await require("../utils/classSettings").studentsSee(db, orgOf(req), studentId, "reportCards"));
  if (!shown) return res.status(404).send("That report card isn't available.");
  return require("../utils/storedFiles").redirectToFile(res, rows[0].pdf_s3_key || rows[0].pdf_url);
}

// GET /student/portfolio/file/:id: a file the school shared with the family, the student's own.
async function studentFile(req, res, db) {
  if (!studentDocs.isOn(orgOf(req))) return res.redirect("/student/dashboard");
  const doc = await studentDocs.findOne(db, orgOf(req), toId(req.params.id)).catch(() => null);
  const shown = doc && (await require("../utils/classSettings").studentsSee(db, orgOf(req), Number(req.session.studentId), "files"));
  if (!shown || Number(doc.student_id) !== Number(req.session.studentId) || doc.shared_with !== "family") {
    req.flash("error", "That file isn't available.");
    return res.redirect("/student/portfolio");
  }
  return require("../utils/storedFiles").redirectToFile(res, doc.storage_key, { downloadName: doc.file_name });
}

// Staff: a marked test from the student page's Portfolio tab (checked by the route).
async function staffTest(req, res, db, studentId) {
  const student = await studentRow(db, orgOf(req), studentId);
  if (!student) return res.status(404).send("That student wasn't found.");
  return testPage(req, res, db, student, {
    staff: true,
    back: `/common/studentDetails?studentId=${student.id}#student-portfolio`,
    selfPath: `/common/student-documents/${student.id}/portfolio/test/${toId(req.params.attemptId)}`,
  });
}

async function studentTest(req, res, db) {
  if (!portfolio.featureOn(orgOf(req))) return res.redirect("/student/dashboard");
  const me = await studentRow(db, orgOf(req), Number(req.session.studentId));
  if (!me) return res.redirect("/student/dashboard");
  if (!(await portfolioShared(db, req, me.id, "students"))) return res.redirect("/student/dashboard");
  return testPage(req, res, db, me, { back: "/student/portfolio", selfPath: `/student/portfolio/test/${toId(req.params.attemptId)}` });
}

const wrap = (handler, fallback) => async (req, res, db) => {
  try {
    return await handler(req, res, db);
  } catch (error) {
    console.error("[Portfolio]", error.message);
    req.flash("error", "The portfolio could not load. Try again.");
    return res.redirect(fallback);
  }
};

module.exports = {
  guardianPage: wrap(guardianPage, "/guardian/dashboard"),
  guardianTest: wrap(guardianTest, "/guardian/dashboard"),
  studentPage: wrap(studentPage, "/student/dashboard"),
  studentTest: wrap(studentTest, "/student/dashboard"),
  studentReportCard: wrap(studentReportCard, "/student/portfolio"),
  studentFile: wrap(studentFile, "/student/portfolio"),
  staffTest: wrap((req, res, db) => staffTest(req, res, db, req.params.studentId), "/common/orgDashboard"),
};
