// How shards talk to each other. Every call is signed, so nothing here is public.
const express = require("express");
const registry = require("../utils/shards/registry");
const { verifyCall } = require("../utils/shards/signing");

const router = express.Router();

router.use(express.json({
  limit: "64kb",
  verify: (req, _res, buffer) => { req.rawBody = buffer.toString(); },
}));

router.use((req, res, next) => {
  if (verifyCall(req.headers, req.rawBody || "")) return next();
  return res.status(403).json({ success: false });
});

router.post("/stats", async (_req, res) => {
  try {
    res.json(await registry.shardStats());
  } catch (error) {
    res.status(500).json({ healthy: false, error: error.message });
  }
});

// Whether these credentials belong here. Only yes or no: no details leave the shard.
router.post("/who", async (req, res) => {
  try {
    res.json({ found: await registry.credentialsMatch(req.body?.login, req.body?.password) });
  } catch (_error) {
    res.status(500).json({ found: false });
  }
});

router.post("/sync", async (_req, res) => {
  try {
    res.json({ schools: await registry.syncDirectory() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
