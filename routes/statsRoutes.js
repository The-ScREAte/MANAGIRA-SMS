const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const checkFeatureAccess = require('../middleware/checkFeatureAccess'); 


// 📊 Organization Stats with optional term selection
router.get("/organization",  checkFeatureAccess, checkFeatureAccess, isAuthenticated, statsController.getOrganizationStats);


// 📚 Fetch Classes by Term (for class comparison selection)
router.get("/classes/:termId",  checkFeatureAccess, isAuthenticated, statsController.getClassesByTerm);

// 🆚 Compare Classes Statistics
router.post("/class-comparison",  checkFeatureAccess, isAuthenticated, statsController.compareClassesStats);


module.exports = router;
