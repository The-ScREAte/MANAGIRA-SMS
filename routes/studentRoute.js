const express = require("express");
const router = express.Router();
const { isStudentAuthenticated } = require("../middleware/studentAuthMiddleware");
const studentController = require("../controllers/studentController");

module.exports = (db) => {
  router.get("/dashboard", isStudentAuthenticated, (req, res) =>
    studentController.dashboardGet(req, res, db)
  );

  router.get("/testing-room", isStudentAuthenticated, (req, res) =>
    studentController.testingRoomGet(req, res, db)
  );

  router.get("/testing-room/:assessmentId", isStudentAuthenticated, (req, res) =>
    studentController.takeAssessmentGet(req, res, db)
  );

  router.post("/testing-room/:assessmentId/autosave", isStudentAuthenticated, express.json(), (req, res) =>
    studentController.saveAssessmentDraftPost(req, res, db)
  );

  router.post("/testing-room/:assessmentId/submit", isStudentAuthenticated, express.urlencoded({ extended: true }), (req, res) =>
    studentController.submitAssessmentPost(req, res, db)
  );

  return router;
};
