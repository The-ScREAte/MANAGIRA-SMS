// Full chat/orchestrator wiring lands in phase 4. This stub keeps the
// service bootable at every phase-2 checkpoint.
const express = require("express");
const router = express.Router();

router.post("/", (req, res) => {
  res.status(501).json({ error: "Chat orchestrator not wired up yet (phase 4)." });
});

module.exports = router;
