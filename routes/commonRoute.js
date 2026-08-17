const express = require("express");
const router = express.Router();
const { commonController } = require("../controllers/commonController");
const commonValidation = require("../validation/commonValidation");
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const { upload } = require("../middleware/s3Upload");
const checkFeatureAccess = require("../middleware/checkFeatureAccess");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const multer = require('multer');
const path = require('path');

// Separate multer config for bulk imports - uses memory storage for parsing
const bulkUploadStorage = multer.memoryStorage();
const bulkUpload = multer({ 
  storage: bulkUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const SET_ASSESSMENT_QUESTION_FEATURE_NAMES = [
  "Set Assessment Questions",
  "Assessment Questions",
];

function hasSetAssessmentQuestionsFeature(req) {
  const allowedFeatures = Array.isArray(req?.session?.allowedFeatures)
    ? req.session.allowedFeatures
    : [];
  if (!allowedFeatures.length) return false;

  const allowedSet = new Set(
    allowedFeatures.map((value) => String(value || "").trim().toLowerCase())
  );

  return SET_ASSESSMENT_QUESTION_FEATURE_NAMES.some((featureName) =>
    allowedSet.has(String(featureName || "").trim().toLowerCase())
  );
}

function requireSetAssessmentQuestionsFeature(req, res, next) {
  if (hasSetAssessmentQuestionsFeature(req)) {
    return next();
  }

  const acceptsJson = String(req.get("accept") || "").toLowerCase().includes("application/json");
  if (req.xhr || acceptsJson) {
    return res.status(403).json({
      success: false,
      error: "Set Assessment Questions feature is not enabled for this organization.",
    });
  }

  req.flash("error", "Set Assessment Questions feature is not enabled for this organization.");
  return res.redirect("/common/orgDashboard");
}

module.exports = (db) => {
  router.get("/orgDashboard", isAuthenticated, blockGuardians, (req, res) => {
  // ...removed log for clean background operation...
    return commonController.orgDashboard(req, res, db);
  });
  router.get("/feedback", isAuthenticated, blockGuardians, (req, res) =>
    commonController.feedbackGet(req, res, db)
  );
  router.post(
    "/feedback",
    isAuthenticated,
    blockGuardians,
    express.json(),
    express.urlencoded({ extended: true }),
    (req, res) => commonController.feedbackPost(req, res, db)
  );
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
  router.post("/save-order", isAuthenticated, (req, res) =>
    commonController.saveOrder(req, res, db)
  ); // Correct save order route

  router.get("/addStudent", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.addStudentGet(req, res, db)
  );
  router.post(
    "/addStudent",
    upload.any(), // ⬅️ Accept dynamic file fields like studentImage_0, studentImage_1, etc.
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    commonValidation.validateStudents, // ✅ Validate student data
    (req, res) => commonController.addStudentPost(req, res, db)
  );

  router.post(
    "/check-student-duplicates",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    express.json(),
    (req, res) => commonController.checkStudentDuplicates(req, res, db)
  );

  // Bulk student import - parse file
  router.post(
    "/parse-bulk-students",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    bulkUpload.single('bulkFile'),
    (req, res) => commonController.parseBulkStudents(req, res, db)
  );

  router.get("/publicRegister", (req, res) =>
    commonController.publicRegisterStudentGet(req, res, db)
  );
  router.post(
    "/publicRegister",
    upload.fields([
      { name: 'studentImage', maxCount: 1 },
      { name: 'guardianImage0', maxCount: 1 }
    ]),
    commonValidation.validatePublicRegister,
    commonValidation.validatePublicRegisterResult,
    (req, res) => commonController.publicRegisterStudentPost(req, res, db)
  );

  // Public guardian search (no auth required)
  router.get("/searchGuardiansPublic", (req, res) =>
    commonController.searchGuardiansPublic(req, res, db)
  );

  router.post("/createPaymentIntent", (req, res) =>
    commonController.createPaymentIntent(req, res, db)
  );
  
  router.get("/paymentCallback", (req, res) => commonController.paymentCallback(req, res, db));


  router.get("/admissionPending", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.APPROVE_ADMISSIONS), (req, res) => {
    commonController.viewPendingAdmissions(req, res, req.db);
  });
  
  router.post("/admissionPending/approve/:id", 
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.APPROVE_ADMISSIONS),
    upload.single("studentImage"),
    (req, res) => commonController.approvePendingStudent(req, res, db)
  );
  router.post("/admissionPending/reject/:id", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.APPROVE_ADMISSIONS), (req, res) =>
    commonController.rejectPendingStudent(req, res, db)
  );
  router.get("/getPendingStudentDetails/:id", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.APPROVE_ADMISSIONS), (req, res) =>
    commonController.getPendingStudentDetails(req, res, db)
  );
  router.post(
    "/savePendingStudentChanges/:id",
    checkFeatureAccess,
    isAuthenticated, // ✅ Require login
    requirePermission(PERMISSIONS.APPROVE_ADMISSIONS),
    upload.single("studentImage"),
    (req, res) => commonController.savePendingStudentChanges(req, res, db)
  );
  

  router.post("/deletePendingStudentImage/:id", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.APPROVE_ADMISSIONS), (req, res) => {
    commonController.deletePendingStudentImage(req, res, db);
  });

  router.get("/studentDetails", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.studentDetails(req, res, db)
  );
  router.get("/management", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.management(req, res, db)
  );
  router.get("/failedEmails", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.getFailedEmails(req, res, db)
  );
  router.get("/failedEmails/checkEmail", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.checkFailedEmail(req, res, db)
  );
  router.post("/failedEmails/:id/update", checkFeatureAccess, isAuthenticated, express.json(), (req, res) =>
    commonController.updateFailedEmail(req, res, db)
  );
  
  // Guardian management routes
  router.get("/guardians", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.guardiansListGet(req, res, db)
  );
  router.get("/guardianDetails", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.guardianDetailsGet(req, res, db)
  );
  router.post("/guardianEdit/:guardianId", checkFeatureAccess, isAuthenticated, upload.single("guardianImage"), (req, res) =>
    commonController.guardianEditPost(req, res, db)
  );
  router.post("/guardianRemoveStudent", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.guardianRemoveStudent(req, res, db)
  );
  router.post("/guardianRelinkStudent", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.guardianRelinkStudent(req, res, db)
  );
  router.post("/guardianRequestPasswordReset", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.guardianRequestPasswordReset(req, res, db)
  );
  router.post("/studentRequestPasswordReset", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.studentRequestPasswordReset(req, res, db)
  );
  router.post(
    "/studentRequestPasswordResetBulk",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    express.json(),
    (req, res) => commonController.studentBulkRequestPasswordReset(req, res, db)
  );
  router.post("/staffReportStudent", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.staffReportStudent(req, res, db)
  );
  router.post("/staffReplyToReport", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.staffReplyToReport(req, res, db)
  );
  router.post("/classReportReplies/:replyId/delete", checkFeatureAccess, isAuthenticated, express.json(), (req, res) =>
    commonController.classReportReplyDelete(req, res, db)
  );
  router.get("/classReports", isAuthenticated, (req, res) =>
    commonController.classReports(req, res, db)
  );
  router.get("/classReportDetail", isAuthenticated, (req, res) =>
    commonController.classReportDetail(req, res, db)
  );
  router.get("/classReportRecipients", isAuthenticated, (req, res) =>
    commonController.classReportRecipients(req, res, db)
  );
  
  router.get("/check-student-id", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.checkStudentId(req, res, db)
  );
  router.get("/editStudent", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.editStudentGet(req, res, db)
  );
  router.post(
    "/editStudent/:studentId",
    upload.single("studentImage"),
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    commonValidation.validatePublicRegister,
    commonValidation.validatePublicRegisterResult,
    (req, res) => commonController.editStudentPost(req, res, db)
  );
  router.post("/deleteStudent/:studentId", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.deleteStudent(req, res, db)
  );
  router.post("/saveAttendanceForDate", isAuthenticated, requirePermission(PERMISSIONS.MARK_ATTENDANCE), (req, res) =>
    commonController.saveAttendance(req, res, db)
  );
  router.get("/getAttendanceForClass", isAuthenticated, (req, res) =>
    commonController.getAttendanceForClass(req, res, db)
  );
  router.get(
    "/attendanceCollection",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.attendanceCollection(req, res, db)
  );
  router.get(
    "/createEmployee",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_EMPLOYEES),
    (req, res) => commonController.createEmployeeGet(req, res, db)
  );
  router.post(
    "/createEmployee",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_EMPLOYEES),
    commonValidation.validateCreateEmployees,
    commonValidation.validateCreateEmployeesResult,
    (req, res) => commonController.createEmployeePost(req, res, db)
  );
  router.get(
    "/manageEmployees",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_EMPLOYEES),
    (req, res) => commonController.manageEmployees(req, res, db)
  );
  router.get(
    "/modifyEmployee",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_EMPLOYEES),
    (req, res) => commonController.modifyEmployeeGet(req, res, db)
  );
  router.post(
    "/modifyEmployee/:userId",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_EMPLOYEES),
    commonValidation.validateCreateEmployees,
    commonValidation.validateCreateEmployeesResult,
    (req, res) => commonController.modifyEmployeePost(req, res, db)
  );
  router.post("/deleteEmployee/:userId", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EMPLOYEES), (req, res) =>
    commonController.deleteEmployee(req, res, db)
  );
  router.post("/toggleHoldEmployee/:userId", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EMPLOYEES), (req, res) =>
    commonController.toggleHoldEmployee(req, res, db)
  );
  router.get("/assessment", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.assessment(req, res, db)
  );
  router.get("/getAssessments", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.getAssessments(req, res, db)
  );
  router.get("/getScores", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.getScores(req, res, db)
  );
  router.get(
    "/manageAssessment",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS),
    (req, res) => commonController.manageAssessment(req, res, db)
  );
  router.get(
    "/allClassAssessmentExams",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS),
    requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS),
    requireSetAssessmentQuestionsFeature,
    (req, res) => commonController.allClassAssessmentExamsPage(req, res, db)
  );
  router.post("/deleteAssessment", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.deleteAssessmentPost(req, res, db)
  );
  router.post("/updateAssessmentControl", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.updateAssessmentControlPost(req, res, db)
  );
  router.post("/modifyAssessment", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.modifyAssessmentPost(req, res, db)
  );
  router.get("/modifyAssessment", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.modifyAssessmentGet(req, res, db)
  );
  router.post("/modifyAssessment", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.modifyAssessmentPost(req, res, db)
  );
  router.post("/saveAllScores", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), upload.none(), (req, res) =>
    commonController.saveAllScores(req, res, db)
  );
  router.get("/assessment/questions", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, (req, res) =>
    commonController.getAssessmentQuestionSets(req, res, db)
  );
  router.get("/assessment/options", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, (req, res) =>
    commonController.getAssessmentOptionsByScope(req, res, db)
  );
  router.post("/assessment/questions/upsert", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.upsertAssessmentQuestionSet(req, res, db)
  );
  router.post("/assessment/questions/extract-file", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, bulkUpload.single('examFile'), (req, res) =>
    commonController.extractAssessmentQuestionsFromPdf(req, res, db)
  );
  router.post("/assessment/questions/extract-pdf", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, bulkUpload.single('pdfFile'), (req, res) =>
    commonController.extractAssessmentQuestionsFromPdf(req, res, db)
  );
  router.post("/assessment/questions/review", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.reviewAssessmentQuestionSet(req, res, db)
  );
  router.post("/assessment/questions/delete", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.deleteAssessmentQuestionSet(req, res, db)
  );
  router.post("/assessment/questions/reuse", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.reuseAssessmentQuestionSet(req, res, db)
  );
  router.get("/assessment/questions/students", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, (req, res) =>
    commonController.getAssessmentQuestionSetStudents(req, res, db)
  );
  router.post("/assessment/questions/students/unlock", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.unlockAssessmentQuestionSetStudents(req, res, db)
  );
  router.post("/assessment/questions/students/post-scores", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.postAssessmentQuestionSetScores(req, res, db)
  );
  router.post("/assessment/questions/students/unpost-scores", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.unpostAssessmentQuestionSetScores(req, res, db)
  );
  router.post("/assessment/verify-answer-password", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.verifyAssessmentAnswerPassword(req, res, db)
  );
  router.get("/assessment/attempt/grade", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, (req, res) =>
    commonController.getAssessmentAttemptForGrading(req, res, db)
  );
  router.post("/assessment/attempt/grade", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.saveAssessmentAttemptGrade(req, res, db)
  );
  router.post("/assessment/control-item", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), express.json(), (req, res) =>
    commonController.updateAssessmentItemControlPost(req, res, db)
  );
  router.get("/classAssessmentExams", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.listClassAssessmentExams(req, res, db)
  );
  router.post("/classAssessmentExams/rename", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), express.json(), (req, res) =>
    commonController.renameClassAssessmentExam(req, res, db)
  );

  router.get("/getSubjectsForClass", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.getSubjectsForClass(req, res, db)
  );

  router.get(
    "/classDashboard",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.classDashboard(req, res, db)
  );
  router.get(
    "/classDashboard/:classId/:panel?/:itemId?",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.classDashboard(req, res, db)
  );
  router.get(
    "/studentTeacherRemarkOptions",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.getStudentTeacherRemarkOptions(req, res, db)
  );
  router.get(
    "/classDashboardStudentTransport",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.getClassDashboardStudentTransportSnapshot(req, res, db)
  );
  router.post(
    "/saveStudentTeacherRemark",
    checkFeatureAccess,
    isAuthenticated,
    express.json(),
    (req, res) => commonController.saveStudentTeacherRemark(req, res, db)
  );
  router.get(
    "/birthdays",
    checkFeatureAccess,
    isAuthenticated,
    (req, res) => commonController.birthdaysPageGet(req, res, db)
  );
  router.get("/classSchedule", isAuthenticated, (req, res) =>
    commonController.getClassSchedule(req, res, db)
  );
  router.post("/classSchedule/save", isAuthenticated, (req, res) =>
    commonController.saveClassSchedule(req, res, db)
  );
  router.post("/classSchedule/delete", isAuthenticated, (req, res) =>
    commonController.deleteClassSchedule(req, res, db)
  );
  router.post("/classSchedule/reuse", isAuthenticated, (req, res) =>
    commonController.reuseClassSchedule(req, res, db)
  );
  router.post("/registerSchoolYear", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.registerSchoolYear(req, res, db)
  );
  router.get(
    "/registerSchoolYear",
    checkFeatureAccess, 
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS),
    (req, res) => commonController.registerSchoolYearGet(req, res, db)
  );
  router.get("/getClasses", isAuthenticated, (req, res) =>
    commonController.getClasses(req, res, db)
  );
  router.post("/registerSchoolYearEvent", isAuthenticated, requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS), (req, res) =>
    commonController.registerSchoolYearEvent(req, res, db)
  );
  router.post("/registerSchoolYearAnnouncement", isAuthenticated, requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS), (req, res) =>
    commonController.registerSchoolYearAnnouncement(req, res, db)
  );
  router.get(
    "/manageRecords",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_RECORDS),
    (req, res) => commonController.manageRecords(req, res, db)
  );
  router.post("/updateSchoolYearAndTerms", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.updateSchoolYearAndTerms(req, res, db)
  );
  router.post(
    "/updateEvent",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    commonValidation.validateEvent,
    commonValidation.validateEventResult,
    (req, res) => commonController.updateEvent(req, res, db)
  );
  router.post(
    "/updateAnnouncement",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    commonValidation.validateAnnouncement,
    commonValidation.validateAnnouncementResult,
    (req, res) => commonController.updateAnnouncement(req, res, db)
  );

  router.get(
    "/addClassSubject",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS),
    (req, res) => commonController.addClassSubject(req, res, db)
  );
  router.post(
    "/addClass",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS),
    commonValidation.validateAddClass,
    commonValidation.validateAddClassResult,
    (req, res) => commonController.addClass(req, res, db)
  );
  router.post(
    "/addSubject",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS),
    commonValidation.validateAddSubject,
    commonValidation.validateAddSubjectResult,
    (req, res) => commonController.addSubject(req, res, db)
  );
  router.post(
    "/assignExistingSubject",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS),
    (req, res) => commonController.assignExistingSubject(req, res, db)
  );
  router.post("/updateTerm", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.updateTerm(req, res, db)
  );
  router.post("/deleteTerm", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.deleteTerm(req, res, db)
  );
  router.post(
    "/addGraduationYearGroup",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS),
    commonValidation.validateGraduationYear,
    commonValidation.validateGraduationYearResult,
    (req, res) => commonController.addGraduationYearGroup(req, res, db)
  );
  router.get("/manageClassSubjectAndGradYr", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.manageClassSubjectAndGradYr(req, res, db)
  );
  router.get("/deleteGraduationYearGroup", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.deleteGraduationYearGroup(req, res, db)
  );
  router.post("/editGraduationYearGroup", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.editGraduationYearGroup(req, res, db)
  );
  router.get("/deleteClass", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.deleteClass(req, res, db)
  );
  router.post("/editClass", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.editClass(req, res, db)
  );
  router.post("/updateClassDashboardLayout", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.updateClassDashboardLayout(req, res, db)
  );
  router.get("/getSubjectsByClass", isAuthenticated, (req, res) =>
    commonController.getSubjectsByClass(req, res, db)
  );
  router.get("/deleteStudentImage/:studentId", isAuthenticated, (req, res) =>
    commonController.deleteStudentImage(req, res, db)
  );
  router.post("/deleteStudentImage/:id", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) => {
    commonController.deleteStudentImage(req, res, db);
  });

  router.get("/deleteSubject", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.deleteSubject(req, res, db)
  );
  router.post("/editSubject", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
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
    requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS),
    (req, res) => commonController.closeSchoolYear(req, res, db)
  );
  router.get("/termDetails/:termId", checkFeatureAccess, isAuthenticated, (req, res) =>
    commonController.termDetails(req, res, db)
  );
  router.get(
    "/closeGraduationYearGroup",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS),
    (req, res) => commonController.closeGraduationYearGroup(req, res, db)
  );
  router.post("/closeGraduationYearGroupPost", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.closeGraduationYearGroupPost(req, res, db)
  );
  router.post("/deleteEvent", isAuthenticated, requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS), (req, res) =>
    commonController.deleteEvent(req, res, db)
  );
  router.post("/deleteAnnouncement", isAuthenticated, requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS), (req, res) =>
    commonController.deleteAnnouncement(req, res, db)
  );
  router.post("/deleteSchoolYear", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.deleteSchoolYear(req, res, db)
  );
  router.delete("/deleteSchoolYear", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), express.json(), (req, res) =>
    commonController.deleteSchoolYear(req, res, db)
  );
  router.post("/deleteSchoolYearPost", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.deleteSchoolYearPost(req, res, db)
  );
  router.post("/setMainEmployee", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_EMPLOYEES), (req, res) =>
    commonController.setMainEmployee(req, res, db)
  );
  router.post("/saveSingleAttendance", isAuthenticated, requirePermission(PERMISSIONS.MARK_ATTENDANCE), (req, res) =>
    commonController.saveSingleAttendance(req, res, db)
  );
  router.get("/createTest", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.createTestGet(req, res, db)
  );
  router.post("/createTest", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), (req, res) =>
    commonController.createTestPost(req, res, db)
  );

  // Event & Announcement Forms
  router.get(
    "/createEventAnnouncement",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    (req, res) => commonController.createEventAnnouncementGet(req, res, db)
  );
  router.post("/createEventAnnouncement", isAuthenticated, requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS), (req, res) =>
    commonController.createEventAnnouncementPost(req, res, db)
  );
  // Legacy alias: /common/manageSchoolYear was historically a separate page,
  // but the canonical entry point is now /common/registerSchoolYear. There is
  // no manageSchoolYearGet controller method, which used to 500 every time
  // the SPA preloader warmed this path. Redirect instead so the URL still
  // works for old bookmarks and the SPA preload doesn't error.
  router.get(
    "/manageSchoolYear",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS),
    (req, res) => res.redirect("/common/registerSchoolYear")
  );
  router.get(
    "/manageEventsAnnouncements",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    (req, res) => commonController.manageEventsAnnouncementsGet(req, res, db)
  );
  router.get(
    "/manageEventsAnnouncements/schoolYearId/:schoolYearId/termId/:termId",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    (req, res) => commonController.manageEventsAnnouncementsGet(req, res, db)
  );

  router.get("/employeeDetails", isAuthenticated, (req, res) =>
    commonController.getEmployeeDetails(req, res, db)
  );

  // Unified broadcast/announcement system (modal + banner popups) — admin UI.
  router.get(
    "/manageAnnouncements",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    (req, res) => commonController.manageAnnouncementsGet(req, res, db)
  );
  router.get(
    "/announcementComposer",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    (req, res) => commonController.announcementComposerGet(req, res, db)
  );


  // Create Event Announcement with schoolYearId and termId
  router.get(
    "/createEventAnnouncement/schoolYearId/:schoolYearId/termId/:termId",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    (req, res) => commonController.createEventAnnouncementGet(req, res, db)
  );

  router.get("/set-password", (req, res) =>
    commonController.setPasswordGet(req, res, db)
  );
  router.post("/set-password", (req, res) =>
    commonController.setPasswordPost(req, res, db)
  );

  router.get("/archivedStudents", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.archivedStudents(req, res, db)
  );
  router.post("/unarchiveStudents", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.unarchiveStudents(req, res, db)
  );
  router.get("/studentInfo", isAuthenticated, (req, res) =>
    commonController.studentInfo(req, res, db)
  );

  // Legacy pricing URL now points to unified service-plan page
  router.get('/pricing', (req, res) => {
    return res.redirect('/account/service-plan');
  });

  // Guardian search API for autocomplete
  router.get("/api/guardians/search", isAuthenticated, (req, res) =>
    commonController.searchGuardiansApi(req, res, db)
  );

  // Admissions Hub
  router.get("/admissions", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.APPROVE_ADMISSIONS), (req, res) =>
    commonController.admissionsHub(req, res, db)
  );

  // All Students list (Admissions)
  router.get("/allStudents", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.allStudents(req, res, db)
  );

  // Change student class (AJAX)
  router.post("/students/:studentId/change-class", isAuthenticated, express.json(), requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.changeStudentClass(req, res, db)
  );

  // Update student details from the All Students list (AJAX)
  router.post("/students/:studentId/update-details", isAuthenticated, express.json(), requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.updateStudentListDetails(req, res, db)
  );

  // Bulk update students — change class and/or assign school year (AJAX)
  router.post("/students/bulk-update", isAuthenticated, express.json(), requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.bulkUpdateStudents(req, res, db)
  );

  // Reports Hub
  router.get("/reports", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_REPORTS), (req, res) =>
    commonController.reportsHub(req, res, db)
  );

  // Mailroom
  router.get("/mailroom", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MAILROOM), (req, res) =>
    commonController.mailroomHub(req, res, db)
  );

  // Activity Logs (full list page, linked from the Reports Hub)
  router.get("/activityLogs", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_REPORTS), (req, res) =>
    commonController.activityLogs(req, res, db)
  );

  return router;
};
