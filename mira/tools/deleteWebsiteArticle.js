const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_website_article",
  description:
    "Delete an article from the school's public website. DESTRUCTIVE and PERMANENT. Needs Manage Settings. Identify by its exact heading. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      heading: { type: "string" },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: ["heading"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete website articles");
    const heading = String(args?.heading || "").trim();
    if (!heading) {
      return { status: "needs_info", message: "I need the article's exact heading to delete it." };
    }

    try {
      const result = await callWriteApi("/internal/api/website/articles/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        heading,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "School Website",
        recordType: "article",
        recordLabel: result.heading,
        description: `Deleted article "${result.heading}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "not_found", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
