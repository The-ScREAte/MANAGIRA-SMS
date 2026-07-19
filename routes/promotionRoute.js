const express = require("express");
const router = express.Router();
const promotionController = require("../controllers/promotionController");
const { isAuthenticated } = require("../middleware/middleware"); // ✅ Import
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");

// View - Only for authenticated users
router.get("/apply", isAuthenticated, requirePermission(PERMISSIONS.APPROVE_PROMOTIONS), promotionController.applyPromotionPage);
router.get("/preview", isAuthenticated, requirePermission(PERMISSIONS.APPROVE_PROMOTIONS), promotionController.getPromotionPreview);
router.post("/preview/save", isAuthenticated, requirePermission(PERMISSIONS.APPROVE_PROMOTIONS), promotionController.savePromotionPreviewOverrides);
router.post("/schedule", isAuthenticated, requirePermission(PERMISSIONS.APPROVE_PROMOTIONS), promotionController.schedulePromotion);
router.post("/cancel", isAuthenticated, requirePermission(PERMISSIONS.APPROVE_PROMOTIONS), promotionController.cancelScheduledPromotion);
router.post("/reverse", isAuthenticated, requirePermission(PERMISSIONS.APPROVE_PROMOTIONS), promotionController.reverseAppliedPromotion);
router.post("/deleteReversed", isAuthenticated, requirePermission(PERMISSIONS.APPROVE_PROMOTIONS), promotionController.deleteReversedPromotion);
router.post("/applyNow", isAuthenticated, requirePermission(PERMISSIONS.APPROVE_PROMOTIONS), promotionController.applyNow);

module.exports = router;
