const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("../middleware/middleware");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const { transportationController } = require("../controllers/transportationController");
const { upload } = require("../middleware/s3Upload");

module.exports = (db) => {
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
    "/manage/drivers/:driverId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_STUDENTS),
    upload.single("driverImage"),
    (req, res) => transportationController.updateDriverPost(req, res, db)
  );

  router.post(
    "/manage/drivers/:driverId/delete",
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

  router.get("/live/student/:studentId", isAuthenticated, (req, res) =>
    transportationController.getLiveByStudent(req, res, db)
  );

  router.get("/live/route/:routeId", isAuthenticated, (req, res) =>
    transportationController.getLiveByRoute(req, res, db)
  );

  return router;
};
