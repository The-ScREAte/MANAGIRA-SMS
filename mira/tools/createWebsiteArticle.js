const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_website_article",
  description: "Add an article/text section to the school's public website. Needs Manage Settings. heading must be 3-100 characters; paragraph at least 10 characters.",
  parameters: {
    type: "object",
    properties: {
      heading: { type: "string" },
      paragraph: { type: "string" },
    },
    required: ["heading", "paragraph"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "add website articles");
    const heading = String(args?.heading || "").trim();
    const paragraph = String(args?.paragraph || "").trim();
    if (!heading || !paragraph) {
      return { status: "needs_info", message: "I need both a heading and paragraph for the article." };
    }

    try {
      const result = await callWriteApi("/internal/api/website/articles/create", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        heading,
        paragraph,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "School Website",
        recordType: "article",
        recordLabel: result.heading,
        description: `Added article "${result.heading}" to the school website via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
