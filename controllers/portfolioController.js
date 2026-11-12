"use strict";
// Student portfolios (feature student_portfolio, utils/portfolio.js): one folder per term, for
// the parent (/guardian/child/portfolio) and the student (/student/portfolio). Staff have the
// gradebook and report cards, so there is no staff page.
// A marked test opens as a document and downloads as a PDF drawn from that same page.
const portfolio = require("../utils/portfolio");

const orgOf = (req) => Number(req.session.organizationId);
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

// The folder for the term asked for (or the current one), with the term list.
async function folder(db, req, student) {
  const organizationId = orgOf(req);
  const terms = await portfolio.termsFor(db, organizationId, student.id);
  const wanted = toId(req.query.termId);
  const term = terms.find((t) => t.id === wanted) || terms.find((t) => t.current) || terms[0] || null;
  const data = term ? await portfolio.build(db, organizationId, student.id, term.id) : null;
  return { terms, term, data };
}

// The marked test as a document page, or as a PDF of that page (?download=1).
async function testPage(req, res, db, student, { back, selfPath }) {
  const doc = await portfolio.testDocument(db, orgOf(req), student.id, toId(req.params.attemptId), res.locals.publicImageUrl);
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
  const { terms, term, data } = await folder(db, req, child);
  const q = `studentId=${child.id}`;
  res.render("guardian/childPortfolio", {
    title: `${child.firstName}'s portfolio`,
    child, terms, term, data,
    links: {
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
  const { terms, term, data } = await folder(db, req, me);
  res.render("student/portfolio", {
    title: "My portfolio",
    child: me, terms, term, data,
    links: { term: "/student/portfolio?termId=", test: "/student/portfolio/test/{id}", report: data && data.reportCard && data.reportCard.url ? data.reportCard.url : null },
  });
}

async function studentTest(req, res, db) {
  if (!portfolio.featureOn(orgOf(req))) return res.redirect("/student/dashboard");
  const me = await studentRow(db, orgOf(req), Number(req.session.studentId));
  if (!me) return res.redirect("/student/dashboard");
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
};
