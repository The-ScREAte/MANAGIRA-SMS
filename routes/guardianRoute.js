const express = require("express");
const router = express.Router();
const { isGuardianAuthenticated } = require("../middleware/guardianAuthMiddleware");
const guardianController = require("../controllers/guardianController");
const financeController = require("../controllers/financeController");
const { upload } = require("../middleware/s3Upload");
const { hasPaygiraFeature } = require("../utils/paygiraAccess");

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

  router.get('/student-report-cards', isGuardianAuthenticated, (req, res) =>
    guardianController.studentReportCardsListGet(req, res, db)
  );

  router.get('/student-report-cards/:id/pdf', isGuardianAuthenticated, (req, res) =>
    guardianController.studentReportCardPdfGet(req, res, db)
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

  router.post("/settings/notifications", isGuardianAuthenticated, (req, res) =>
    guardianController.notificationsPost(req, res, db)
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

  router.get("/reports/student-staff", isGuardianAuthenticated, (req, res) =>
    guardianController.getStudentStaff(req, res, db)
  );

  router.post("/reports/create", isGuardianAuthenticated, (req, res) =>
    guardianController.reportCreatePost(req, res, db)
  );

  router.get("/reports/:id", isGuardianAuthenticated, (req, res) =>
    guardianController.reportDetailsGet(req, res, db)
  );

  router.get("/reports/:id/cc", isGuardianAuthenticated, (req, res) =>
    guardianController.reportCcRecipientsGet(req, res, db)
  );

  router.post("/reports/:id/reply", isGuardianAuthenticated, (req, res) =>
    guardianController.reportReplyPost(req, res, db)
  );

  router.post("/reports/:id/replies/:replyId/delete", isGuardianAuthenticated, (req, res) =>
    guardianController.reportReplyDeletePost(req, res, db)
  );

  router.post("/reports/:id/delete", isGuardianAuthenticated, (req, res) =>
    guardianController.reportDeletePost(req, res, db)
  );

  // Pending student management routes
  router.get("/edit-pending-student", isGuardianAuthenticated, (req, res) =>
    guardianController.editPendingStudentGet(req, res, db)
  );

  router.post("/edit-pending-student", 
    isGuardianAuthenticated,
    upload.single('studentImage'),
    (req, res) => guardianController.editPendingStudentPost(req, res, db)
  );

  router.post("/withdraw-pending-student", isGuardianAuthenticated, (req, res) =>
    guardianController.withdrawPendingStudent(req, res, db)
  );

  // ===== PayGira (parent-facing payments) =====
  // PayGira is a premium plan add-on. A guardian only sees/uses it when their
  // school's plan includes the "PayGira" feature.
  const requireGuardianPaygira = async (req, res, next) => {
    try {
      const enabled = await hasPaygiraFeature(db, req.session?.organizationId);
      if (enabled) return next();
    } catch (err) {
      console.error("[requireGuardianPaygira]", err.message || err);
    }
    if (req.xhr || /\.json$/.test(req.path) || req.path.includes("/pay") || req.path.includes("/stripe-intent")) {
      return res.status(403).json({ error: "PayGira is not enabled for this school." });
    }
    req.flash("error", "PayGira is not available for this school.");
    return res.redirect("/guardian/dashboard");
  };

  router.get("/paygira", isGuardianAuthenticated, requireGuardianPaygira, (req, res) =>
    financeController.guardianPaygiraGet(req, res, db)
  );
  router.post("/paygira/stripe-intent", isGuardianAuthenticated, requireGuardianPaygira, (req, res) =>
    financeController.guardianPaygiraStripeIntentPost(req, res, db)
  );
  router.get("/paygira/stripe-return", isGuardianAuthenticated, requireGuardianPaygira, (req, res) =>
    financeController.guardianPaygiraStripeReturnGet(req, res, db)
  );
  router.post("/paygira/pay", isGuardianAuthenticated, requireGuardianPaygira, (req, res) =>
    financeController.guardianPaygiraPayPost(req, res, db)
  );
  router.get("/paygira/invoice/:assignmentId", isGuardianAuthenticated, requireGuardianPaygira, (req, res) =>
    financeController.invoiceGet(req, res, db)
  );
  router.get("/paygira/receipt/:paymentId", isGuardianAuthenticated, requireGuardianPaygira, (req, res) =>
    financeController.receiptGet(req, res, db)
  );

  // ===== Saved Cards & Billing (PayGira wallet) =====
  router.post("/cards", isGuardianAuthenticated, (req, res) =>
    financeController.guardianCardAddPost(req, res, db)
  );
  router.post("/cards/:id/delete", isGuardianAuthenticated, (req, res) =>
    financeController.guardianCardDeletePost(req, res, db)
  );
  router.post("/cards/:id/default", isGuardianAuthenticated, (req, res) =>
    financeController.guardianCardDefaultPost(req, res, db)
  );

  return router;
};
