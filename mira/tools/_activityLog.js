// Shared helper (not a tool itself, not registered in index.js) - every
// Mira tool that changes data in the main app calls this right after a
// successful write so the action shows up in the org's own Activity Logs
// page (/common/activityLogs) alongside human-performed actions, tagged as
// coming through Mira. Best-effort: a logging failure must never surface
// as if the underlying action itself failed.
const { callInternalApi } = require("../internalApiClient");

async function logMiraActivity(tenant, { actionType, moduleName, recordType, recordId, recordLabel, description, changedFields }) {
  try {
    await callInternalApi("/internal/api/activity-logs", {
      method: "POST",
      body: {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userName: tenant.displayName,
        userRole: tenant.userRole,
        actionType,
        moduleName,
        pagePath: "/common/manageRecords",
        recordType,
        recordId,
        recordLabel,
        description,
        changedFields,
      },
    });
  } catch (error) {
    console.error("[mira/tools] failed to write activity log", error);
  }
}

module.exports = { logMiraActivity };
