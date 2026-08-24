const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "update_website_article",
  description: "Edit an existing website article's heading or paragraph. Only pass what's changing. Needs Manage Settings. Identify by its exact current heading.",
  parameters: {
    type: "object",
    properties: {
      heading: { type: "string", description: "The article's exact CURRENT heading." },
      newHeading: { type: "string", description: "New heading, if changing it (3-100 characters)." },
      paragraph: { type: "string", description: "New paragraph, if changing it (at least 10 characters)." },
    },
    required: ["heading"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "edit website articles");
    const heading = String(args?.heading || "").trim();
    if (!heading) {
      return { status: "needs_info", message: "I need the article's exact current heading." };
    }

    try {
      const result = await callWriteApi("/internal/api/website/articles/update", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        heading,
        newHeading: args?.newHeading,
        paragraph: args?.paragraph,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "School Website",
        recordType: "article",
        recordLabel: result.heading,
        description: `Updated article "${result.heading}" via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
