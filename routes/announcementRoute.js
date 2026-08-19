module.exports = (db) => {
  const express = require("express");
  const router = express.Router();
  const announcementController = require("../controllers/announcementController");
  const { isAuthenticated, ensureAdmin } = require("../middleware/authMiddleware");
  const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
  const { upload } = require("../middleware/s3Upload");

  // Admin/org-portal composer + list (staff-only permission gate).
  router.post(
    "/",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    announcementController.createAnnouncement
  );
  router.post("/global", isAuthenticated, ensureAdmin, announcementController.createGlobalAnnouncement);
  router.put(
    "/:id",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    announcementController.updateAnnouncement
  );
  router.delete(
    "/:id",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    announcementController.deleteAnnouncement
  );
  router.post(
    "/:id/duplicate",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    announcementController.duplicateAnnouncement
  );
  router.get(
    "/",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    announcementController.listAnnouncements
  );
  router.post(
    "/upload-image",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
    upload.single("image"),
    announcementController.uploadImage
  );
  router.get(
    "/estimate-recipients",
    isAuthenticated,
    requirePermission(PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS),
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
