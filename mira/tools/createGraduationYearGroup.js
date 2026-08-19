const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_graduation_year_group",
  description:
    "Create a graduation year group for a given 4-digit year, matching the \"+ Add New Items\" > New Graduation Year Group form. Requires the Manage Classes & Subjects permission. " +
    "The group's name is always auto-generated as \"Graduation Class of {year} Group\" - never invent a different name.",
  parameters: {
    type: "object",
    properties: { year: { type: "string", description: "4-digit graduation year, e.g. \"2031\"." } },
    required: ["year"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "create graduation year groups");

    const year = String(args?.year || "").trim();
    if (!/^\d{4}$/.test(year)) {
      return { status: "needs_info", message: "I need a 4-digit graduation year, e.g. \"2031\"." };
    }

    const result = await callWriteApi("/internal/api/graduation-year-groups/create", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      year,
    });

    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "Graduation Year Groups",
      recordType: "graduation_year_group",
      recordId: String(result.graduationYearGroup.id),
      recordLabel: result.graduationYearGroup.name,
      description: `Created graduation year group "${result.graduationYearGroup.name}" via Mira (AI assistant).`,
    });

    return { status: "done", ...result };
  },
};
