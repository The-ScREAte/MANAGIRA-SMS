const express = require("express");
const { checkRateLimit } = require("../utils/rateLimiter");
const router = express.Router();
const { commonController } = require("../controllers/commonController");
const commonValidation = require("../validation/commonValidation");
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const { upload } = require("../middleware/s3Upload");
const checkFeatureAccess = require("../middleware/checkFeatureAccess");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const websiteController = require("../controllers/websiteController");
const workspaceController = require("../controllers/workspaceController");
const contactsController = require("../controllers/contactsController");
const admissionSettingsController = require("../controllers/admissionSettingsController");
const reportBuilderController = require("../controllers/reportBuilderController");
const { WORKSPACE_PERMISSIONS } = require("../utils/workspaceAccess");
const { isOrgMember } = require("../utils/workspace");
const multer = require('multer');
const path = require('path');
const {
  ensureExternalSchoolWebsiteSchema,
  normalizeExternalSchoolWebsiteUrl,
} = require("../utils/externalSchoolWebsite");
const activitiesController = require("../controllers/activitiesController");
const parentResourcesController = require("../controllers/parentResourcesController");

function redirectToExternalSchoolWebsite(db) {
  return async (req, res, next) => {
    const organizationId = req.schoolDetails?.organization_id || req.query.organizationId;
    if (!Number.isInteger(Number(organizationId)) || Number(organizationId) < 1) return next();

    try {
      await ensureExternalSchoolWebsiteSchema(db);
      const { rows } = await db.query(
        "SELECT external_website_url FROM organizations WHERE organization_id = $1",
        [Number(organizationId)]
      );
      const { url } = normalizeExternalSchoolWebsiteUrl(rows[0]?.external_website_url);
      if (url) return res.redirect(302, url);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

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
  const reportBuilder = reportBuilderController(db);
  router.get("/orgDashboard", isAuthenticated, blockGuardians, async (req, res) => {
    // Imported staff see their access first, once (controllers/staffAccessController.js).
    if (await require("../controllers/staffAccessController").firstVisit(req, res, db)) return;
    return commonController.orgDashboard(req, res, db);
  });
  // "Your access": a member of staff's role, classes and what they can do; admins open anyone's.
  router.get("/my-access", isAuthenticated, blockGuardians, (req, res) => require("../controllers/staffAccessController").page(req, res, db));
  router.get("/my-access/:userId(\\d+)", isAuthenticated, blockGuardians, (req, res) => require("../controllers/staffAccessController").page(req, res, db));
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
  // Public website contact form (no sign-in).
  router.post("/publicContact", require("../utils/humanCheck").requireHuman("school-contact", { perHour: 10 }), websiteController.publicContact);
  router.get("/publicDashboard", checkFeatureAccess, redirectToExternalSchoolWebsite(db), async (req, res) => {
    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction) {
      const school = req.schoolDetails;
      if (!school) {
        // Links of the form /common/publicDashboard?organizationId=63 (on the
        // main domain) go to that school's own website address.
        const orgId = Number(req.query.organizationId);
        if (Number.isInteger(orgId) && orgId > 0) {
          try {
            // checkFeatureAccess has already allowed this school's website.
            const { rows } = await db.query("SELECT nickname FROM organizations WHERE organization_id = $1", [orgId]);
            const subdomain = String((rows[0] && rows[0].nickname) || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
            if (subdomain) {
              const siteUrl = `https://${subdomain}.managira.com`;
              const params = new URLSearchParams(req.query);
              params.delete("organizationId");
              const rest = params.toString();
              return res.redirect(302, rest ? `${siteUrl}/common/publicDashboard?${rest}` : `${siteUrl}/`);
            }
          } catch (error) {
            console.error("[PublicDashboard] website lookup failed:", error.message);
          }
        }
        return res.status(404).send("School website not found");
      }

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
// Correct save order route

  router.get("/addStudent", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.STUDENTS_ADD), (req, res) =>
    commonController.addStudentGet(req, res, db)
  );
  router.post(
    "/addStudent",
    upload.any(), // ⬅️ Accept dynamic file fields like studentImage_0, studentImage_1, etc.
    isAuthenticated,
    requirePermission(PERMISSIONS.STUDENTS_ADD),
    commonValidation.validateStudents, // ✅ Validate student data
    (req, res) => commonController.addStudentPost(req, res, db)
  );

  router.post(
    "/check-student-duplicates",
    isAuthenticated,
    requirePermission(PERMISSIONS.STUDENTS_ADD),
    express.json(),
    (req, res) => commonController.checkStudentDuplicates(req, res, db)
  );

  // Bulk student import - parse file
  router.post(
    "/parse-bulk-students",
    isAuthenticated,
    requirePermission(PERMISSIONS.STUDENTS_ADD),
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
    // A person, not a bot (utils/humanCheck.js): a family may apply for a few children at once.
    require("../utils/humanCheck").requireHuman("admission", { perHour: 20 }),
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
  router.post("/admissionPending/reverse/:id(\\d+)", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.APPROVE_ADMISSIONS), (req, res) =>
    commonController.reversePendingRejection(req, res, db)
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
  router.get("/guardians", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_GUARDIANS), (req, res) =>
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
  // Parent messages: one link for notifications, Mail Room's inbox, and status.
  router.get("/parent-messages/:id(\\d+)", isAuthenticated, (req, res) => commonController.parentMessageOpen(req, res, db));
  router.post("/parent-messages/:id(\\d+)/status", isAuthenticated, express.json(), (req, res) => commonController.parentMessageStatus(req, res, db));
  router.get("/mailroom/inbox", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MAILROOM), (req, res) => commonController.mailroomInbox(req, res, db));

  // Admissions > Admission Settings (online admission + student form fields).
  // Permission (Manage Settings) is checked in the controller.
  router.get("/admissionSettings", checkFeatureAccess, isAuthenticated, blockGuardians, admissionSettingsController.page);
  router.post("/admissionSettings/fields", isAuthenticated, blockGuardians, express.json(), admissionSettingsController.fieldsApi("create"));
  router.post("/admissionSettings/fields/order", isAuthenticated, blockGuardians, express.json(), admissionSettingsController.fieldsApi("order"));
  router.post("/admissionSettings/fields/indicators", isAuthenticated, blockGuardians, express.json(), admissionSettingsController.fieldsApi("indicators"));
  router.post("/admissionSettings/fields/:id(\\d+)", isAuthenticated, blockGuardians, express.json(), admissionSettingsController.fieldsApi("update"));
  router.post("/admissionSettings/fields/:id(\\d+)/status", isAuthenticated, blockGuardians, express.json(), admissionSettingsController.fieldsApi("status"));
  router.post("/admissionSettings/fields/:id(\\d+)/delete", isAuthenticated, blockGuardians, express.json(), admissionSettingsController.fieldsApi("delete"));

  // Contact cards (Mail Room) and the contact template (Management Tools).
  // Permission checks (see / edit contacts, edit template) are in the controller.
  router.get("/contacts/card", isAuthenticated, blockGuardians, contactsController.card);
  router.post("/contacts/card", isAuthenticated, blockGuardians, express.json(), contactsController.saveCard);
  router.get("/contact-template", isAuthenticated, blockGuardians, contactsController.templatePage);
  router.post("/contact-template/fields", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("create"));
  router.post("/contact-template/fields/:id(\\d+)", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("update"));
  router.post("/contact-template/fields/:id(\\d+)/status", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("status"));
  router.post("/contact-template/fields/:id(\\d+)/delete", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("delete"));
  router.post("/contact-template/sections", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("createSection"));
  router.post("/contact-template/sections/:id(\\d+)", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("renameSection"));
  router.post("/contact-template/sections/:id(\\d+)/delete", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("deleteSection"));
  router.post("/contact-template/sections/:id(\\d+)/sharing", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("shareSection"));
  router.post("/contact-template/order", isAuthenticated, blockGuardians, express.json(), contactsController.templateApi("order"));
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
  router.get("/editStudent", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.STUDENTS_EDIT), (req, res) =>
    commonController.editStudentGet(req, res, db)
  );
  router.post(
    "/editStudent/:studentId",
    upload.single("studentImage"),
    isAuthenticated,
    requirePermission(PERMISSIONS.STUDENTS_EDIT),
    commonValidation.validatePublicRegister,
    commonValidation.validatePublicRegisterResult,
    (req, res) => commonController.editStudentPost(req, res, db)
  );
  router.post("/deleteStudent/:studentId", isAuthenticated, requirePermission(PERMISSIONS.STUDENTS_DELETE), (req, res) =>
    commonController.deleteStudent(req, res, db)
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
    requirePermission(PERMISSIONS.EMPLOYEES_ADD),
    (req, res) => commonController.createEmployeeGet(req, res, db)
  );
  router.post(
    "/createEmployee",
    isAuthenticated,
    requirePermission(PERMISSIONS.EMPLOYEES_ADD),
    commonValidation.validateCreateEmployees,
    commonValidation.validateCreateEmployeesResult,
    (req, res) => commonController.createEmployeePost(req, res, db)
  );
  // A school's own staff roles, made and changed from Add user and Edit user (utils/schoolRoles.js).
  {
    const schoolRoleRoutes = require("../utils/schoolRoles").handlers(db);
    const staffForm = requirePermission([PERMISSIONS.EMPLOYEES_ADD, PERMISSIONS.EMPLOYEES_EDIT]);
    router.post("/school-roles", isAuthenticated, staffForm, express.json({ limit: "64kb" }), schoolRoleRoutes.create);
    router.post("/school-roles/:roleId(\\d+)", isAuthenticated, staffForm, express.json({ limit: "64kb" }), schoolRoleRoutes.update);
    router.post("/school-roles/:roleId(\\d+)/remove", isAuthenticated, staffForm, schoolRoleRoutes.remove);
  }
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
    requirePermission(PERMISSIONS.EMPLOYEES_EDIT),
    (req, res) => commonController.modifyEmployeeGet(req, res, db)
  );
  router.post(
    "/modifyEmployee/:userId",
    isAuthenticated,
    requirePermission(PERMISSIONS.EMPLOYEES_EDIT),
    commonValidation.validateCreateEmployees,
    commonValidation.validateCreateEmployeesResult,
    (req, res) => commonController.modifyEmployeePost(req, res, db)
  );
  router.post("/deleteEmployee/:userId", isAuthenticated, requirePermission(PERMISSIONS.EMPLOYEES_REMOVE), (req, res) =>
    commonController.deleteEmployee(req, res, db)
  );
  router.post("/enableEmployee/:userId", isAuthenticated, requirePermission(PERMISSIONS.EMPLOYEES_REMOVE), (req, res) =>
    commonController.enableRemovedEmployee(req, res, db)
  );
  router.post("/toggleHoldEmployee/:userId", isAuthenticated, requirePermission(PERMISSIONS.EMPLOYEES_REMOVE), (req, res) =>
    commonController.toggleHoldEmployee(req, res, db)
  );
  // A teacher's gradebook: only the classes and subjects they teach (utils/classScope.js).
  const classScope = require("../utils/classScope").requireClassScope(db);
  router.get("/assessment", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), classScope, (req, res) =>
    commonController.assessment(req, res, db)
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
    // A follow-up of Manage Assessments, so holding it means holding both.
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
  router.post("/saveAllScores", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), upload.none(), classScope, (req, res) =>
    commonController.saveAllScores(req, res, db)
  );
  // A teacher works only on the online tests of the subjects they teach (utils/questionScope.js).
  const { requireQuestionScope } = require("../utils/questionScope");
  const questionScope = requireQuestionScope(db);
  router.get("/assessment/questions/bank", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, (req, res) =>
    commonController.getQuestionBank(req, res, db)
  );
  router.get("/assessment/questions", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, questionScope, (req, res) =>
    commonController.getAssessmentQuestionSets(req, res, db)
  );
  router.get("/assessment/options", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, questionScope, (req, res) =>
    commonController.getAssessmentOptionsByScope(req, res, db)
  );
  router.get("/activities", isAuthenticated, blockGuardians, (req, res) => activitiesController.page(req, res, db));
  router.get("/activities/list", isAuthenticated, blockGuardians, (req, res) => activitiesController.list(req, res, db));
  router.get("/activities/students", isAuthenticated, blockGuardians, (req, res) => activitiesController.students(req, res, db));
  router.get("/activities/classes", isAuthenticated, blockGuardians, (req, res) => activitiesController.classes(req, res, db));
  router.post("/activities/save", isAuthenticated, blockGuardians, express.json(), (req, res) => activitiesController.save(req, res, db));
  router.post("/activities/:id(\\d+)/delete", isAuthenticated, blockGuardians, express.json(), (req, res) => activitiesController.remove(req, res, db));

  const parentPortalGuards = [isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature];
  router.get("/assessment/questions/parent-portal", ...parentPortalGuards, questionScope, (req, res) => parentResourcesController.read(req, res, db));
  router.post("/assessment/questions/parent-portal", ...parentPortalGuards, express.json(), questionScope, (req, res) => parentResourcesController.save(req, res, db));
  router.post("/assessment/questions/parent-portal/files", ...parentPortalGuards, upload.array("files", 10), questionScope, (req, res) => parentResourcesController.addFiles(req, res, db));
  router.post("/assessment/questions/parent-portal/link", ...parentPortalGuards, express.json(), questionScope, (req, res) => parentResourcesController.addLink(req, res, db));
  router.post("/assessment/questions/parent-portal/files/:id(\\d+)/delete", ...parentPortalGuards, requireQuestionScope(db, { resourceParam: "id" }), (req, res) => parentResourcesController.removeFile(req, res, db));

  router.post("/assessment/questions/upsert", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), questionScope, (req, res) =>
    commonController.upsertAssessmentQuestionSet(req, res, db)
  );
  router.post("/assessment/questions/extract-file", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, bulkUpload.single('examFile'), (req, res) =>
    commonController.extractAssessmentQuestionsFromPdf(req, res, db)
  );
  router.post("/assessment/questions/review", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), questionScope, (req, res) =>
    commonController.reviewAssessmentQuestionSet(req, res, db)
  );
  router.post("/assessment/questions/delete", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), questionScope, (req, res) =>
    commonController.deleteAssessmentQuestionSet(req, res, db)
  );
  router.post("/assessment/questions/reuse", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), questionScope, (req, res) =>
    commonController.reuseAssessmentQuestionSet(req, res, db)
  );
  router.get("/assessment/questions/students", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, questionScope, (req, res) =>
    commonController.getAssessmentQuestionSetStudents(req, res, db)
  );
  router.post("/assessment/questions/students/unlock", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), questionScope, (req, res) =>
    commonController.unlockAssessmentQuestionSetStudents(req, res, db)
  );
  router.post("/assessment/questions/students/post-scores", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), questionScope, (req, res) =>
    commonController.postAssessmentQuestionSetScores(req, res, db)
  );
  router.post("/assessment/questions/students/unpost-scores", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), questionScope, (req, res) =>
    commonController.unpostAssessmentQuestionSetScores(req, res, db)
  );
  router.post("/assessment/verify-answer-password", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), (req, res) =>
    commonController.verifyAssessmentAnswerPassword(req, res, db)
  );
  router.get("/assessment/attempt/grade", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, questionScope, (req, res) =>
    commonController.getAssessmentAttemptForGrading(req, res, db)
  );
  router.post("/assessment/attempt/grade", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature, express.json(), questionScope, (req, res) =>
    commonController.saveAssessmentAttemptGrade(req, res, db)
  );

  // The assessments flow (feature assessment_flow): approving grades, the gradebook's columns,
  // question pictures and the library of earlier questions (controllers/assessmentFlowController.js).
  const assessmentFlow = require("../controllers/assessmentFlowController");
  const questionGuards = [isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), requirePermission(PERMISSIONS.SET_ASSESSMENT_QUESTIONS), requireSetAssessmentQuestionsFeature];
  router.post("/assessment/approve", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS), express.json(), questionScope, (req, res) => assessmentFlow.approve(req, res, db));
  router.post("/gradebook/view", isAuthenticated, blockGuardians, express.json(), (req, res) => assessmentFlow.saveGradebookView(req, res));
  router.post("/assessment/questions/image", ...questionGuards, upload.single("image"), (req, res) => assessmentFlow.uploadQuestionImage(req, res));
  router.post("/assessment/questions/help-file", ...questionGuards, upload.single("file"), (req, res) => parentResourcesController.questionHelpFile(req, res));
  router.get("/assessment/questions/library", ...questionGuards, (req, res) => assessmentFlow.library(req, res, db));
  router.get("/assessment/questions/library/:setId(\\d+)", ...questionGuards, (req, res) => assessmentFlow.librarySet(req, res, db));

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
  router.post(
    "/classroomTermView",
    isAuthenticated,
    express.json(),
    (req, res) => commonController.setClassroomTermView(req, res, db)
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
  router.get(
    "/manageRecords",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission([PERMISSIONS.MANAGE_RECORDS, PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS]),
    (req, res) => commonController.manageRecords(req, res, db)
  );
  router.post("/updateSchoolYearAndTerms", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.updateSchoolYearAndTerms(req, res, db)
  );
  router.post(
    "/updateEvent",
    isAuthenticated,
    requirePermission(PERMISSIONS.EVENTS_EVENTS),
    commonValidation.validateEvent,
    commonValidation.validateEventResult,
    (req, res) => commonController.updateEvent(req, res, db)
  );
  router.post(
    "/updateAnnouncement",
    isAuthenticated,
    requirePermission(PERMISSIONS.EVENTS_ANNOUNCEMENTS),
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
  router.post("/deleteTerm", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.deleteTerm(req, res, db)
  );
  // The school's term names (term library): rename everywhere, remove when unused.
  router.post("/termLibrary/rename", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), express.json(), (req, res) =>
    commonController.renameTermName(req, res, db)
  );
  router.post("/termLibrary/remove", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), express.json(), (req, res) =>
    commonController.removeTermName(req, res, db)
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
  // Setup steps: what the school still has to set up (bottom bar).
  const setupChecklist = require("../utils/setupChecklist");
  const setupStepsAccess = (req, res, next) =>
    setupChecklist.canSeeSetupSteps(req.session) ? next() : res.status(403).json({ error: "Setup steps are for the school's managers." });
  router.get("/setupSteps", isAuthenticated, setupStepsAccess, async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      return res.json(await setupChecklist.getSetupChecklist(db, req.session.organizationId, res.locals.allowedFeatures));
    } catch (error) {
      console.error("[setupSteps]", error.message);
      return res.status(500).json({ error: "Setup steps couldn't be loaded." });
    }
  });
  router.post("/setupSteps/skip", isAuthenticated, setupStepsAccess, express.json(), async (req, res) => {
    try {
      const userId = req.session.userId || (req.session.user && req.session.user.user_id) || null;
      const result = await setupChecklist.setStepSkipped(db, req.session.organizationId, String((req.body || {}).key || ""), Boolean((req.body || {}).skip), userId);
      if (!result.ok) return res.status(result.status).json({ error: result.message });
      return res.json(await setupChecklist.getSetupChecklist(db, req.session.organizationId, res.locals.allowedFeatures));
    } catch (error) {
      console.error("[setupSteps/skip]", error.message);
      return res.status(500).json({ error: "That couldn't be saved." });
    }
  });

  // Make obsolete / restore (kept on every record that already uses it).
  const { obsoleteHandler } = require("../utils/obsolete");
  router.post(
    "/obsolete/records",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS),
    express.json(),
    express.urlencoded({ extended: false }),
    obsoleteHandler(db, { kinds: ["class", "subject", "gradGroup"], fallbackRedirect: "/common/manageClassSubjectAndGradYr" })
  );
  router.post(
    "/obsolete/assessment",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_ASSESSMENTS),
    express.json(),
    express.urlencoded({ extended: false }),
    obsoleteHandler(db, { kinds: ["assessment"], fallbackRedirect: "/common/manageAssessment" })
  );
  router.post("/editClass", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.editClass(req, res, db)
  );
  // Each person's own order of a side menu (Class Tools and the hub menus):
  // GET ?menu=  ->  { order }, POST { menu, order: [keys] | null to reset }.
  const ARRANGEABLE_MENUS = ["classroom", "management", "admissions", "reports", "paygira"];
  const menuOf = (value) => (ARRANGEABLE_MENUS.includes(String(value)) ? String(value) : null);
  router.get("/ui-preferences/menu-order", isAuthenticated, async (req, res) => {
    const menu = menuOf(req.query.menu);
    if (!menu) return res.status(400).json({ success: false, message: "Unknown menu." });
    try {
      const order = await require("../utils/uiPreferences").getPreference(req.session, `menu-order:${menu}`);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, order: Array.isArray(order) ? order : [] });
    } catch (error) {
      console.error("[ui-preferences/menu-order]", error.message);
      return res.status(500).json({ success: false, message: "Your menu order couldn't be loaded." });
    }
  });
  router.post("/ui-preferences/menu-order", isAuthenticated, express.json(), async (req, res) => {
    try {
      const menu = menuOf(req.body && req.body.menu);
      const raw = req.body && req.body.order;
      const order = raw === null ? null : (Array.isArray(raw) ? [...new Set(raw.map(String).filter((k) => /^[a-z0-9][a-z0-9-]{0,59}$/.test(k)))].slice(0, 40) : undefined);
      if (!menu || order === undefined) return res.status(400).json({ success: false, message: "Send the menu and its order." });
      await require("../utils/uiPreferences").setPreference(req.session, `menu-order:${menu}`, order && order.length ? order : null);
      return res.json({ success: true, order: order || [] });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("[ui-preferences/menu-order]", error.message);
      return res.status(500).json({ success: false, message: "Your menu order couldn't be saved. Try again." });
    }
  });
  router.post("/updateClassDashboardLayout", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.updateClassDashboardLayout(req, res, db)
  );
  router.get("/getSubjectsByClass", isAuthenticated, (req, res) =>
    commonController.getSubjectsByClass(req, res, db)
  );
  router.get("/deleteStudentImage/:studentId", isAuthenticated, (req, res) =>
    commonController.deleteStudentImage(req, res, db)
  );
  router.post("/deleteStudentImage/:id", isAuthenticated, requirePermission(PERMISSIONS.STUDENTS_EDIT), (req, res) => {
    commonController.deleteStudentImage(req, res, db);
  });

  router.get("/deleteSubject", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.deleteSubject(req, res, db)
  );
  router.post("/editSubject", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_CLASSES_SUBJECTS), (req, res) =>
    commonController.editSubject(req, res, db)
  );
  // Transcripts: search for a student, confirm your password, then open the
  // official transcript. Students are only listed after a search.
  const transcriptGuard = [checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.GENERATE_TRANSCRIPTS)];
  router.get("/transcripts", ...transcriptGuard, async (req, res) => {
    try {
      const classes = await db.query(
        `SELECT class_id, class_name FROM classes
          WHERE organization_id = $1 AND obsolete_at IS NULL
          ORDER BY COALESCE(dashboard_sort_order, 2147483647), class_name`,
        [req.session.organizationId]
      );
      return res.render("common/transcripts", { title: "Transcripts", classes: classes.rows, messages: req.flash ? req.flash() : {} });
    } catch (error) {
      console.error("[transcripts]", error);
      return res.status(500).send("Failed to load transcripts.");
    }
  });
  router.get("/transcripts/search", ...transcriptGuard, async (req, res) => {
    const query = String(req.query.q || "").trim().slice(0, 100);
    const classId = Number.parseInt(req.query.class, 10);
    const status = ["Current", "Graduated", "Left"].includes(req.query.status) ? req.query.status : "";
    if (query.length < 2 && !Number.isInteger(classId)) {
      return res.json({ success: true, students: [], needsSearch: true });
    }
    try {
      const like = `%${query}%`;
      const result = await db.query(
        `SELECT * FROM (
           SELECT s.student_id, TRIM(CONCAT_WS(' ', s.first_name, s.last_name)) AS student_name,
                  COALESCE(NULLIF(TRIM(s.custom_student_id), ''), s.student_id::text) AS display_id,
                  c.class_name, s.class_id,
                  CASE WHEN COALESCE(s.graduated, FALSE) THEN 'Graduated'
                       WHEN EXISTS (SELECT 1 FROM archived_student_info a WHERE a.student_id = s.student_id AND a.organization_id = s.organization_id AND a.archive_kind = 'left') THEN 'Left'
                       WHEN EXISTS (SELECT 1 FROM archived_student_info a WHERE a.student_id = s.student_id AND a.organization_id = s.organization_id) THEN 'Graduated'
                       ELSE 'Current' END AS status
             FROM students s
             LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
            WHERE s.organization_id = $1
              AND ($2 = '%%' OR CONCAT_WS(' ', s.first_name, s.last_name) ILIKE $2 OR CONCAT_WS(' ', s.last_name, s.first_name) ILIKE $2
                   OR COALESCE(s.custom_student_id, '') ILIKE $2 OR s.student_id::text = $3)
              AND ($4::int IS NULL OR s.class_id = $4)
         ) x
         WHERE ($5 = '' OR x.status = $5)
         ORDER BY LOWER(x.student_name), x.student_id
         LIMIT 25`,
        [req.session.organizationId, like, query, Number.isInteger(classId) ? classId : null, status]
      );
      return res.json({ success: true, students: result.rows.map(({ class_id, ...row }) => row) });
    } catch (error) {
      console.error("[transcripts/search]", error);
      return res.status(500).json({ success: false, message: "Could not search students." });
    }
  });
  // Confirms the signed-in person's own password, then allows this one
  // student's transcript for 10 minutes.
  router.post("/transcripts/unlock", ...transcriptGuard, express.json(), async (req, res) => {
    const studentId = Number.parseInt(req.body?.studentId, 10);
    const password = String(req.body?.password || "");
    if (!Number.isInteger(studentId) || !password) {
      return res.status(400).json({ success: false, message: "Enter your password." });
    }
    const limitKey = `transcript-unlock:${req.sessionID}`;
    if (!checkRateLimit(limitKey, { max: 5, windowMs: 10 * 60 * 1000 }).allowed) {
      return res.status(429).json({ success: false, message: "Too many attempts. Try again in a few minutes." });
    }
    try {
      const organizationId = req.session.organizationId;
      const student = await db.query("SELECT 1 FROM students WHERE student_id = $1 AND organization_id = $2", [studentId, organizationId]);
      if (!student.rows.length) return res.status(404).json({ success: false, message: "Student not found." });
      const userId = req.session.user?.user_id || req.session.userId || null;
      const stored = userId
        ? await db.query("SELECT password FROM users WHERE user_id = $1 AND organization_id = $2", [userId, organizationId])
        : await db.query("SELECT password FROM organizations WHERE organization_id = $1", [organizationId]);
      const hash = stored.rows[0]?.password;
      const ok = hash ? await require("../utils/passwordHashing").compare(password, hash) : false;
      if (!ok) return res.status(401).json({ success: false, message: "That password is not correct." });
      req.session.transcriptAccess = { studentId, until: Date.now() + 10 * 60 * 1000 };
      return res.json({ success: true, url: `/transcript/transcript/${studentId}` });
    } catch (error) {
      console.error("[transcripts/unlock]", error);
      return res.status(500).json({ success: false, message: "Could not check your password." });
    }
  });

  router.get(
    "/closeSchoolYear",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission([PERMISSIONS.REPORTS_TERMINAL, PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS]),
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
  router.post("/deleteEvent", isAuthenticated, requirePermission(PERMISSIONS.EVENTS_EVENTS), (req, res) =>
    commonController.deleteEvent(req, res, db)
  );
  router.post("/deleteAnnouncement", isAuthenticated, requirePermission(PERMISSIONS.EVENTS_ANNOUNCEMENTS), (req, res) =>
    commonController.deleteAnnouncement(req, res, db)
  );
  router.post("/deleteSchoolYear", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), (req, res) =>
    commonController.deleteSchoolYear(req, res, db)
  );
  router.delete("/deleteSchoolYear", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_SCHOOL_YEAR_TERMS), express.json(), (req, res) =>
    commonController.deleteSchoolYear(req, res, db)
  );
  router.post("/setMainEmployee", isAuthenticated, requirePermission(PERMISSIONS.EMPLOYEES_EDIT), (req, res) =>
    commonController.setMainEmployee(req, res, db)
  );
  router.post("/saveLunch", isAuthenticated, requirePermission(PERMISSIONS.MARK_ATTENDANCE), (req, res) =>
    commonController.saveLunch(req, res, db)
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
  router.post("/createEventAnnouncement", isAuthenticated, (req, res, next) => requirePermission(req.body.type === "event" ? PERMISSIONS.EVENTS_EVENTS : PERMISSIONS.EVENTS_ANNOUNCEMENTS)(req, res, next), (req, res) =>
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

  router.get("/employeeDetails", isAuthenticated, (req, res) =>
    commonController.getEmployeeDetails(req, res, db)
  );

  // Unified broadcast/announcement system (modal + banner popups) — admin UI.
  router.get(
    "/manageAnnouncements",
    isAuthenticated,
    requirePermission(PERMISSIONS.EVENTS_ANNOUNCEMENTS),
    (req, res) => commonController.manageAnnouncementsGet(req, res, db)
  );
  router.get(
    "/announcementComposer",
    isAuthenticated,
    requirePermission(PERMISSIONS.EVENTS_ANNOUNCEMENTS),
    (req, res) => commonController.announcementComposerGet(req, res, db)
  );



  router.get("/set-password", (req, res) =>
    commonController.setPasswordGet(req, res, db)
  );
  router.post("/set-password", (req, res) =>
    commonController.setPasswordPost(req, res, db)
  );

  router.get("/archivedStudents", isAuthenticated, requirePermission(PERMISSIONS.STUDENTS_ALUMNI), (req, res) =>
    commonController.archivedStudents(req, res, db)
  );
  router.post("/unarchiveStudents", isAuthenticated, requirePermission(PERMISSIONS.STUDENTS_ALUMNI), (req, res) =>
    commonController.unarchiveStudents(req, res, db)
  );


  // Guardian search API for autocomplete
  router.get("/api/guardians/search", isAuthenticated, (req, res) =>
    commonController.searchGuardiansApi(req, res, db)
  );

  // Admissions Hub
  router.get("/admissions", checkFeatureAccess, isAuthenticated, requirePermission(WORKSPACE_PERMISSIONS.admissions), (req, res) =>
    commonController.admissionsHub(req, res, db)
  );

  // All Students list (Admissions)
  router.get("/allStudents", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) =>
    commonController.allStudents(req, res, db)
  );

  // Change student class (AJAX)
  router.post("/students/:studentId/change-class", isAuthenticated, express.json(), requirePermission(PERMISSIONS.STUDENTS_EDIT), (req, res) =>
    commonController.changeStudentClass(req, res, db)
  );

  // Update student details from the All Students list (AJAX)
  router.post("/students/:studentId/update-details", isAuthenticated, express.json(), requirePermission(PERMISSIONS.STUDENTS_EDIT), (req, res) =>
    commonController.updateStudentListDetails(req, res, db)
  );

  // Bulk update students — change class and/or assign school year (AJAX)
  router.post("/students/bulk-update", isAuthenticated, express.json(), requirePermission(PERMISSIONS.STUDENTS_EDIT), (req, res) =>
    commonController.bulkUpdateStudents(req, res, db)
  );

  // Reports Hub
  router.get("/reports", checkFeatureAccess, isAuthenticated, requirePermission(WORKSPACE_PERMISSIONS.reports), (req, res) =>
    commonController.reportsHub(req, res, db)
  );

  // Custom report builder (all report queries remain scoped to the signed-in school).
  router.get(
    "/report-builder",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    reportBuilder.page
  );
  router.get(
    "/report-builder/options/:reportType",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    reportBuilder.options
  );
  router.post(
    "/report-builder/run",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json(),
    reportBuilder.run
  );
  router.post(
    "/report-builder/save",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json(),
    reportBuilder.save
  );
  router.post(
    "/report-builder/export",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json(),
    reportBuilder.export
  );
  // Download links Mira hands out: sealed, for the same signed-in person only,
  // and the file is built fresh with their own permissions.
  router.get(
    "/report-builder/download/:token",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    (req, res) => {
      const link = require("../controllers/internalReportBuilderController").openLink(req.params.token);
      const userId = Number(req.session?.user?.user_id || req.session?.userId);
      if (!link || link.u !== userId || link.o !== Number(req.session?.organizationId)) {
        return res.status(404).send("This download link has expired or belongs to someone else. Ask Mira for a new one.");
      }
      req.body = link.d;
      return link.d.format === "mgrt" ? reportBuilder.template(req, res) : reportBuilder.export(req, res);
    }
  );
  // Report templates (.mgrt): the design only, shared between schools.
  router.post(
    "/report-builder/template",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json(),
    reportBuilder.template
  );
  router.post(
    "/report-builder/import",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json({ limit: "200kb" }),
    reportBuilder.importTemplate
  );
  router.put(
    "/report-builder/saved/:reportId",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json(),
    reportBuilder.update
  );
  router.get(
    "/report-builder/staff",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    reportBuilder.staff
  );
  router.get(
    "/report-builder/saved/:reportId/sharing",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    reportBuilder.sharing
  );
  router.put(
    "/report-builder/saved/:reportId/shares",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json(),
    reportBuilder.updateShares
  );
  router.put(
    "/report-builder/saved/:reportId/favorite",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json(),
    reportBuilder.favorite
  );
  router.put(
    "/report-builder/saved/:reportId/schedule",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    express.json(),
    reportBuilder.updateSchedule
  );
  router.get(
    "/report-builder/saved/:reportId",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    reportBuilder.loadSaved
  );
  router.delete(
    "/report-builder/saved/:reportId",
    checkFeatureAccess,
    isAuthenticated,
    requirePermission(PERMISSIONS.REPORTS_BUILDER),
    reportBuilder.deleteSaved
  );

  // Mailroom
  router.get("/mailroom", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.MAILROOM), (req, res) =>
    commonController.mailroomHub(req, res, db)
  );

  // Activity Logs (full list page, linked from the Reports Hub)
  // The activity log now lives in the Report Builder as a report type.
  router.get("/activityLogs", checkFeatureAccess, isAuthenticated, requirePermission(PERMISSIONS.REPORTS_BUILDER), (req, res) =>
    res.redirect(res.locals.isEmbeddedFrame
      ? "/common/report-builder?type=activity_log"
      : "/common/reports?panel=report-builder&page=%2Fcommon%2Freport-builder%3Ftype%3Dactivity_log&label=Report%20Builder")
  );


  // Calendar (events, announcements, task due dates) and staff tasks.
  const staffOnly = (req, res, next) => {
    const role = String(req.session?.userRole || req.session?.accountType || "").toLowerCase();
    if (!req.session?.organizationId || role === "guardian" || role === "student") {
      return req.accepts("html") && req.method === "GET" ? res.redirect("/") : res.status(403).json({ success: false, error: "Not available." });
    }
    next();
  };
  const ws = (fn) => (req, res) => workspaceController[fn](req, res, db);
  // Mentions, tags, tasks, sharing and sync are only for people who belong to this school
  // (not platform admins viewing it, and never anyone from another organization).
  const orgMemberOnly = async (req, res, next) => {
    try {
      const userId = Number(req.session?.userId || req.session?.user?.user_id || 0);
      const r = userId
        ? await db.query(
            `SELECT 1 FROM users WHERE user_id = $1 AND organization_id = $2
               AND LOWER(COALESCE(account_type::text, '')) NOT IN ('admin', 'internal worker', 'mini admin')`,
            [userId, req.session.organizationId]
          )
        : { rowCount: 0 };
      if (r.rowCount) return next();
      return res.status(403).json({ success: false, error: "Tasks, tagging and calendar sharing are only for members of this school." });
    } catch (err) {
      return res.status(500).json({ success: false, error: "Something went wrong." });
    }
  };
  router.get("/calendar", isAuthenticated, staffOnly, ws("calendarPage"));
  router.get("/calendar/feed", isAuthenticated, staffOnly, ws("calendarFeed"));
  router.get("/calendar/feed/outside", isAuthenticated, staffOnly, ws("calendarOutsideFeed"));
  router.post("/calendar/sync/reset", isAuthenticated, staffOnly, orgMemberOnly, ws("resetFeedLink"));
  router.post("/calendar/events", isAuthenticated, staffOnly, orgMemberOnly, ws("saveEvent"));
  router.post("/calendar/events/:id(\\d+)", isAuthenticated, staffOnly, orgMemberOnly, ws("saveEvent"));
  router.post("/calendar/events/:id(\\d+)/delete", isAuthenticated, staffOnly, orgMemberOnly, ws("deleteEvent"));
  router.post("/calendar/announcements", isAuthenticated, staffOnly, orgMemberOnly, ws("createAnnouncement"));
  router.post("/calendar/personal", isAuthenticated, staffOnly, orgMemberOnly, ws("saveEvent"));
  router.post("/calendar/personal/:id(\\d+)", isAuthenticated, staffOnly, orgMemberOnly, ws("saveEvent"));
  router.post("/calendar/personal/:id(\\d+)/delete", isAuthenticated, staffOnly, orgMemberOnly, ws("deleteEvent"));
  router.get("/calendar/sync", isAuthenticated, staffOnly, orgMemberOnly, ws("syncSettings"));
  router.post("/calendar/imports", isAuthenticated, staffOnly, orgMemberOnly, ws("addImport"));
  router.post("/calendar/imports/:id(\\d+)/delete", isAuthenticated, staffOnly, orgMemberOnly, ws("removeImport"));
  router.post("/calendar/shares", isAuthenticated, staffOnly, orgMemberOnly, ws("saveShares"));
  const orgMemberPage = async (req, res, next) => {
    if (await isOrgMember(db, req)) return next();
    req.flash("error", "Calendar connections are for members of this school.");
    return res.redirect("/common/calendar");
  };
  router.get("/calendar/connect/:provider(google|outlook)", isAuthenticated, staffOnly, orgMemberPage, ws("connectStart"));
  router.get("/calendar/connect/outlook/callback", isAuthenticated, staffOnly, (req, res) => workspaceController.connectCallback(req, res, db, "outlook"));
  router.post("/calendar/connections/:id(\\d+)/disconnect", isAuthenticated, staffOnly, orgMemberOnly, ws("connectRemove"));
  router.post("/calendar/connections/:id(\\d+)/sync", isAuthenticated, staffOnly, orgMemberOnly, ws("connectSyncNow"));
  router.post("/calendar/connections/:id(\\d+)/settings", isAuthenticated, staffOnly, orgMemberOnly, ws("connectVisibility"));
  router.get("/workspace/staff", isAuthenticated, staffOnly, orgMemberOnly, ws("staffDirectory"));
  router.post("/tasks", isAuthenticated, staffOnly, orgMemberOnly, ws("createTask"));
  router.post("/tasks/:id(\\d+)/status", isAuthenticated, staffOnly, orgMemberOnly, ws("taskStatus"));
  router.get("/tasks/:id(\\d+)/comments", isAuthenticated, staffOnly, orgMemberOnly, ws("taskComments"));
  router.post("/tasks/:id(\\d+)/comments", isAuthenticated, staffOnly, orgMemberOnly, ws("addTaskComment"));
  router.post("/tasks/:id(\\d+)/react", isAuthenticated, staffOnly, orgMemberOnly, ws("reactTask"));

  // Custom forms (feature custom_forms): builders design sections; staff fill them in.
  const customForms = require("../controllers/customFormsController");
  const formBuilders = [isAuthenticated, blockGuardians, requirePermission(PERMISSIONS.CUSTOM_FORMS)];
  router.get("/custom-forms", ...formBuilders, (req, res) => customForms.editorPage(req, res, db));
  // Data migration (feature data_migration): the school's admins move their old system's data in,
  // confirming with an authenticator code every 30 minutes (codeGate).
  const migration = require("../controllers/dataMigrationController");
  const migrationGate = [isAuthenticated, migration.codeGate];
  router.get("/migration/verify", isAuthenticated, (req, res) => migration.verifyPage(req, res, db));
  router.post("/migration/verify", isAuthenticated, (req, res) => migration.verifyPost(req, res, db));
  // The page itself asks for the code only once Managira has opened the migration; before that it's the request form.
  router.get("/migration", isAuthenticated, (req, res) => migration.page(req, res, db));
  router.post("/migration/request", isAuthenticated, (req, res) => migration.requestPost(req, res, db));
  router.post("/migration/request/withdraw", isAuthenticated, (req, res) => migration.withdrawPost(req, res, db));
  // The school's sandbox switch (header menu): its managers turn it on or off, no code asked.
  router.post("/migration/sandbox", isAuthenticated, (req, res) => migration.sandboxPost(req, res, db));
  router.post("/migration/upload", ...migrationGate, migration.uploadHandler, (req, res) => migration.uploadPost(req, res, db));
  router.get("/migration/task", ...migrationGate, (req, res) => migration.taskPost(req, res, db));
  router.post("/migration/import", ...migrationGate, (req, res) => migration.importPost(req, res, db));
  router.post("/migration/columns/:columnId(\\d+)/confirm", ...migrationGate, (req, res) => migration.confirmPost(req, res, db));
  router.post("/migration/columns/:columnId(\\d+)/notes", ...migrationGate, (req, res) => migration.notesPost(req, res, db));
  router.post("/migration/columns/:columnId(\\d+)/exclude", ...migrationGate, (req, res) => migration.excludePost(req, res, db));
  router.post("/migration/columns/:columnId(\\d+)/legal-need", ...migrationGate, (req, res) => migration.legalPost(req, res, db));
  router.post("/migration/approve", ...migrationGate, (req, res) => migration.approvePost(req, res, db));
  router.post("/migration/matches", ...migrationGate, (req, res) => migration.matchPost(req, res, db));
  router.post("/migration/custom-fields", ...migrationGate, (req, res) => migration.customFieldsPost(req, res, db));
  router.post("/migration/options", ...migrationGate, (req, res) => migration.optionPost(req, res, db));
  router.post("/migration/lists", ...migrationGate, (req, res) => migration.listUsePost(req, res, db));
  router.post("/migration/schools", ...migrationGate, (req, res) => migration.schoolsPost(req, res, db));
  router.post("/migration/sign", ...migrationGate, (req, res) => migration.signPost(req, res, db));
  router.post("/migration/go-live", ...migrationGate, (req, res) => migration.goLivePost(req, res, db));
  router.post("/migration/catch-up", ...migrationGate, (req, res) => migration.catchUpPost(req, res, db));
  router.post("/migration/invite", ...migrationGate, (req, res) => migration.invitePost(req, res, db));
  router.post("/migration/roles/:roleId(\\d+)/confirm", ...migrationGate, (req, res) => migration.roleConfirmPost(req, res, db));
  router.post("/migration/roles/:roleId(\\d+)/notes", ...migrationGate, (req, res) => migration.roleNotesPost(req, res, db));
  router.post("/migration/roles/approve", ...migrationGate, (req, res) => migration.roleApprovePost(req, res, db));
  router.get("/migration/roles/report", ...migrationGate, (req, res) => migration.roleReportFile(req, res, db));
  router.get("/migration/archive/:archiveId(\\d+)", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) => migration.archivePage(req, res, db));
  router.get("/migration/old-records", isAuthenticated, (req, res) => migration.oldRecords(req, res, db));
  router.get("/migration/documents/:documentId(\\d+)", isAuthenticated, requirePermission(PERMISSIONS.MANAGE_STUDENTS), (req, res) => migration.documentFile(req, res, db));
  router.post("/custom-forms/save", ...formBuilders, express.json({ limit: "1mb" }), (req, res) => customForms.saveSection(req, res, db));
  router.post("/custom-forms/:id(\\d+)/delete", ...formBuilders, (req, res) => customForms.deleteSection(req, res, db));
  router.post("/custom-forms/order", ...formBuilders, express.json(), (req, res) => customForms.order(req, res, db));
  // A notification's link: to the classroom's Forms tab or the Custom editor, whichever is theirs.
  router.get("/custom-forms/go", isAuthenticated, blockGuardians, (req, res) => customForms.go(req, res, db));
  router.get("/forms", isAuthenticated, blockGuardians, (req, res) => customForms.staffPage(req, res, db));
  router.get("/forms/data", isAuthenticated, blockGuardians, (req, res) => customForms.data(req, res, db));
  router.get("/forms/:id(\\d+)/export.csv", isAuthenticated, blockGuardians, (req, res) => customForms.exportCsv(req, res, db));
  router.post("/forms/:id(\\d+)/remind", isAuthenticated, blockGuardians, express.json(), (req, res) => customForms.remind(req, res, db));
  router.get("/forms/:id(\\d+)/students", isAuthenticated, blockGuardians, (req, res) => customForms.students(req, res, db));
  router.get("/forms/:id(\\d+)/student/:studentId(\\d+)", isAuthenticated, blockGuardians, (req, res) => customForms.entries(req, res, db));
  router.post("/forms/:id(\\d+)/student/:studentId(\\d+)", isAuthenticated, blockGuardians, express.json({ limit: "512kb" }), (req, res) => customForms.saveEntry(req, res, db));
  router.post("/forms/:id(\\d+)/entry/:entryId(\\d+)/delete", isAuthenticated, blockGuardians, (req, res) => customForms.deleteEntry(req, res, db));
  router.post("/forms/:id(\\d+)/upload", isAuthenticated, blockGuardians, upload.single("file"), (req, res) => customForms.staffUpload(req, res, db));

  return router;
};
