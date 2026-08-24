const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_school_announcement",
  description:
    "Post an announcement on the Announcements & Events page. Needs Publish Events & Announcements. Not the same feature as any platform/admin-level announcement tool - this is specifically the school's own page. " +
    "visibility defaults to \"org\" (internal-only) if not given - only set \"public\" or \"both\" if the user actually wants it on the school's public website. " +
    "Setting notifyByEmail sends a REAL email to guardians right away - needs explicit confirmation first (call with confirm omitted/false to get the warning, then confirm=true once the user clearly agrees); without notifyByEmail this runs immediately.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string" },
      visibility: { type: "string", enum: ["org", "public", "both"], description: "Defaults to org (internal-only)." },
      notifyByEmail: { type: "boolean", description: "Sends a real email to guardians immediately. Defaults to false." },
      confirm: { type: "boolean", description: "Only needed (and only checked) when notifyByEmail is true." },
    },
    required: ["message"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "post announcements");
    const message = String(args?.message || "").trim();
    if (!message) {
      return { status: "needs_info", message: "I need the announcement text." };
    }

    try {
      const result = await callWriteApi("/internal/api/school-announcements/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        message,
        visibility: args?.visibility,
        notifyByEmail: args?.notifyByEmail === true,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "Events & Announcements",
        recordType: "announcement",
        recordLabel: result.message.slice(0, 80),
        description: `Posted an announcement via Mira (AI assistant): "${result.message.slice(0, 120)}${result.message.length > 120 ? "..." : ""}"`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
