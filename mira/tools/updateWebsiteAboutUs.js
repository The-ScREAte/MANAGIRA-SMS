const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "update_website_about_us",
  description:
    "Update the school's public website About Us section - about text, motto, public contact emails, and public contact phone numbers. Needs Manage Settings. " +
    "Only pass the fields you want changed - anything omitted keeps its current value. emails/phones, if given, REPLACE the whole list.",
  parameters: {
    type: "object",
    properties: {
      aboutUs: { type: "string" },
      motto: { type: "string" },
      emails: { type: "array", items: { type: "string" }, description: "REPLACES the entire list of public contact emails - omit to leave unchanged." },
      phones: { type: "array", items: { type: "string" }, description: "REPLACES the entire list of public contact phone numbers - omit to leave unchanged." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "edit the About Us section");

    try {
      const result = await callWriteApi("/internal/api/website/about-us/update", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        aboutUs: args?.aboutUs,
        motto: args?.motto,
        emails: args?.emails,
        phones: args?.phones,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "School Website",
        recordType: "about_us",
        recordLabel: "About Us",
        description: `Updated the school website's About Us section via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      throw error;
    }
  },
};
