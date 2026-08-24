const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "rename_school_year",
  description: "Rename an existing School Year record (e.g. \"2024-2025\" -> \"2025-2026\"). Requires an admin-level role and the exact current label of the year to rename. Does not touch its terms or which year is current - use the Manage Records page in the app for that. Only call this once the user has given you both the current label and the exact new label; never guess either.",
  parameters: {
    type: "object",
    properties: {
      currentYearLabel: { type: "string", description: "The school year's exact current label, e.g. \"2024-2025\"." },
      newYearLabel: { type: "string", description: "The new label, format YYYY-YYYY with consecutive years, e.g. \"2025-2026\"." },
    },
    required: ["currentYearLabel", "newYearLabel"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "rename school years");

    const currentYearLabel = String(args?.currentYearLabel || "").trim();
    const newYearLabel = String(args?.newYearLabel || "").trim();
    if (!currentYearLabel || !newYearLabel) {
      return { status: "needs_info", message: "I need both the exact current school year label and the new label to rename it." };
    }

    const result = await callWriteApi("/internal/api/school-years/rename", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      yearLabel: currentYearLabel,
      newYearLabel,
    });

    await logMiraActivity(tenant, {
      actionType: "Updated",
      moduleName: "School Years",
      recordType: "school_year",
      recordId: String(result.id),
      recordLabel: result.newLabel,
      description: `Renamed school year "${result.oldLabel}" to "${result.newLabel}" via Mira (AI assistant).`,
      changedFields: [{ field: "year_label", from: result.oldLabel, to: result.newLabel }],
    });

    return { status: "done", ...result };
  },
};
