const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_test_status",
  description:
    "Lock, unlock, activate, or deactivate a test - matching the lock/unlock controls on Manage Assessments. Needs Manage Assessments. " +
    "\"lock\" blocks any further score entry/edits; \"unlock\" reopens it. \"deactivate\" hides/disables the test; \"activate\" restores it. This is reversible and does not touch or risk any existing scores.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The test's exact name." },
      termName: { type: "string", description: "Defaults to current term." },
      yearLabel: { type: "string", description: "Optional school year label (e.g. \"2026-2027\") to disambiguate if termName is reused across multiple years." },
      action: { type: "string", enum: ["lock", "unlock", "activate", "deactivate"] },
    },
    required: ["title", "action"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change test status");

    const title = String(args?.title || "").trim();
    const action = String(args?.action || "").trim().toLowerCase();
    if (!title || !["lock", "unlock", "activate", "deactivate"].includes(action)) {
      return { status: "needs_info", message: "I need the test's exact name and one action: lock, unlock, activate, or deactivate." };
    }

    const result = await callWriteApi("/internal/api/assessments/control", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      title,
      termName: args?.termName,
      yearLabel: args?.yearLabel,
      action,
    });

    const PAST_TENSE = { lock: "Locked", unlock: "Unlocked", activate: "Activated", deactivate: "Deactivated" };
    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "Assessments",
      recordType: "test",
      recordId: String(result.groupId),
      recordLabel: result.title,
      description: `${PAST_TENSE[action]} test "${result.title}" via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
