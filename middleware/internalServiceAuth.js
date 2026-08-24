// Gates the thin internal API surface (routes/internalApiRoute.js) that the
// separate Mira AI service calls to read Managira data and validate sessions.
// Never exposed to browsers - only ever called service-to-service.
const crypto = require("crypto");

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length to avoid a length-based timing
    // signal, even though this branch is otherwise a guaranteed rejection.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function internalServiceAuth(req, res, next) {
  const expected = process.env.MIRA_SERVICE_TOKEN;
  if (!expected) {
    console.error("[internalServiceAuth] MIRA_SERVICE_TOKEN is not configured - rejecting all internal API calls.");
    return res.status(503).json({ error: "Internal API not configured." });
  }

  const provided = req.get("X-Internal-Token");
  if (!provided || !timingSafeStringEqual(provided, expected)) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  next();
}

module.exports = { internalServiceAuth, timingSafeStringEqual };
