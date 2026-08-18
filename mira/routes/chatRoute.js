const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { rateLimiter } = require("../middleware/rateLimiter");

router.post("/", rateLimiter({ perUserPerMinute: 20, perTenantPerMinute: 100 }), chatController.postChat);
router.get("/history", chatController.getHistory);
router.post("/messages/:messageId/feedback", chatController.setMessageFeedback);
router.get("/:id", chatController.getChat);
router.patch("/:id", chatController.renameChat);
router.delete("/:id", chatController.deleteChat);

module.exports = router;
