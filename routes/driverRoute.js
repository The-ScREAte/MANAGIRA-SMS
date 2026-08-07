const express = require("express");
const router = express.Router();
const { isDriverAuthenticated } = require("../middleware/driverAuthMiddleware");
const { driverController } = require("../controllers/driverController");
const { upload } = require("../middleware/s3Upload");

module.exports = (db) => {
  router.get("/dashboard", isDriverAuthenticated, (req, res) =>
    driverController.dashboardGet(req, res, db)
  );

  router.get("/settings", isDriverAuthenticated, (req, res) =>
    driverController.settingsGet(req, res, db)
  );

  router.post("/settings", isDriverAuthenticated, upload.single("photo"), (req, res) =>
    driverController.settingsPost(req, res, db)
  );

  return router;
};
