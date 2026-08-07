const express = require("express");
const router = express.Router();
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { transportationController } = require("../controllers/transportationController");
const { upload } = require("../middleware/s3Upload");

module.exports = (db) => {
  // Live bus location for a single student is staff-only by default, but a
  // guardian may fetch it for their own linked child, and a student may
  // fetch it for themself — each strictly scoped, everyone else 401/403s.
  async function authorizeStudentLiveAccess(req, res, next) {
    const session = req.session || {};
    const role = session.userRole;

    if (role === "Guardian" || role === "Student") {
      const organizationId = session.organizationId;
      const studentId = Number.parseInt(req.params.studentId || req.query.studentId, 10);

      if (!organizationId || !Number.isInteger(studentId)) {
        return res.status(400).json({ success: false, message: "Student is required." });
      }

      if (role === "Student") {
        if (Number(session.studentId) === studentId) return next();
        return res.status(403).json({ success: false, message: "Forbidden." });
      }

      try {
        const ownership = await db.query(
          `SELECT 1 FROM students s
            WHERE s.student_id = $1 AND s.organization_id = $2
              AND (
                EXISTS (SELECT 1 FROM guardians g WHERE g.student_id = s.student_id AND g.guardian_id = $3 AND g.organization_id = $2)
                OR EXISTS (SELECT 1 FROM guardian_students gs WHERE gs.student_id = s.student_id AND gs.guardian_id = $3)
              )
            LIMIT 1`,
          [studentId, organizationId, session.guardianId]
        );
        if (ownership.rows.length) return next();
        return res.status(403).json({ success: false, message: "Forbidden." });
      } catch (error) {
        return res.status(500).json({ success: false, message: "Authorization check failed." });
      }
    }

    return isAuthenticated(req, res, next);
  }

  // Drivers get their own dedicated /driver/dashboard portal — the admin
  // console below (bus/route/driver-profile CRUD) is staff-only even though
  // Drivers are granted the manage_students permission for the roster pages.
  router.use("/manage", blockGuardians);

  router.get(
    "/manage",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.manageGet(req, res, db)
  );

  router.post(
    "/manage/map-provider",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_SETTINGS),
    (req, res) => transportationController.updateMapProviderPost(req, res, db)
  );

  router.post(
    "/manage/units",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_SETTINGS),
    (req, res) => transportationController.updateDistanceUnitPost(req, res, db)
  );

  router.post(
    "/manage/school-destination",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_SETTINGS),
    (req, res) => transportationController.updateSchoolDestinationPost(req, res, db)
  );

  router.post(
    "/manage/buses",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.createBusPost(req, res, db)
  );

  router.post(
    "/manage/buses/:busId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.updateBusPost(req, res, db)
  );

  router.post(
    "/manage/buses/:busId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.deleteBusPost(req, res, db)
  );

  router.post(
    "/manage/drivers",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    upload.single("driverImage"),
    (req, res) => transportationController.createDriverPost(req, res, db)
  );

  router.post(
    "/manage/drivers/:userId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    upload.single("driverImage"),
    (req, res) => transportationController.updateDriverPost(req, res, db)
  );

  router.post(
    "/manage/drivers/:userId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.deleteDriverPost(req, res, db)
  );

  router.post(
    "/manage/schedules",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.createSchedulePost(req, res, db)
  );

  router.post(
    "/manage/schedules/:scheduleId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.updateSchedulePost(req, res, db)
  );

  router.post(
    "/manage/schedules/:scheduleId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.deleteSchedulePost(req, res, db)
  );

  router.post(
    "/manage/routes",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.createRoutePost(req, res, db)
  );

  router.post(
    "/manage/routes/:routeId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.updateRoutePost(req, res, db)
  );

  router.post(
    "/manage/routes/:routeId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.deleteRoutePost(req, res, db)
  );

  router.post(
    "/manage/stops",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.createStopPost(req, res, db)
  );

  router.post(
    "/manage/stops/import-city",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.importCityStopsPost(req, res, db)
  );

  router.post(
    "/manage/stops/:stopId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.updateStopPost(req, res, db)
  );

  router.post(
    "/manage/stops/:stopId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.deleteStopPost(req, res, db)
  );

  router.post(
    "/manage/assignments",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.assignStudentPost(req, res, db)
  );

  router.post(
    "/manage/students/access",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    (req, res) => transportationController.bulkUpdateStudentAccessPost(req, res, db)
  );

  router.get(
    "/driver/mobile",
    isAuthenticated,
    (req, res) => transportationController.driverMobileGet(req, res, db)
  );

  router.post("/driver/trips/start", isAuthenticated, (req, res) =>
    transportationController.startTripPost(req, res, db)
  );

  router.post("/driver/trips/end", isAuthenticated, (req, res) =>
    transportationController.endTripPost(req, res, db)
  );

  router.post("/driver/live-location", isAuthenticated, (req, res) =>
    transportationController.postLiveLocation(req, res, db)
  );

  router.get("/live/student/:studentId", authorizeStudentLiveAccess, (req, res) =>
    transportationController.getLiveByStudent(req, res, db)
  );

  router.get("/live/route/:routeId", isAuthenticated, (req, res) =>
    transportationController.getLiveByRoute(req, res, db)
  );

  return router;
};
