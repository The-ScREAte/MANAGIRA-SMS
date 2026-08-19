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
router.get("/school-years", internalApiController.listSchoolYears);
router.post("/school-years/create", internalApiController.createSchoolYear);
router.post("/school-years/rename", internalApiController.renameSchoolYear);
router.post("/school-years/delete", internalApiController.deleteSchoolYear);
router.post("/school-years/terms/add", internalApiController.addTermToSchoolYear);
router.post("/school-years/terms/delete", internalApiController.deleteTermFromSchoolYear);
router.post("/classes/create", internalApiController.createClasses);
router.post("/classes/rename", internalApiController.renameClass);
router.post("/classes/delete", internalApiController.deleteClassApi);
router.post("/classes/reorder", internalApiController.reorderClasses);
router.get("/subjects", internalApiController.listSubjects);
router.post("/subjects/create", internalApiController.createSubject);
router.post("/subjects/assign", internalApiController.assignSubjectToClasses);
router.post("/subjects/rename", internalApiController.renameSubject);
router.post("/subjects/delete", internalApiController.deleteSubjectApi);
router.get("/subjects/delete-impact", internalApiController.getSubjectDeleteImpact);
router.get("/graduation-year-groups", internalApiController.listGraduationYearGroups);
router.post("/graduation-year-groups/create", internalApiController.createGraduationYearGroup);
router.post("/graduation-year-groups/rename", internalApiController.renameGraduationYearGroup);
router.post("/graduation-year-groups/delete", internalApiController.deleteGraduationYearGroupApi);
router.post("/activity-logs", internalApiController.logActivity);

module.exports = router;
