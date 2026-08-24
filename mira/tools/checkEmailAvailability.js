const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "check_email_availability",
  description:
    "Check whether an email address is validly formatted and not already used by someone else in the org (staff/guardian/student/student portal " +
    "login), before proposing it as a fix for a failed-email record. Read-only.",
  parameters: {
    type: "object",
    properties: {
      email: { type: "string" },
      excludeFailureId: { type: "number", description: "The failureId (from list_failed_emails) this check is for, so that record's own current owner isn't flagged as a conflict." },
    },
    required: ["email"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "check an email address");
    if (!args?.email) return { status: "needs_info", message: "I need the email address to check." };
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      email: args.email,
    });
    if (args.excludeFailureId) params.set("excludeFailureId", String(args.excludeFailureId));
    const result = await callInternalApi(`/internal/api/email-issues/check?${params.toString()}`);
    return { available: result.ok === true, reason: result.error || null };
  },
};
