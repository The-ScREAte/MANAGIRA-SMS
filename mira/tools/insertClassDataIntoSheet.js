const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "insert_class_data_into_sheet",
  description:
    "Insert a class's active-term roster into a spreadsheet, mirroring the editor's \"Insert Students\"/\"Insert Subjects\" buttons exactly: students go " +
    "into column A (one name per row, starting at A1), subjects go into row 1 starting at column B. Both OVERWRITE whatever was already in those cells. " +
    "Needs Manage Records (same as the real button).",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the spreadsheet's title, if documentId isn't known." },
      className: { type: "string" },
      dataType: { type: "string", enum: ["students", "subjects"] },
    },
    required: ["className", "dataType"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "insert class data into a spreadsheet");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the spreadsheet's title to find it." };
    }
    if (!args?.className) return { status: "needs_info", message: "I need which class to pull data from." };

    try {
      const result = await callWriteApi("/internal/api/documents/sheet/insert-class-data", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        className: args.className,
        dataType: args?.dataType,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "spreadsheet",
        recordId: String(result.documentId),
        description: `Inserted ${result.count} ${result.dataType} from "${result.className}" into a spreadsheet via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      if (error.status === 400) return { status: "needs_info", message: error.message };
      if (error.status === 403) { error.denied = true; throw error; }
      throw error;
    }
  },
};
