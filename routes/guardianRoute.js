const express = require("express");
const router = express.Router();
const { isGuardianAuthenticated } = require("../middleware/guardianAuthMiddleware");
const guardianController = require("../controllers/guardianController");
const { upload } = require("../middleware/s3Upload");

module.exports = (db) => {
  router.get("/dashboard", isGuardianAuthenticated, (req, res) =>
    guardianController.dashboardGet(req, res, db)
  );

  router.get("/academic-details", isGuardianAuthenticated, (req, res) =>
    guardianController.academicDetailsGet(req, res, db)
  );

  router.get("/student", isGuardianAuthenticated, (req, res) =>
    guardianController.studentDetailsGet(req, res, db)
  );

  router.get("/studentDetails", isGuardianAuthenticated, (req, res) =>
    guardianController.studentDetailsCommonGet(req, res, db)
  );

  router.get("/settings", isGuardianAuthenticated, (req, res) =>
    guardianController.settingsGet(req, res, db)
  );

  router.post("/settings", 
    isGuardianAuthenticated,
    upload.fields([
      { name: 'guardianImage', maxCount: 1 },
      { name: 'studentImage', maxCount: 1 }
    ]),
    (req, res) => guardianController.settingsPost(req, res, db)
  );

  router.get("/report", isGuardianAuthenticated, (req, res) =>
    guardianController.reportGet(req, res, db)
  );

  router.post("/report", isGuardianAuthenticated, (req, res) =>
    guardianController.reportPost(req, res, db)
  );

  // Ticketing/Reports routes
  router.get("/reports", isGuardianAuthenticated, (req, res) =>
    guardianController.reportsListGet(req, res, db)
  );

  router.get("/reports/new", isGuardianAuthenticated, (req, res) =>
    guardianController.reportNewGet(req, res, db)
  );

  router.post("/reports/create", isGuardianAuthenticated, (req, res) =>
    guardianController.reportCreatePost(req, res, db)
  );

  router.get("/reports/:id", isGuardianAuthenticated, (req, res) =>
    guardianController.reportDetailsGet(req, res, db)
  );

  router.post("/reports/:id/reply", isGuardianAuthenticated, (req, res) =>
    guardianController.reportReplyPost(req, res, db)
  );

  return router;
};
