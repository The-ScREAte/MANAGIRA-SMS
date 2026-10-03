// HTTP client for the main Managira app's thin internal API
// (routes/internalApiRoute.js in the main repo). Every call carries the
// shared service token; this is the ONLY way Mira ever reads Managira
// business data or validates a session - it never queries the main app's
// tables directly.
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { AsyncLocalStorage } = require("node:async_hooks");

// Matches server.js's own BASE_PORT exactly (process.env.PORT, which Render
// assigns dynamically - e.g. 10000, not a fixed number) so this default is
// correct on a co-located single-service deploy without anyone having to
// track Render's assigned port by hand. Only override
// MAIN_APP_INTERNAL_BASE_URL if the main app is a genuinely separate
// service reachable at a different internal address.
const MAIN_APP_INTERNAL_BASE_URL = process.env.MAIN_APP_INTERNAL_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
const MIRA_SERVICE_TOKEN = process.env.MIRA_SERVICE_TOKEN;

// The signed-in caller (req.tenant) for the tool call in progress - set by
// tools/index.js runTool. Every read made during that tool call carries the
// caller's identity, so the main app can apply the same permission checks
// as its own pages without each tool having to remember.
const callerContext = new AsyncLocalStorage();

function runAsCaller(tenant, fn) {
  return callerContext.run(tenant || null, fn);
}

// Only staff identities are sent as userId/role: a guardian's or student's
// id must never be read as a staff user id by a permission check.
function callerIdentityFields() {
  const tenant = callerContext.getStore();
  if (!tenant) return {};
  const fields = {
    organizationId: tenant.organizationId,
    viewerType: tenant.viewerType,
  };
  if (tenant.viewerType === "staff") {
    Object.assign(fields, {
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
    });
  }
  return fields;
}

// Adds the caller's identity to a GET (read) query string, without
// overriding anything the tool already set. Writes are left alone: their
// tools already send the caller's identity, and some write endpoints use the
// same field names for someone else (e.g. userEmail = the person a document
// is shared with), so filling them in there could act on the wrong person.
function withCallerIdentity(path, method) {
  if (method !== "GET") return path;
  const entries = Object.entries(callerIdentityFields()).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return path;

  const url = new URL(path, "http://internal");
  entries.forEach(([key, value]) => {
    if (!url.searchParams.has(key) || url.searchParams.get(key) === "") url.searchParams.set(key, String(value));
  });
  return `${url.pathname}${url.search}`;
}

async function callInternalApi(path, { method = "GET", body } = {}) {
  if (!MIRA_SERVICE_TOKEN) {
    throw new Error("MIRA_SERVICE_TOKEN is not configured - cannot call the main app's internal API.");
  }

  const res = await fetch(`${MAIN_APP_INTERNAL_BASE_URL}${withCallerIdentity(path, method)}`, {
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

module.exports = { callInternalApi, validateSession, runAsCaller };
