const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const checkFeatureAccess = require('../middleware/checkFeatureAccess');
const { PERMISSIONS, userHasPermission, requirePermission } = require("../middleware/permissionMiddleware");
const db = require("../config/db");

// Statistics need Manage Records - the same rule Mira uses for stats.
const canViewStatsPage = requirePermission(PERMISSIONS.MANAGE_RECORDS);
async function canViewStatsJson(req, res, next) {
  try {
    const allowed = await userHasPermission(db, {
      userId: req.session.user?.user_id || req.session.userId || null,
      userRole: req.session.userRole || req.session.user?.account_type || null,
      organizationId: req.session.organizationId,
      accountType: req.session.accountType || req.session.user?.account_type || null,
      userEmail: req.session.user?.email || null,
    }, PERMISSIONS.MANAGE_RECORDS);
    if (allowed) return next();
    return res.status(403).json({ error: "You do not have permission to view statistics." });
  } catch (error) {
    return res.status(500).json({ error: "Unable to verify your permissions." });
  }
}

// 📊 Organization Stats with optional term selection
router.get("/organization", checkFeatureAccess, isAuthenticated, canViewStatsPage, statsController.getOrganizationStats);
router.get("/organization/export", checkFeatureAccess, isAuthenticated, canViewStatsPage, statsController.exportOrganizationStats);
router.get("/organization/pdf", checkFeatureAccess, isAuthenticated, canViewStatsPage, statsController.downloadOrganizationStatsPdf);


// 📚 Fetch Classes by Term (for class comparison selection)
router.get("/classes/:termId",  checkFeatureAccess, isAuthenticated, canViewStatsJson, statsController.getClassesByTerm);

// 🆚 Compare Classes Statistics
router.post("/class-comparison",  checkFeatureAccess, isAuthenticated, canViewStatsJson, statsController.compareClassesStats);


module.exports = router;
