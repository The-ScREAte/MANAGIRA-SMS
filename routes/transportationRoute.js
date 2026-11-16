const express = require("express");
const router = express.Router();
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const { roadRoute } = require("../utils/roadRouting");
const { requirePermission, PERMISSIONS, userHasPermission, sessionActor } = require("../middleware/permissionMiddleware");
const { transportationController, forgetStudentBuses, guardianTransportStudentIds, staffIdentity } = require("../controllers/transportationController");
const { BoundedMap } = require("../utils/boundedMap");
const { upload } = require("../middleware/s3Upload");

module.exports = (db) => {
  // Nothing of transportation answers while the school has it switched off.
  router.use(require("../utils/integrationSwitches").guard(db, "transportation"));

  // The map asks every few seconds, so a parent's link to their child is remembered briefly.
  const ownChildChecks = new BoundedMap(5000);
  const OWN_CHILD_TTL_MS = 60000;

  // A parent's or student's portal must still be open: the school not on hold or deleted, and its
  // parent (or student) portal switched on, as their own pages require. Remembered for a minute.
  const portalChecks = new BoundedMap(2000);
  async function portalOpen(session) {
    const organizationId = Number(session.organizationId);
    if (!organizationId) return false;
    const kind = session.userRole === "Student" ? "student" : "guardian";
    const key = `${organizationId}:${kind}`;
    const known = portalChecks.get(key);
    if (known && known.until > Date.now()) return known.ok;
    const org = await db.query("SELECT deleted, on_hold FROM organizations WHERE organization_id = $1", [organizationId]);
    let ok = Boolean(org.rows[0]) && !org.rows[0].deleted && !org.rows[0].on_hold;
    if (ok && kind === "guardian") ok = await require("../utils/guardianPortalAccess").hasGuardianPortalFeature(db, organizationId);
    if (ok && kind === "student") ok = Boolean((await require("../utils/studentPortal").getStudentPortalIntegrationStatus(db, organizationId)).activated);
    portalChecks.set(key, { ok, until: Date.now() + OWN_CHILD_TTL_MS });
    return ok;
  }
  const portalClosed = (res) => res.status(403).json({ success: false, message: "Your school's portal isn't open right now." });

  // Staff see a student's bus details (home address, stop, pickup times) only where their work
  // shows that student: a teacher for students of their own classes, anyone else with Manage
  // Students or a Transportation students permission. Remembered for a minute (the map polls).
  const staffChecks = new BoundedMap(5000);
  async function staffSeesStudent(req, studentId) {
    const session = req.session || {};
    const organizationId = Number(session.organizationId);
    const userId = Number(session.userId || (session.user && session.user.user_id)) || 0;
    if (!organizationId || !Number.isInteger(studentId) || studentId <= 0) return false;
    const key = `${organizationId}:${session.accountType || ""}:${userId}:${studentId}`;
    const known = staffChecks.get(key);
    if (known && known.until > Date.now()) return known.ok;
    let ok = false;
    const inSchool = await db.query("SELECT 1 FROM students WHERE student_id = $1 AND organization_id = $2", [studentId, organizationId]);
    if (inSchool.rowCount) {
      const role = String(session.userRole || (session.user && session.user.account_type) || "").trim().toLowerCase();
      if (role === "teacher") {
        const classScope = require("../utils/classScope");
        const mine = await classScope.assignedClasses(db, req);
        ok = (await classScope.studentsInClasses(db, organizationId, [studentId], mine)).has(studentId);
      } else {
        const actor = sessionActor(req);
        for (const permission of [PERMISSIONS.MANAGE_STUDENTS, PERMISSIONS.TRANSPORT_STUDENTS, PERMISSIONS.TRANSPORT_STUDENT_ROUTES]) {
          if (await userHasPermission(db, actor, permission)) { ok = true; break; }
        }
      }
    }
    staffChecks.set(key, { ok, until: Date.now() + OWN_CHILD_TTL_MS });
    return ok;
  }

  // Live bus location for a single student is staff-only by default, but a
  // guardian may fetch it for their own linked child, and a student may
  // fetch it for themself — each strictly scoped, everyone else 401/403s.
  async function authorizeStudentLiveAccess(req, res, next) {
    const session = req.session || {};
    const role = session.userRole;

    if (role === "Guardian" || role === "Student") {
      const organizationId = session.organizationId;
      const studentId = Number.parseInt(req.params.studentId || req.query.studentId, 10);
      try {
        if (!(await portalOpen(session))) return portalClosed(res);
      } catch (error) {
        return res.status(500).json({ success: false, message: "Authorization check failed." });
      }

      if (!organizationId || !Number.isInteger(studentId)) {
        return res.status(400).json({ success: false, message: "Student is required." });
      }

      if (role === "Student") {
        if (Number(session.studentId) !== studentId) return res.status(403).json({ success: false, message: "Forbidden." });
        // Only while the student's class shows the bus to its students (Class settings).
        const ownKey = `${organizationId}:student:${studentId}`;
        if ((ownChildChecks.get(ownKey) || 0) > Date.now()) return next();
        try {
          if (await require("../utils/classSettings").studentsSee(db, organizationId, studentId, "transport")) {
            ownChildChecks.set(ownKey, Date.now() + OWN_CHILD_TTL_MS);
            return next();
          }
          return res.status(403).json({ success: false, message: "Forbidden." });
        } catch (error) {
          return res.status(500).json({ success: false, message: "Authorization check failed." });
        }
      }

      const ownKey = `${organizationId}:${session.guardianId}:${studentId}`;
      if ((ownChildChecks.get(ownKey) || 0) > Date.now()) return next();
      try {
        const ownership = await db.query(
          `SELECT 1 FROM students s
            WHERE s.student_id = $1 AND s.organization_id = $2
              AND (
                EXISTS (SELECT 1 FROM guardian_students gs WHERE gs.student_id = s.student_id AND gs.guardian_id = $3)
              )
            LIMIT 1`,
          [studentId, organizationId, session.guardianId]
        );
        // Their child, and the child's class shows the bus to parents (Class settings).
        if (ownership.rows.length && await require("../utils/classSettings").parentsSee(db, organizationId, studentId, "transport")) {
          ownChildChecks.set(ownKey, Date.now() + OWN_CHILD_TTL_MS);
          return next();
        }
        return res.status(403).json({ success: false, message: "Forbidden." });
      } catch (error) {
        return res.status(500).json({ success: false, message: "Authorization check failed." });
      }
    }

    return isAuthenticated(req, res, async () => {
      try {
        const studentId = Number.parseInt(req.params.studentId || req.query.studentId, 10);
        if (await staffSeesStudent(req, studentId)) return next();
        return res.status(403).json({ success: false, message: "You can only see the bus details of students your work covers." });
      } catch (error) {
        return res.status(500).json({ success: false, message: "Authorization check failed." });
      }
    });
  }

  // Who may ask for a bus: a parent for their own child, or staff of the school.
  async function authorizeBusRequester(req, res, next) {
    const session = req.session || {};
    const role = session.userRole;
    const studentId = Number.parseInt((req.body && req.body.studentId) || req.query.studentId, 10);
    if (role === "Student") return res.status(403).json({ success: false, message: "Forbidden." });
    if (role === "Guardian") {
      if (!session.organizationId || !session.guardianId) return res.status(401).json({ success: false, message: "Please sign in." });
      try {
        if (!(await portalOpen(session))) return portalClosed(res);
        // Only for their children whose class shows the bus to parents (Class settings).
        const ownIds = await guardianTransportStudentIds(db, session);
        if (Number.isInteger(studentId) && !ownIds.includes(studentId)) {
          return res.status(403).json({ success: false, message: "Forbidden." });
        }
        req.busRequester = {
          type: "guardian",
          guardianId: session.guardianId,
          name: [session.firstName, session.lastName].filter(Boolean).join(" ").trim(),
          studentId,
        };
        return next();
      } catch (error) {
        return res.status(500).json({ success: false, message: "Authorization check failed." });
      }
    }
    return isAuthenticated(req, res, async () => {
      try {
        // A student's address and any waiting request show only to staff whose work covers them.
        if (Number.isInteger(studentId) && !(await staffSeesStudent(req, studentId))) {
          return res.status(403).json({ success: false, message: "You can only ask for a bus for students your work covers." });
        }
        req.busRequester = { ...staffIdentity(session), studentId };
        return next();
      } catch (error) {
        return res.status(500).json({ success: false, message: "Authorization check failed." });
      }
    });
  }
  async function guardianOnly(req, res, next) {
    if (!(req.session && req.session.userRole === "Guardian" && req.session.guardianId)) return res.status(403).json({ success: false, message: "Forbidden." });
    try {
      if (!(await portalOpen(req.session))) return portalClosed(res);
      return next();
    } catch (error) {
      return res.status(500).json({ success: false, message: "Authorization check failed." });
    }
  }

  router.get("/requests/start", authorizeBusRequester, (req, res) => transportationController.requestStartGet(req, res, db));
  router.post("/requests/options", authorizeBusRequester, (req, res) => transportationController.requestOptionsPost(req, res, db));
  router.post("/requests", authorizeBusRequester, (req, res) => transportationController.requestCreatePost(req, res, db));
  router.get("/arrivals/mine", guardianOnly, (req, res) => transportationController.arrivalsMineGet(req, res, db));
  router.post("/arrivals/:arrivalId/answer", guardianOnly, (req, res) => transportationController.arrivalAnswerPost(req, res, db));
  router.get("/riding/mine", guardianOnly, (req, res) => transportationController.parentRidingGet(req, res, db));
  router.post("/riding/mine", guardianOnly, (req, res) => transportationController.parentRidingPost(req, res, db));
  router.post("/riding/mine/stop", guardianOnly, (req, res) => transportationController.parentStopBusPost(req, res, db));
  router.get("/class/:classId/riding", isAuthenticated, blockGuardians, (req, res) => transportationController.classRidingGet(req, res, db));
  router.post("/class/:classId/riding", isAuthenticated, blockGuardians, (req, res) => transportationController.classRidingPost(req, res, db));
  router.get("/reports/mine", guardianOnly, (req, res) => transportationController.reportsMineGet(req, res, db));
  router.get("/reports/class/:classId", isAuthenticated, blockGuardians, requirePermission([PERMISSIONS.TRANSPORT_CLASS_REPORTS, PERMISSIONS.TRANSPORT_REPORTS]), (req, res) => transportationController.reportsForClassGet(req, res, db));
  router.get("/requests/mine", guardianOnly, (req, res) => transportationController.requestsMineGet(req, res, db));
  router.post("/requests/:requestId/cancel", guardianOnly, (req, res) => transportationController.requestCancelPost(req, res, db));

  // Drivers get their own dedicated /driver/dashboard portal — the admin
  // console below (bus/route/driver-profile CRUD) is staff-only.
  router.use("/manage", blockGuardians);
  // Anything saved here can change what a student's bus map shows.
  router.use("/manage", (req, res, next) => {
    if (req.method === "POST") res.on("finish", () => forgetStudentBuses(req.session && req.session.organizationId));
    next();
  });

  router.get(
    "/manage",
    isAuthenticated,
    requirePermission(PERMISSIONS.MANAGE_TRANSPORTATION),
    (req, res) => transportationController.manageGet(req, res, db)
  );


  router.post(
    "/manage/units",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_SETTINGS),
    (req, res) => transportationController.updateDistanceUnitPost(req, res, db)
  );

  router.post(
    "/manage/school-destination",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_SETTINGS),
    (req, res) => transportationController.updateSchoolDestinationPost(req, res, db)
  );

  router.post(
    "/manage/buses",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_BUSES),
    (req, res) => transportationController.createBusPost(req, res, db)
  );

  router.post(
    "/manage/buses/:busId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_BUSES),
    (req, res) => transportationController.updateBusPost(req, res, db)
  );

  router.post(
    "/manage/buses/:busId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_BUSES),
    (req, res) => transportationController.deleteBusPost(req, res, db)
  );

  router.post(
    "/manage/drivers",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_DRIVERS),
    upload.single("driverImage"),
    (req, res) => transportationController.createDriverPost(req, res, db)
  );

  router.post(
    "/manage/drivers/:userId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_DRIVERS),
    upload.single("driverImage"),
    (req, res) => transportationController.updateDriverPost(req, res, db)
  );

  router.post(
    "/manage/drivers/:userId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_DRIVERS),
    (req, res) => transportationController.deleteDriverPost(req, res, db)
  );

  router.post(
    "/manage/schedules",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_SCHEDULES),
    (req, res) => transportationController.createSchedulePost(req, res, db)
  );

  router.post(
    "/manage/schedules/:scheduleId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_SCHEDULES),
    (req, res) => transportationController.updateSchedulePost(req, res, db)
  );

  router.post(
    "/manage/schedules/:scheduleId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_SCHEDULES),
    (req, res) => transportationController.deleteSchedulePost(req, res, db)
  );

  router.post(
    "/manage/routes",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_ROUTES),
    (req, res) => transportationController.createRoutePost(req, res, db)
  );

  router.post(
    "/manage/routes/:routeId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_ROUTES),
    (req, res) => transportationController.updateRoutePost(req, res, db)
  );

  router.post(
    "/manage/routes/:routeId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_ROUTES),
    (req, res) => transportationController.deleteRoutePost(req, res, db)
  );

  router.post(
    "/manage/stops",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_ROUTES),
    (req, res) => transportationController.createStopPost(req, res, db)
  );

  router.post(
    "/manage/stops/import-city",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_ROUTES),
    (req, res) => transportationController.importCityStopsPost(req, res, db)
  );

  router.post(
    "/manage/stops/:stopId/update",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_ROUTES),
    (req, res) => transportationController.updateStopPost(req, res, db)
  );

  router.post(
    "/manage/stops/:stopId/delete",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_ROUTES),
    (req, res) => transportationController.deleteStopPost(req, res, db)
  );


  router.post(
    "/manage/students/access",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_STUDENTS),
    (req, res) => transportationController.bulkUpdateStudentAccessPost(req, res, db)
  );

  router.post(
    "/manage/arrival-setting",
    isAuthenticated,
    requirePermission([PERMISSIONS.TRANSPORT_SETTINGS, PERMISSIONS.TRANSPORT_REPORTS]),
    (req, res) => transportationController.arrivalSettingPost(req, res, db)
  );

  router.get(
    "/manage/reports",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_REPORTS),
    (req, res) => transportationController.manageReportsGet(req, res, db)
  );

  router.post(
    "/manage/reports/:reportId/review",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_REPORTS),
    (req, res) => transportationController.manageReportReviewPost(req, res, db)
  );

  router.get(
    "/manage/requests",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_STUDENTS),
    (req, res) => transportationController.manageRequestsGet(req, res, db)
  );

  router.post(
    "/manage/requests/:requestId/approve",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_STUDENTS),
    (req, res) => transportationController.manageRequestApprovePost(req, res, db)
  );

  router.post(
    "/manage/requests/:requestId/decline",
    isAuthenticated,
    requirePermission(PERMISSIONS.TRANSPORT_STUDENTS),
    (req, res) => transportationController.manageRequestDeclinePost(req, res, db)
  );

  router.get(
    "/manage/students/:studentId",
    isAuthenticated,
    requirePermission([PERMISSIONS.TRANSPORT_STUDENTS, PERMISSIONS.TRANSPORT_STUDENT_ROUTES]),
    (req, res) => transportationController.studentPanelGet(req, res, db)
  );

  router.post(
    "/manage/students/:studentId/save",
    isAuthenticated,
    requirePermission([PERMISSIONS.TRANSPORT_STUDENTS, PERMISSIONS.TRANSPORT_STUDENT_ROUTES]),
    (req, res) => transportationController.studentPanelSavePost(req, res, db)
  );

  router.get(
    "/driver/mobile",
    isAuthenticated,
    (req, res) => res.redirect("/driver/dashboard")
  );

  router.post("/driver/trips/start", isAuthenticated, (req, res) =>
    transportationController.startTripPost(req, res, db)
  );

  router.post("/driver/trips/end", isAuthenticated, (req, res) =>
    transportationController.endTripPost(req, res, db)
  );

  router.post("/driver/reports", isAuthenticated, (req, res) =>
    transportationController.driverReportPost(req, res, db)
  );


  router.post("/driver/trips/boarding", isAuthenticated, (req, res) => transportationController.driverBoardingPost(req, res, db));
  router.get("/driver/not-riding", isAuthenticated, (req, res) => transportationController.driverNotRidingGet(req, res, db));
  router.post("/driver/locate", isAuthenticated, (req, res) =>
    transportationController.driverLocatePost(req, res, db)
  );

  router.post("/driver/live-location", isAuthenticated, (req, res) =>
    transportationController.postLiveLocation(req, res, db)
  );

  // Road-following route between points, for every bus map (staff, drivers,
  // parents, students). ?points=lat,lng;lat,lng;...
  router.get("/road-route", async (req, res) => {
    if (!req.session || !req.session.organizationId) {
      return res.status(401).json({ success: false, message: "Please sign in." });
    }
    try {
      const route = await roadRoute(req.query.points);
      res.set("Cache-Control", "private, max-age=3600");
      if (!route) return res.json({ success: false, message: "Road route unavailable right now." });
      const { steps, ...line } = route;
      return res.json({ success: true, ...line, ...(req.query.steps === "1" ? { steps } : {}) });
    } catch (error) {
      return res.json({ success: false, message: "Road route unavailable right now." });
    }
  });

  router.get("/live/student/:studentId", authorizeStudentLiveAccess, (req, res) =>
    transportationController.getLiveByStudent(req, res, db)
  );

  router.get("/live/routes", isAuthenticated, blockGuardians, (req, res) =>
    transportationController.getLiveRoutes(req, res, db)
  );

  router.get("/live/route/:routeId", isAuthenticated, blockGuardians, (req, res) =>
    transportationController.getLiveByRoute(req, res, db)
  );

  return router;
};
