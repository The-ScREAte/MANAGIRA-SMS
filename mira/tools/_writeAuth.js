// Shared guard for every Mira tool that writes/changes/deletes real data.
// Authorization is NOT decided here by guessing from a role label - each
// backend write endpoint (controllers/internalApiController.js, via
// assertHasPermission) re-derives the caller's actual granted permission
// from the database (middleware/permissionMiddleware.js userHasPermission),
// which is the only source of truth for "does this specific user, in this
// specific org, have this permission" - a role name like "Manager" vs
// "Supervisor" is not reliable enough (e.g. an org can grant/revoke a
// permission per user regardless of role).
// This guard only rules out account kinds that can structurally never
// hold a staff permission (students, guardians) before making the call,
// as a cheap first pass - everything else is left to the backend's real
// check, and a 403 from it is surfaced as a normal "denied" outcome using
// the backend's own message, not a guessed one.
const { callInternalApi } = require("../internalApiClient");

function assertIsStaff(tenant, action) {
  if (tenant.viewerType !== "staff") {
    const error = new Error(`Only staff accounts can ${action}.`);
    error.denied = true;
    throw error;
  }
}

async function callWriteApi(path, body) {
  try {
    return await callInternalApi(path, { method: "POST", body });
  } catch (error) {
    if (error.status === 403) {
      error.denied = true;
    }
    throw error;
  }
}

module.exports = { assertIsStaff, callWriteApi };
