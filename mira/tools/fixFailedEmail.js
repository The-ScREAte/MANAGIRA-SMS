const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "fix_failed_email",
  description:
    "Correct a person's broken email address (from list_failed_emails) and re-verify it: updates the real address on their own record (staff/student/" +
    "guardian), then sends a real verification email to prove it now works. If it delivers, the failure record is cleared. If it still bounces, the " +
    "failure is re-logged with the new address and this returns success:false - tell the user delivery still failed. Never invent a new email the user " +
    "didn't give you - always ask, or use check_email_availability first if unsure. Needs an org owner/Manager/Supervisor/Admin/Mini Admin role.",
  parameters: {
    type: "object",
    properties: {
      failureId: { type: "number", description: "From list_failed_emails." },
      newEmail: { type: "string" },
    },
    required: ["failureId", "newEmail"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "fix a failed email address");
    if (!args?.failureId) return { status: "needs_info", message: "I need the failureId from list_failed_emails." };
    if (!args?.newEmail) return { status: "needs_info", message: "I need the corrected email address." };

    try {
      const result = await callWriteApi("/internal/api/email-issues/fix", {
        organizationId: tenant.organizationId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        failureId: args.failureId,
        newEmail: args.newEmail,
      });

      if (!result.success) {
        // Most business-rule failures here (bad format, duplicate email, delivery still
        // failing) come back as a normal 200 with success:false, not a thrown error.
        return { status: "needs_info", message: result.error };
      }

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "Email Issues",
        recordType: "email_delivery_failure",
        recordId: String(args.failureId),
        recordLabel: args.newEmail,
        description: `${result.success ? "Fixed and verified" : "Attempted to fix"} a failed email address (${args.newEmail}) via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
