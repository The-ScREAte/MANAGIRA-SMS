// Backs the sidebar's class-scope selector. Thin passthrough to the main
// app's internal API - reuses the exact same tenant-scoped query
// (routes/internalApiRoute.js -> listClasses) that the get_class tool
// already calls, so there's one source of truth for "what classes exist."
const express = require("express");
const router = express.Router();
const { callInternalApi } = require("../internalApiClient");

router.get("/", async (req, res) => {
  try {
    const params = new URLSearchParams({ organizationId: String(req.tenant.organizationId), q: String(req.query.q || "") });
    const result = await callInternalApi(`/internal/api/classes?${params.toString()}`);
    res.json({ classes: result.classes || [] });
  } catch (error) {
    console.error("[mira/classesRoute]", error);
    res.status(502).json({ error: "Unable to load classes." });
  }
});

module.exports = router;
