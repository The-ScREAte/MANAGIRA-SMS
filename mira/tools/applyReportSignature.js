const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

// Puts an uploaded signature on some classes' report cards (previewed first).
module.exports = {
  name: "apply_report_signature",
  description:
    "Make some classes' report cards carry one of the school's uploaded signatures (by its name or title, from list_report_signatures), replacing the one they had. " +
    "Call once per signature: different classes can get different signatures in separate calls. Only signatures already uploaded in Report Settings; " +
    "Mira can't upload a new one. First call without confirm shows a preview. Needs Report Settings.",
  parameters: {
    type: "object",
    properties: {
      signature: { type: "string", description: "The signature's name or title, exactly as list_report_signatures gives it." },
      classNames: { type: "array", items: { type: "string" }, description: "The exact class names." },
      confirm: { type: "boolean" },
    },
    required: ["signature", "classNames"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "change report-card signatures");
    try {
      const result = await callWriteApi("/internal/api/reports/signatures/apply", {
        organizationId: tenant.organizationId, userId: tenant.userId, userRole: tenant.userRole, accountType: tenant.accountType, userEmail: tenant.userEmail,
        signature: args.signature, classNames: args.classNames, confirm: args.confirm === true,
      });
      if (result.status === "confirmation_required") return { status: "confirm", ...result };
      await logMiraActivity(tenant, {
        actionType: "Updated", moduleName: "Report Settings", recordType: "signature", recordLabel: result.signature,
        description: `Put the signature ${result.signature} on ${result.classes.join(", ")} via Mira (AI assistant).`,
      });
      return { status: "done", ...result };
    } catch (error) {
      if (error.denied || error.status === 403) { error.denied = true; throw error; }
      if ([400, 404, 409].includes(error.status)) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
