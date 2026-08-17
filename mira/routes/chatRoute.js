const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { rateLimiter } = require("../middleware/rateLimiter");

router.post("/", rateLimiter({ perUserPerMinute: 20, perTenantPerMinute: 100 }), chatController.postChat);
router.get("/history", chatController.getHistory);
router.get("/:id", chatController.getChat);

module.exports = router;
