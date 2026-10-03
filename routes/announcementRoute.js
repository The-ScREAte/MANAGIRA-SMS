module.exports = (db) => {
  const express = require("express");
  const router = express.Router();
  const announcementController = require("../controllers/announcementController");
  const { isAuthenticated, ensureAdmin } = require("../middleware/authMiddleware");
  const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
  const { upload } = require("../middleware/s3Upload");
  // Managira platform admins manage announcements for every school; school
  // staff need the Publish Events & Announcements permission.
  const canPublish = (req, res, next) => {
    if (String(req.session?.accountType || "").trim().toLowerCase() === "admin") return next();
    return requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS)(req, res, next);
  };

  // Admin/org-portal composer + list (staff-only permission gate).
  router.post(
    "/",
    isAuthenticated,
    canPublish,
    announcementController.createAnnouncement
  );
  router.post("/global", isAuthenticated, ensureAdmin, announcementController.createGlobalAnnouncement);
  router.put(
    "/:id",
    isAuthenticated,
    canPublish,
    announcementController.updateAnnouncement
  );
  router.delete(
    "/:id",
    isAuthenticated,
    canPublish,
    announcementController.deleteAnnouncement
  );
  router.post(
    "/:id/duplicate",
    isAuthenticated,
    canPublish,
    announcementController.duplicateAnnouncement
  );
  router.get(
    "/",
    isAuthenticated,
    canPublish,
    announcementController.listAnnouncements
  );
  router.post(
    "/upload-image",
    isAuthenticated,
    canPublish,
    upload.single("image"),
    announcementController.uploadImage
  );
  router.get(
    "/estimate-recipients",
    isAuthenticated,
    canPublish,
    announcementController.estimateRecipients
  );

  // Any signed-in identity (staff, guardian, student, or driver) can read/ack
  // their own targeted feed - these are gated inside the controller itself via
  // resolveViewerIdentity(), not isAuthenticated, since guardians/students/
  // drivers use separate session shapes from staff.
  router.get("/me", announcementController.getMyAnnouncements);
  router.post("/:id/seen", announcementController.markSeen);
  router.post("/:id/dismiss", announcementController.markDismissed);
  router.post("/:id/acknowledge", announcementController.markAcknowledged);

  return router;
};
