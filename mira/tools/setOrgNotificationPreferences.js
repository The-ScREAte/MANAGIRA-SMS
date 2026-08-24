const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_organization_notification_preferences",
  description:
    "Turn an ORG-WIDE notification setting on/off (affects everyone, not just the caller) - currently just whether new guardians get auto-invited to " +
    "the parent portal when added while creating a student. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: {
      preferences: { type: "object", description: "Map of preference key -> true/false.", additionalProperties: { type: "boolean" } },
    },
    required: ["preferences"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change organization-wide notification settings");
    if (!args?.preferences || !Object.keys(args.preferences).length) {
      return { status: "needs_info", message: "I need at least one preference to change." };
    }

    try {
      const result = await callWriteApi("/internal/api/notifications/preferences/organization/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        preferences: args.preferences,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Settings",
        recordType: "org_notification_preferences",
        description: `Updated organization-wide notification settings via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
