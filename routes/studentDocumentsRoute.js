// A student's files and portfolio on the student page (utils/studentDocuments.js, feature
// student_documents): add, change, remove and open files; the portfolio's term folders and marked
// tests. The same door as the student page: Manage Students, and a teacher or supervisor only for
// students of their own classes.
const express = require("express");
const multer = require("multer");
const db = require("../config/db");
const { isAuthenticated } = require("../middleware/middleware");
const checkFeatureAccess = require("../middleware/checkFeatureAccess");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { safeUploadOptions, uploadErrorMessage } = require("../utils/uploadSafety");
const { redirectToFile } = require("../utils/storedFiles");
const documents = require("../utils/studentDocuments");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), ...safeUploadOptions({ maxMb: documents.MAX_MB, maxFiles: 1 }) });
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const door = [checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res, next) => {
  if (!documents.isOn(req.session.organizationId)) return res.status(404).send("Not found");
  return next();
}];

// Back to the student's page (kept inside a workspace panel when it was opened there).
function backTo(req, studentId) {
  const fallback = `/common/studentDetails?studentId=${studentId}`;
  try {
    const ref = new URL(req.get("referer") || "", `${req.protocol}://${req.get("host")}`);
    if (ref.host === req.get("host") && ref.pathname === "/common/studentDetails" && Number(ref.searchParams.get("studentId")) === studentId) {
      return `${ref.pathname}${ref.search}#student-documents`;
    }
    if (ref.host === req.get("host") && ref.pathname === "/common/editStudent" && Number(ref.searchParams.get("studentId")) === studentId) {
      return `${ref.pathname}${ref.search}#student-files`;
    }
  } catch (_) { /* fall back */ }
  return `${fallback}#student-documents`;
}

async function studentOf(req, id = req.params.studentId) {
  const studentId = toId(id);
  if (!studentId) return null;
  const { rows } = await db.query("SELECT student_id FROM students WHERE student_id = $1 AND organization_id = $2", [studentId, req.session.organizationId]);
  if (!rows[0]) return null;
  return (await documents.inScope(db, req, studentId)) ? studentId : null;
}

// Opened in the student page's drawer: a saved form closes the drawer and the page reloads.
const drawerOf = (req) => String((req.body && req.body.drawerId) || req.query.drawerId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
const closeDrawer = (res, drawerId) => res.type("html").send(
  `<!doctype html><meta charset="utf-8"><script>parent.postMessage({ managiraDrawerSaved: true, managiraDrawerClose: true, drawerId: ${JSON.stringify(drawerId)} }, location.origin);</script>`
);
// After a save: close the drawer, or go back to the page; after a refusal, back to the drawer's form.
function done(req, res, studentId, { ok, formPath }) {
  const drawerId = drawerOf(req);
  if (drawerId && ok) return closeDrawer(res, drawerId);
  if (drawerId && formPath) return res.redirect(`${formPath}?drawerId=${encodeURIComponent(drawerId)}`);
  return res.redirect(backTo(req, studentId));
}

async function studentInfo(studentId, organizationId) {
  const { rows } = await db.query("SELECT student_id, first_name, last_name FROM students WHERE student_id = $1 AND organization_id = $2", [studentId, organizationId]);
  return rows[0] || null;
}

function renderForm(req, res, student, doc) {
  const manager = documents.isManagerRole(req);
  res.set("Cache-Control", "private, no-store");
  return res.render("common/studentDocumentForm", {
    title: doc ? "File details" : "Add a file",
    hideGlobalHeader: true,
    hideGlobalFooter: true,
    student,
    doc,
    types: documents.TYPES,
    sharing: documents.SHARING.filter((o) => o.key !== "managers" || manager),
    maxMb: documents.MAX_MB,
    drawerId: drawerOf(req),
    messages: req.flash(),
  });
}

const actorOf = (req) => {
  const user = req.session?.user || {};
  return {
    id: Number(user.user_id || req.session?.userId) || null,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || String(req.session?.organizationName || ""),
  };
};

// The drawer's forms: a new file, or one file's details.
router.get("/:studentId(\\d+)/new", ...door, async (req, res) => {
  const studentId = await studentOf(req);
  if (!studentId) return res.status(404).send("That student wasn't found.");
  return renderForm(req, res, await studentInfo(studentId, req.session.organizationId), null);
});
router.get("/:studentId(\\d+)/:documentId(\\d+)/edit", ...door, async (req, res) => {
  const studentId = await studentOf(req);
  if (!studentId) return res.status(404).send("That student wasn't found.");
  const doc = await documents.findOne(db, req.session.organizationId, Number(req.params.documentId)).catch(() => null);
  if (!doc || Number(doc.student_id) !== studentId || !documents.visibleTo(req)(doc)) return res.status(404).send("That file wasn't found.");
  return renderForm(req, res, await studentInfo(studentId, req.session.organizationId), documents.present(doc));
});

router.post("/:studentId(\\d+)", ...door, (req, res, next) => upload.single("document")(req, res, (error) => {
  if (!error) return next();
  req.flash("error", uploadErrorMessage(error) || "That upload couldn't be accepted.");
  return done(req, res, Number(req.params.studentId), { ok: false, formPath: `/common/student-documents/${Number(req.params.studentId)}/new` });
}), async (req, res) => {
  const studentId = await studentOf(req);
  if (!studentId) return res.status(404).send("That student wasn't found.");
  try {
    if (!(await documents.ready(db))) {
      req.flash("error", "Files are still being set up for your school. Please try again later.");
      return done(req, res, studentId, { ok: false, formPath: `/common/student-documents/${studentId}/new` });
    }
    const body = { ...(req.body || {}) };
    // Only a manager or supervisor keeps a file to managers.
    if (body.sharing === "managers" && !documents.isManagerRole(req)) body.sharing = "staff";
    const result = await documents.create(db, { organizationId: req.session.organizationId, studentId, body, file: req.file, actor: actorOf(req) });
    req.flash(result.error ? "error" : "success", result.error || `Added “${result.document.title}”.`);
    return done(req, res, studentId, { ok: !result.error, formPath: `/common/student-documents/${studentId}/new` });
  } catch (error) {
    console.error("[Student documents] upload:", error.message);
    req.flash("error", "The file couldn't be saved. Please try again.");
    return done(req, res, studentId, { ok: false, formPath: `/common/student-documents/${studentId}/new` });
  }
});

router.post("/:studentId(\\d+)/:documentId(\\d+)/edit", ...door, express.urlencoded({ extended: false }), async (req, res) => {
  const studentId = await studentOf(req);
  if (!studentId) return res.status(404).send("That student wasn't found.");
  const doc = await documents.findOne(db, req.session.organizationId, Number(req.params.documentId)).catch(() => null);
  if (!doc || Number(doc.student_id) !== studentId || !documents.visibleTo(req)(doc)) return res.status(404).send("That document wasn't found.");
  // Only a manager or supervisor keeps a document to managers, or lifts that.
  if ((doc.shared_with === "managers" || req.body.sharing === "managers") && !documents.isManagerRole(req)) {
    req.flash("error", "Only a manager or supervisor can change who sees this file.");
    return done(req, res, studentId, { ok: false, formPath: `/common/student-documents/${studentId}/${doc.document_id}/edit` });
  }
  const saved = await documents.update(db, { organizationId: req.session.organizationId, studentId, documentId: doc.document_id, body: req.body || {} }).catch(() => false);
  req.flash(saved ? "success" : "error", saved ? "Saved." : "Your changes weren't saved. Please try again.");
  return done(req, res, studentId, { ok: saved, formPath: `/common/student-documents/${studentId}/${doc.document_id}/edit` });
});

router.post("/:studentId(\\d+)/:documentId(\\d+)/delete", ...door, express.urlencoded({ extended: false }), async (req, res) => {
  const studentId = await studentOf(req);
  if (!studentId) return res.status(404).send("That student wasn't found.");
  const doc = await documents.findOne(db, req.session.organizationId, Number(req.params.documentId)).catch(() => null);
  if (!doc || Number(doc.student_id) !== studentId || !documents.visibleTo(req)(doc)) return res.status(404).send("That document wasn't found.");
  const removed = await documents.remove(db, { organizationId: req.session.organizationId, studentId, documentId: doc.document_id }).catch(() => false);
  req.flash(removed ? "success" : "error", removed ? `Removed “${doc.title}”.` : "The file couldn't be removed. Please try again.");
  return done(req, res, studentId, { ok: removed, formPath: `/common/student-documents/${studentId}/${doc.document_id}/edit` });
});

// Open a document: a link that works for a few minutes, after the checks above.
router.get("/file/:documentId(\\d+)", ...door, async (req, res) => {
  const doc = await documents.findOne(db, req.session.organizationId, Number(req.params.documentId)).catch(() => null);
  if (!doc || !documents.visibleTo(req)(doc) || !(await studentOf(req, doc.student_id))) return res.status(404).send("That document wasn't found.");
  return redirectToFile(res, doc.storage_key, { downloadName: doc.file_name });
});

// The portfolio on the student page: one term's folder, drawn into the page's Portfolio tab.
const portfolio = require("../utils/portfolio");
router.get("/:studentId(\\d+)/portfolio", ...door, async (req, res) => {
  if (!portfolio.featureOn(req.session.organizationId)) return res.status(404).send("");
  const studentId = await studentOf(req);
  if (!studentId) return res.status(404).send("That student wasn't found.");
  try {
    const organizationId = req.session.organizationId;
    const terms = await portfolio.termsFor(db, organizationId, studentId);
    const wanted = toId(req.query.termId);
    const term = terms.find((t) => t.id === wanted) || terms.find((t) => t.current) || terms[0] || null;
    const data = term ? await portfolio.build(db, organizationId, studentId, term.id, { staff: true }) : null;
    res.set("Cache-Control", "private, no-store");
    return res.render("partials/portfolioFolder", {
      layout: false, terms, term, data, staff: true, labels: true,
      links: {
        term: `/common/student-documents/${studentId}/portfolio?termId=`,
        test: `/common/student-documents/${studentId}/portfolio/test/{id}`,
        report: null,
      },
    });
  } catch (error) {
    console.error("[Student portfolio] staff:", error.message);
    return res.status(500).send('<div class="pf-empty">The portfolio could not load. Try again.</div>');
  }
});

// A marked test as a document, or its PDF (?download=1).
router.get("/:studentId(\\d+)/portfolio/test/:attemptId(\\d+)", ...door, async (req, res) => {
  if (!portfolio.featureOn(req.session.organizationId)) return res.status(404).send("Not found");
  const studentId = await studentOf(req);
  if (!studentId) return res.status(404).send("That student wasn't found.");
  return require("../controllers/portfolioController").staffTest(req, res, db, studentId);
});

module.exports = router;
