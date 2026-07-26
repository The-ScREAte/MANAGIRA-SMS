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

  router.get("/testing-room", isStudentAuthenticated, requireStudentTestingRoomFeature, (req, res) =>
    studentController.testingRoomGet(req, res, db)
  );

  router.get("/testing-room/:assessmentId", isStudentAuthenticated, requireStudentTestingRoomFeature, (req, res) =>
    studentController.takeAssessmentGet(req, res, db)
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
