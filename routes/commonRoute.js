const express = require("express");
const router = express.Router();
const { commonController } = require("../controllers/commonController");
const commonValidation = require("../validation/commonValidation");
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const { upload } = require("../middleware/s3Upload");
const checkFeatureAccess = require("../middleware/checkFeatureAccess");
const {
  getFreeTrialSettings,
  formatFreeTrialLength,
  getPremiumTrialPlan,
} = require("../utils/freeTrial");

module.exports = (db) => {
  router.get("/orgDashboard", isAuthenticated, blockGuardians, checkFeatureAccess, (req, res) => {
  // ...removed log for clean background operation...
    return commonController.orgDashboard(req, res, db);
  });
  router.get(
    "/orgDashboard/schoolYearId/:schoolYearId/termId/:termId",
    isAuthenticated,
    blockGuardians,
    (req, res) => {
  // ...removed log for clean background operation...
      return commonController.orgDashboardRestricted(req, res, db);
    }
  );
  router.get("/publicDashboard", checkFeatureAccess, (req, res) => {
    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction) {
      const school = req.schoolDetails;
      if (!school) return res.status(404).send("School not found");

      req.organizationId = school.organization_id;
    } else {
      const orgId = req.query.organizationId;
      if (!orgId)
        return res.status(400).send("Missing organizationId in development");

      req.organizationId = orgId;
      req.session.organizationId = orgId; // ✅ So save works later
    }

    // 🔁 Now pass it to the controller
    return commonController.publicDashboardContent(req, res, db);
  });
  // Add the save order route
  router.post("/save-order", (req, res) =>
    commonController.saveOrder(req, res, db)
  ); // Correct save order route

  router.get("/addStudent", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.addStudentGet(req, res, db)
  );
  router.post(
    "/addStudent",
    upload.any(), // ⬅️ Accept dynamic file fields like studentImage_0, studentImage_1, etc.
    isAuthenticated,
    commonValidation.validateStudents, // ✅ Validate student data
    (req, res) => commonController.addStudentPost(req, res, db)
  );

  router.get("/publicRegister", (req, res) =>
    commonController.publicRegisterStudentGet(req, res, db)
  );
  router.post(
    "/publicRegister",
    upload.single("studentImage"),
    commonValidation.validatePublicRegister,
    commonValidation.validatePublicRegisterResult,
    (req, res) => commonController.publicRegisterStudentPost(req, res, db)
  );

  router.post("/initializePayment", (req, res) =>
    commonController.initializePayment(req, res, db)
  );
  
  router.get("/paymentCallback", (req, res) => commonController.paymentCallback(req, res, db));


  router.get("/admissionPending", isAuthenticated, (req, res) => {
    commonController.viewPendingAdmissions(req, res, req.db);
  });
  
  router.post("/admissionPending/approve/:id", isAuthenticated, (req, res) =>
    commonController.approvePendingStudent(req, res, db)
  );
  router.post("/admissionPending/reject/:id", isAuthenticated, (req, res) =>
    commonController.rejectPendingStudent(req, res, db)
  );
  router.get("/getPendingStudentDetails/:id", isAuthenticated, (req, res) =>
    commonController.getPendingStudentDetails(req, res, db)
  );
  router.post(
    "/savePendingStudentChanges/:id",
    isAuthenticated, // ✅ Require login
    upload.single("studentImage"),
    commonValidation.validatePublicRegister,
    commonValidation.validatePublicRegisterResult,
    (req, res) => commonController.savePendingStudentChanges(req, res, db)
  );
  

  router.post("/deletePendingStudentImage/:id", isAuthenticated, (req, res) => {
    commonController.deletePendingStudentImage(req, res, db);
  });

  router.get("/studentDetails", isAuthenticated, (req, res) =>
    commonController.studentDetails(req, res, db)
  );
  router.get("/management", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.management(req, res, db)
  );
  
  // Guardian management routes
  router.get("/guardians", isAuthenticated, (req, res) =>
    commonController.guardiansListGet(req, res, db)
  );
  router.get("/guardianDetails", isAuthenticated, (req, res) =>
    commonController.guardianDetailsGet(req, res, db)
  );
  router.post("/guardianEdit/:guardianId", isAuthenticated, upload.single("guardianImage"), (req, res) =>
    commonController.guardianEditPost(req, res, db)
  );
  router.post("/guardianRemoveStudent", isAuthenticated, (req, res) =>
    commonController.guardianRemoveStudent(req, res, db)
  );
  router.post("/guardianRequestPasswordReset", isAuthenticated, (req, res) =>
    commonController.guardianRequestPasswordReset(req, res, db)
  );
  
  router.get("/editStudent", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.editStudentGet(req, res, db)
  );
  router.post(
    "/editStudent/:studentId",
    upload.single("studentImage"),
    isAuthenticated,
    commonValidation.validatePublicRegister,
    commonValidation.validatePublicRegisterResult,
    (req, res) => commonController.editStudentPost(req, res, db)
  );
  router.post("/deleteStudent/:studentId", isAuthenticated, (req, res) =>
    commonController.deleteStudent(req, res, db)
  );
  router.post("/saveAttendanceForDate", (req, res) =>
    commonController.saveAttendance(req, res, db)
  );
  router.get("/getAttendanceForClass", isAuthenticated, (req, res) =>
    commonController.getAttendanceForClass(req, res, db)
  );
  router.get(
    "/attendanceCollection",
    checkFeatureAccess,
    isAuthenticated,
    checkFeatureAccess,
    (req, res) => commonController.attendanceCollection(req, res, db)
  );
  router.get(
    "/createEmployee",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.createEmployeeGet(req, res, db)
  );
  router.post(
    "/createEmployee",
    isAuthenticated,
    commonValidation.validateCreateEmployees,
    commonValidation.validateCreateEmployeesResult,
    (req, res) => commonController.createEmployeePost(req, res, db)
  );
  router.get(
    "/manageEmployees",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.manageEmployees(req, res, db)
  );
  router.get(
    "/modifyEmployee",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.modifyEmployeeGet(req, res, db)
  );
  router.post(
    "/modifyEmployee/:userId",
    isAuthenticated,
    commonValidation.validateCreateEmployees,
    commonValidation.validateCreateEmployeesResult,
    (req, res) => commonController.modifyEmployeePost(req, res, db)
  );
  router.post("/deleteEmployee/:userId", isAuthenticated, (req, res) =>
    commonController.deleteEmployee(req, res, db)
  );
  router.post("/toggleHoldEmployee/:userId", isAuthenticated, (req, res) =>
    commonController.toggleHoldEmployee(req, res, db)
  );
  router.get("/assessment", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.assessment(req, res, db)
  );
  router.get("/getAssessments", isAuthenticated, (req, res) =>
    commonController.getAssessments(req, res, db)
  );
  router.get("/getScores", isAuthenticated, (req, res) =>
    commonController.getScores(req, res, db)
  );
  router.get(
    "/manageAssessment",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.manageAssessment(req, res, db)
  );
  router.post("/deleteAssessment", isAuthenticated, (req, res) =>
    commonController.deleteAssessmentPost(req, res, db)
  );
  router.post("/modifyAssessment", isAuthenticated, (req, res) =>
    commonController.modifyAssessmentPost(req, res, db)
  );
  router.get("/modifyAssessment", isAuthenticated, (req, res) =>
    commonController.modifyAssessmentGet(req, res, db)
  );
  router.post("/modifyAssessment", isAuthenticated, (req, res) =>
    commonController.modifyAssessmentPost(req, res, db)
  );
  router.post("/saveAllScores", isAuthenticated, upload.none(), (req, res) =>
    commonController.saveAllScores(req, res, db)
  );

  router.get("/getSubjectsForClass", (req, res) =>
    commonController.getSubjectsForClass(req, res, db)
  );

  router.get(
    "/classDashboard",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.classDashboard(req, res, db)
  );
  router.post("/registerSchoolYear", isAuthenticated, (req, res) =>
    commonController.registerSchoolYear(req, res, db)
  );
  router.get(
    "/registerSchoolYear",
    checkFeatureAccess, 
    isAuthenticated,
    (req, res) => commonController.registerSchoolYearGet(req, res, db)
  );
  router.get("/getClasses", isAuthenticated, (req, res) =>
    commonController.getClasses(req, res, db)
  );
  router.post("/registerSchoolYearEvent", isAuthenticated, (req, res) =>
    commonController.registerSchoolYearEvent(req, res, db)
  );
  router.post("/registerSchoolYearAnnouncement", isAuthenticated, (req, res) =>
    commonController.registerSchoolYearAnnouncement(req, res, db)
  );
  router.get(
    "/manageRecords",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.manageRecords(req, res, db)
  );
  router.post("/updateSchoolYearAndTerms", isAuthenticated, (req, res) =>
    commonController.updateSchoolYearAndTerms(req, res, db)
  );
  router.post(
    "/updateEvent",
    isAuthenticated,
    commonValidation.validateEvent,
    commonValidation.validateEventResult,
    (req, res) => commonController.updateEvent(req, res, db)
  );
  router.post(
    "/updateAnnouncement",
    isAuthenticated,
    commonValidation.validateAnnouncement,
    commonValidation.validateAnnouncementResult,
    (req, res) => commonController.updateAnnouncement(req, res, db)
  );

  router.get(
    "/addClassSubject",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.addClassSubject(req, res, db)
  );
  router.post(
    "/addClass",
    isAuthenticated,
    commonValidation.validateAddClass,
    commonValidation.validateAddClassResult,
    (req, res) => commonController.addClass(req, res, db)
  );
  router.post(
    "/addSubject",
    isAuthenticated,
    commonValidation.validateAddSubject,
    commonValidation.validateAddSubjectResult,
    (req, res) => commonController.addSubject(req, res, db)
  );
  router.post("/updateTerm", isAuthenticated, (req, res) =>
    commonController.updateTerm(req, res, db)
  );
  router.post("/deleteTerm", isAuthenticated, (req, res) =>
    commonController.deleteTerm(req, res, db)
  );
  router.post(
    "/addGraduationYearGroup",
    isAuthenticated,
    commonValidation.validateGraduationYear,
    commonValidation.validateGraduationYearResult,
    (req, res) => commonController.addGraduationYearGroup(req, res, db)
  );
  router.get("/manageClassSubjectAndGradYr", isAuthenticated, (req, res) =>
    commonController.manageClassSubjectAndGradYr(req, res, db)
  );
  router.get("/deleteGraduationYearGroup", isAuthenticated, (req, res) =>
    commonController.deleteGraduationYearGroup(req, res, db)
  );
  router.post("/editGraduationYearGroup", isAuthenticated, (req, res) =>
    commonController.editGraduationYearGroup(req, res, db)
  );
  router.get("/deleteClass", isAuthenticated, (req, res) =>
    commonController.deleteClass(req, res, db)
  );
  router.post("/editClass", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.editClass(req, res, db)
  );
  router.get("/getSubjectsByClass", isAuthenticated, (req, res) =>
    commonController.getSubjectsByClass(req, res, db)
  );
  router.get("/deleteStudentImage/:studentId", isAuthenticated, (req, res) =>
    commonController.deleteStudentImage(req, res, db)
  );
  router.post("/deleteStudentImage/:id", (req, res) => {
    commonController.deleteStudentImage(req, res, db);
  });

  router.get("/deleteSubject", isAuthenticated, (req, res) =>
    commonController.deleteSubject(req, res, db)
  );
  router.post("/editSubject", isAuthenticated, (req, res) =>
    commonController.editSubject(req, res, db)
  );
  router.get(
    "/getGradYearGroupByClassId",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.getGradYearGroupByClassId(req, res, db)
  );
  router.get("/getMajorityGraduationYearGroup", isAuthenticated, (req, res) =>
    commonController.getMajorityGraduationYearGroup(req, res, db)
  );
  router.get(
    "/closeSchoolYear",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.closeSchoolYear(req, res, db)
  );
  router.get("/termDetails/:termId", isAuthenticated, (req, res) =>
    commonController.termDetails(req, res, db)
  );
  router.get(
    "/closeGraduationYearGroup",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.closeGraduationYearGroup(req, res, db)
  );
  router.post("/closeGraduationYearGroupPost", isAuthenticated, (req, res) =>
    commonController.closeGraduationYearGroupPost(req, res, db)
  );
  router.post("/deleteEvent", isAuthenticated, (req, res) =>
    commonController.deleteEvent(req, res, db)
  );
  router.post("/deleteAnnouncement", isAuthenticated, (req, res) =>
    commonController.deleteAnnouncement(req, res, db)
  );
  router.post("/deleteSchoolYear", isAuthenticated, (req, res) =>
    commonController.deleteSchoolYear(req, res, db)
  );
  router.post("/deleteSchoolYearPost", isAuthenticated, (req, res) =>
    commonController.deleteSchoolYearPost(req, res, db)
  );
  router.post("/setMainEmployee", isAuthenticated, (req, res) =>
    commonController.setMainEmployee(req, res, db)
  );
  router.post("/saveSingleAttendance", (req, res) =>
    commonController.saveSingleAttendance(req, res, db)
  );
  router.get("/createTest", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.createTestGet(req, res, db)
  );
  router.post("/createTest", isAuthenticated, (req, res) =>
    commonController.createTestPost(req, res, db)
  );

  // Event & Announcement Forms
  router.get(
    "/createEventAnnouncement",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.createEventAnnouncementGet(req, res, db)
  );
  router.post("/createEventAnnouncement", isAuthenticated, (req, res) =>
    commonController.createEventAnnouncementPost(req, res, db)
  );
  router.get("/manageSchoolYear", isAuthenticated, (req, res) =>
    commonController.manageSchoolYearGet(req, res, db)
  );
  router.get(
    "/manageEventsAnnouncements",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.manageEventsAnnouncementsGet(req, res, db)
  );
  router.get(
    "/manageEventsAnnouncements/schoolYearId/:schoolYearId/termId/:termId",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.manageEventsAnnouncementsGet(req, res, db)
  );

  router.get("/employeeDetails", (req, res) =>
    commonController.getEmployeeDetails(req, res, db)
  );

  router.get("/employeeDetails", (req, res) => commonController.getEmployeeDetails(req, res, db));


  // Create Event Announcement with schoolYearId and termId
  router.get(
    "/createEventAnnouncement/schoolYearId/:schoolYearId/termId/:termId",
    isAuthenticated,
    (req, res) => commonController.createEventAnnouncementGet(req, res, db)
  );

  router.get("/set-password", (req, res) =>
    commonController.setPasswordGet(req, res, db)
  );
  router.post("/set-password", (req, res) =>
    commonController.setPasswordPost(req, res, db)
  );

  router.get("/archivedStudents", (req, res) =>
    commonController.archivedStudents(req, res, db)
  );
  router.post("/unarchiveStudents", (req, res) =>
    commonController.unarchiveStudents(req, res, db)
  );
  router.get("/studentInfo", isAuthenticated, (req, res) =>
    commonController.studentInfo(req, res, db)
  );

  // Pricing page (public, view only)
  router.get('/pricing', async (req, res) => {
    const db = req.db || require('../config/db');
    try {
      const plansResult = await db.query(`
        SELECT p.id AS plan_id, p.plan_name, p.description, p.is_active, p.plan_name AS category,
        COALESCE(JSON_AGG(json_build_object('feature_name', f.feature_name) ORDER BY f.feature_name)
        FILTER (WHERE f.id IS NOT NULL), '[]') AS features,
        COALESCE(SUM(f.price_usd), 0) AS total_price
        FROM plans p
        LEFT JOIN plan_features pf ON p.id = pf.plan_id
        LEFT JOIN features f ON pf.feature_id = f.id
        WHERE p.is_active = TRUE
        GROUP BY p.id
        ORDER BY p.id;
      `);
      const plans = plansResult.rows.map(plan => ({
        ...plan,
        total_price: parseFloat(plan.total_price) || 0,
        features: Array.isArray(plan.features) ? plan.features : []
      }));
      const trialSettings = await getFreeTrialSettings(db);
      const premiumPlan = await getPremiumTrialPlan(db);
      res.render('common/pricing', {
        title: 'Pricing',
        plans,
        messages: req.flash(),
        freeTrialEnabled: trialSettings.enabled,
        freeTrialLengthLabel: formatFreeTrialLength(trialSettings.days),
        freeTrialDays: trialSettings.days,
        premiumPlanId: premiumPlan?.id || null,
        premiumPlanName: premiumPlan?.plan_name || "",
      });
    } catch (error) {
  // ...removed error log for clean background operation...
      req.flash('error', 'Failed to fetch pricing plans.');
      res.render('common/pricing', {
        title: 'Pricing',
        plans: [],
        messages: req.flash(),
        freeTrialEnabled: false,
        freeTrialLengthLabel: null,
        freeTrialDays: null,
        premiumPlanId: null,
        premiumPlanName: "",
      });
    }
  });

  // Guardian search API for autocomplete
  router.get("/api/guardians/search", isAuthenticated, (req, res) =>
    commonController.searchGuardiansApi(req, res, db)
  );

  // Admissions Hub
  router.get("/admissions", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.admissionsHub(req, res, db)
  );

  // Reports Hub
  router.get("/reports", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.reportsHub(req, res, db)
  );

  return router;
};
