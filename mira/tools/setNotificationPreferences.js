const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "set_notification_preferences",
  description:
    "Turn the caller's OWN personal notification preferences on/off. Use get_notification_preferences first to see valid keys for this person's role - " +
    "only pass the ones changing.",
  parameters: {
    type: "object",
    properties: {
      preferences: {
        type: "object",
        description: "Map of preference key -> true/false, e.g. {\"weekly_teacher_digest\": false}.",
        additionalProperties: { type: "boolean" },
      },
    },
    required: ["preferences"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change notification preferences");
    if (!args?.preferences || !Object.keys(args.preferences).length) {
      return { status: "needs_info", message: "I need at least one preference to change." };
    }

    try {
      const result = await callWriteApi("/internal/api/notifications/preferences/set", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        preferences: args.preferences,
      });
      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
