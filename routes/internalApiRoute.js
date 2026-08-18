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
router.get("/guardians/search", internalApiController.searchGuardians);
router.get("/students/:studentId/fees", internalApiController.getStudentFees);
router.get("/students/:studentId/attendance", internalApiController.getStudentAttendance);
router.get("/classes", internalApiController.listClasses);
router.get("/terms", internalApiController.listTerms);
router.get("/organizations/:organizationId", internalApiController.getOrganization);
router.get("/students/:studentId/guardians", internalApiController.getStudentGuardians);
router.post("/announcements", internalApiController.createAnnouncement);
router.get("/documentation", internalApiController.listDocumentationArticles);

module.exports = router;
