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

  // Forms the school asks drivers to fill in about their riders (feature custom_forms).
  const customForms = require("../controllers/customFormsController");
  router.get("/forms/data", isDriverAuthenticated, (req, res) => customForms.data(req, res, db));
  router.get("/forms/:id(\\d+)/students", isDriverAuthenticated, (req, res) => customForms.students(req, res, db));
  router.get("/forms/:id(\\d+)/student/:studentId(\\d+)", isDriverAuthenticated, (req, res) => customForms.entries(req, res, db));
  router.post("/forms/:id(\\d+)/student/:studentId(\\d+)", isDriverAuthenticated, express.json({ limit: "512kb" }), (req, res) => customForms.saveEntry(req, res, db));
  router.post("/forms/:id(\\d+)/upload", isDriverAuthenticated, upload.single("file"), (req, res) => customForms.staffUpload(req, res, db));
  router.post("/forms/:id(\\d+)/entry/:entryId(\\d+)/delete", isDriverAuthenticated, (req, res) => customForms.deleteEntry(req, res, db));

  return router;
};
