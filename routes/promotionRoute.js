const express = require("express");
const router = express.Router();
const promotionController = require("../controllers/promotionController");
const { isAuthenticated } = require("../middleware/middleware"); // ✅ Import

// View - Only for authenticated users
router.get("/apply", isAuthenticated, promotionController.applyPromotionPage);
router.post("/schedule", isAuthenticated, promotionController.schedulePromotion);
router.post("/cancel", isAuthenticated, promotionController.cancelScheduledPromotion);
router.post("/reverse", isAuthenticated, promotionController.reverseAppliedPromotion);
router.post("/deleteReversed", isAuthenticated, promotionController.deleteReversedPromotion);

module.exports = router;
