const express = require("express");
const router = express.Router();
const { isStudentAuthenticated } = require("../middleware/studentAuthMiddleware");
const studentController = require("../controllers/studentController");

const STUDENT_TESTING_ROOM_FEATURE_NAMES = [
  "Set Assessment Questions",
  "Assessment Questions",
];

function hasStudentTestingRoomFeature(req) {
  const allowedFeatures = Array.isArray(req?.session?.allowedFeatures)
    ? req.session.allowedFeatures
    : [];
  if (!allowedFeatures.length) return false;

  const normalized = new Set(
    allowedFeatures.map((featureName) => String(featureName || "").trim().toLowerCase())
  );

  return STUDENT_TESTING_ROOM_FEATURE_NAMES.some((featureName) =>
    normalized.has(String(featureName || "").trim().toLowerCase())
  );
}

function requireStudentTestingRoomFeature(req, res, next) {
  if (hasStudentTestingRoomFeature(req)) {
    return next();
  }

  const acceptsJson = String(req.get("accept") || "").toLowerCase().includes("application/json");
  if (req.xhr || acceptsJson) {
    return res.status(403).json({
      success: false,
      error: "Testing Room is not enabled for this organization.",
    });
  }

  req.flash("error", "Testing Room is not enabled for your organization.");
  return res.redirect("/student/dashboard");
}

module.exports = (db) => {
  router.get("/dashboard", isStudentAuthenticated, (req, res) =>
    studentController.dashboardGet(req, res, db)
  );

  const familyCalendar = require("../controllers/familyCalendarController");
  router.get("/family-details", isStudentAuthenticated, require("../controllers/familyDetailsController").studentGet);
  router.get("/activities", isStudentAuthenticated, require("../controllers/familyActivitiesController").studentPage);
  // A student's own settings (appearance; it isn't in the menu any more).
  router.get("/settings", isStudentAuthenticated, (req, res) => res.render("student/settings", { title: "Settings" }));
  // Forms the school asks the student to fill in, and ones it shares (feature custom_forms).
  const customForms = require("../controllers/customFormsController");
  const { upload } = require("../middleware/s3Upload");
  router.get("/forms", isStudentAuthenticated, (req, res) => customForms.studentPage(req, res, db));
  router.post("/forms/:sectionId(\\d+)", isStudentAuthenticated, express.json({ limit: "512kb" }), (req, res) => customForms.studentSave(req, res, db));
  router.post("/forms/:sectionId(\\d+)/upload", isStudentAuthenticated, upload.single("file"), (req, res) => customForms.studentUpload(req, res, db));
  // The student's own portfolio, a folder per term (feature student_portfolio).
  const portfolioController = require("../controllers/portfolioController");
  router.get("/portfolio", isStudentAuthenticated, (req, res) => portfolioController.studentPage(req, res, db));
  router.get("/portfolio/test/:attemptId(\\d+)", isStudentAuthenticated, (req, res) => portfolioController.studentTest(req, res, db));
  router.get("/calendar", isStudentAuthenticated, (req, res) => familyCalendar.studentPage(req, res, db));
  router.get("/calendar/feed", isStudentAuthenticated, (req, res) => familyCalendar.studentFeed(req, res, db));
  router.get("/calendar/sync", isStudentAuthenticated, (req, res) => familyCalendar.studentSync(req, res, db));
  router.post("/calendar/sync/reset", isStudentAuthenticated, (req, res) => familyCalendar.studentReset(req, res, db));

  router.get("/testing-room", isStudentAuthenticated, requireStudentTestingRoomFeature, (req, res) =>
    studentController.testingRoomGet(req, res, db)
  );

  router.get("/testing-room/:assessmentId", isStudentAuthenticated, requireStudentTestingRoomFeature, (req, res) =>
    studentController.takeAssessmentGet(req, res, db)
  );

  router.get("/testing-room/result/:attemptId(\\d+)", isStudentAuthenticated, requireStudentTestingRoomFeature, (req, res) =>
    studentController.testResultGet(req, res, db)
  );

  router.get("/testing-room/:assessmentId(\\d+)/resource/:fileId(\\d+)", isStudentAuthenticated, requireStudentTestingRoomFeature, (req, res) =>
    studentController.testingRoomResourceGet(req, res, db)
  );

  router.post("/testing-room/:assessmentId/autosave", isStudentAuthenticated, requireStudentTestingRoomFeature, express.json(), (req, res) =>
    studentController.saveAssessmentDraftPost(req, res, db)
  );

  router.post("/testing-room/:assessmentId/start", isStudentAuthenticated, requireStudentTestingRoomFeature, express.json(), (req, res) =>
    studentController.startAssessmentAttemptPost(req, res, db)
  );

  router.post("/testing-room/:assessmentId/lock", isStudentAuthenticated, requireStudentTestingRoomFeature, express.json(), (req, res) =>
    studentController.lockAssessmentAttemptPost(req, res, db)
  );

  router.post("/testing-room/:assessmentId/submit", isStudentAuthenticated, requireStudentTestingRoomFeature, express.urlencoded({ extended: true }), (req, res) =>
    studentController.submitAssessmentPost(req, res, db)
  );

  return router;
};
