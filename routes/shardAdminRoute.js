const express = require("express");
const { authRateLimit } = require("../utils/authRateLimit");
const { requireSuperAdmin, requireFreshPassword, confirmPage, confirmPassword } = require("../middleware/shardAdminGuard");
const shardAdmin = require("../controllers/shardAdminController");

const router = express.Router();
router.use(requireSuperAdmin);

router.get("/confirm", confirmPage);
router.post("/confirm", authRateLimit("shard-confirm", { field: "next", perAccount: 20, perIp: 30 }), confirmPassword);
router.use(requireFreshPassword);

router.get("/", shardAdmin.overview);
router.post("/", shardAdmin.createShard);
router.get("/new", shardAdmin.newShard);
router.get("/features", shardAdmin.features);
router.post("/features/:featureKey", shardAdmin.saveFeature);
router.get("/releases", shardAdmin.releases);
router.post("/releases/candidate", shardAdmin.addCandidate);
router.post("/releases/:releaseId/approve", shardAdmin.approve);
router.post("/releases/:releaseId/roll-out", shardAdmin.rollOut);
router.post("/deployments/:deploymentId/roll-back", shardAdmin.rollBack);
router.post("/moves", shardAdmin.startMove);
router.get("/moves/:moveId.json", shardAdmin.moveStatus);
router.post("/moves/:moveId/retry-cleanup", shardAdmin.retryCleanup);
router.get("/:shardId", shardAdmin.detail);
router.post("/:shardId/settings", shardAdmin.saveSettings);
router.post("/:shardId/retired", shardAdmin.setRetired);

module.exports = router;
