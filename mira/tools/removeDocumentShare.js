const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "remove_document_share",
  description:
    "Remove a specific staff member's direct access to a Doc/Sheet. Only affects this one person - everyone/every class else keeps their access. " +
    "Needs Manage Records. (If they were the doc's creator or hold Manage Records themselves, they'll still be able to open it - this only removes the " +
    "explicit share.)",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "number" },
      title: { type: "string", description: "A distinctive snippet of the document's title, if documentId isn't known." },
      userName: { type: "string", description: "The employee's name, if userEmail isn't known." },
      userEmail: { type: "string" },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "remove a doc/sheet share");
    if (!args?.documentId && !args?.title) {
      return { status: "needs_info", message: "I need a documentId or the document's title to find it." };
    }
    if (!args?.userName && !args?.userEmail) {
      return { status: "needs_info", message: "I need the name or email of whose access to remove." };
    }

    try {
      const result = await callWriteApi("/internal/api/documents/share/remove", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        documentId: args?.documentId,
        title: args?.title,
        userName: args?.userName,
        userEmail: args?.userEmail,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Docs/Sheets",
        recordType: "document",
        recordId: String(result.documentId),
        description: `Removed a user's direct access to a doc/sheet via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      if (error.status === 403) { error.denied = true; throw error; }
      throw error;
    }
  },
};
