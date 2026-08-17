const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");

router.post("/", chatController.postChat);
router.get("/history", chatController.getHistory);
router.get("/:id", chatController.getChat);

module.exports = router;
