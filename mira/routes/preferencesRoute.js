const express = require("express");
const router = express.Router();
const preferencesController = require("../controllers/preferencesController");

router.get("/", preferencesController.getPreferences);
router.put("/", preferencesController.updatePreferences);

module.exports = router;
