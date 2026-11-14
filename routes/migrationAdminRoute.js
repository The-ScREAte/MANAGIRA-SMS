// Super Admin › Migration queue (controllers/dataMigrationController.js): platform super admins
// only, with a password confirmed in the last 30 minutes, as for shards, and an authenticator
// code from the last 30 minutes.
const express = require("express");
const db = require("../config/db");
const { requireSuperAdmin, requireFreshPassword } = require("../middleware/shardAdminGuard");
const migration = require("../controllers/dataMigrationController");

const router = express.Router();
router.use(requireSuperAdmin, requireFreshPassword);
router.get("/code", (req, res) => migration.adminCodePage(req, res, db));
router.post("/code", (req, res) => migration.adminCodePost(req, res, db));
router.use(migration.adminCodeGate);
router.get("/", (req, res) => migration.adminQueue(req, res, db));
router.get("/:orgId(\\d+)", (req, res) => migration.adminJob(req, res, db));
router.post("/:orgId(\\d+)/:what(start|stop|cancel)", (req, res) => migration.adminToggle(req, res, db));
router.post("/hubs/:hubId(\\d+)/start", (req, res) => migration.adminHubStart(req, res, db));
router.post("/requests/:requestId(\\d+)/:what(contacted|approve|decline)", (req, res) => migration.adminRequestDecide(req, res, db));
router.post("/:orgId(\\d+)/import", (req, res) => migration.adminImport(req, res, db));
router.post("/:orgId(\\d+)/rollback", (req, res) => migration.adminRollback(req, res, db));
router.post("/:orgId(\\d+)/start-over", (req, res) => migration.adminStartOver(req, res, db));
router.post("/:orgId(\\d+)/columns/:columnId(\\d+)/resolve", (req, res) => migration.adminResolve(req, res, db));
router.post("/:orgId(\\d+)/roles/:roleId(\\d+)/resolve", (req, res) => migration.adminRoleResolve(req, res, db));
router.post("/:orgId(\\d+)/codes/:kind(user|organization)/:accountId(\\d+)/reset", (req, res) => migration.adminCodeReset(req, res, db));
module.exports = router;
