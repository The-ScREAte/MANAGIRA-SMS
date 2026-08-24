// HTTP client for the main Managira app's thin internal API
// (routes/internalApiRoute.js in the main repo). Every call carries the
// shared service token; this is the ONLY way Mira ever reads Managira
// business data or validates a session - it never queries the main app's
// tables directly.
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

// Matches server.js's own BASE_PORT exactly (process.env.PORT, which Render
// assigns dynamically - e.g. 10000, not a fixed number) so this default is
// correct on a co-located single-service deploy without anyone having to
// track Render's assigned port by hand. Only override
// MAIN_APP_INTERNAL_BASE_URL if the main app is a genuinely separate
// service reachable at a different internal address.
const MAIN_APP_INTERNAL_BASE_URL = process.env.MAIN_APP_INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
const MIRA_SERVICE_TOKEN = process.env.MIRA_SERVICE_TOKEN;

async function callInternalApi(path, { method = "GET", body } = {}) {
  if (!MIRA_SERVICE_TOKEN) {
    throw new Error("MIRA_SERVICE_TOKEN is not configured - cannot call the main app's internal API.");
  }

  const res = await fetch(`${MAIN_APP_INTERNAL_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": MIRA_SERVICE_TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(json.error || `Internal API call to ${path} failed with ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return json;
}

function validateSession(cookieValue) {
  return callInternalApi("/internal/api/session/validate", { method: "POST", body: { cookieValue } });
}

module.exports = { callInternalApi, validateSession };
