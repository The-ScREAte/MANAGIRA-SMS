// Thin internal API surface consumed only by the separate Mira AI service.
// Every route here requires the shared service token (see
// middleware/internalServiceAuth.js) - never reachable from a browser
// session, and never mounted behind the public session/auth middleware.
const express = require("express");
const router = express.Router();
const { internalServiceAuth } = require("../middleware/internalServiceAuth");
const internalApiController = require("../controllers/internalApiController");

router.use(express.json());
router.use(internalServiceAuth);

router.post("/session/validate", internalApiController.validateSession);
router.get("/students/search", internalApiController.searchStudents);

module.exports = router;
