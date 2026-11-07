const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_activities",
  description: 'Upcoming class and whole-school activities (field trips, clubs and so on). A teacher sees their own classes and whole-school ones; someone who publishes events sees all. Defaults to the next 60 days. Read-only.',
  parameters: { type: "object", properties: { className: { type: "string", description: "Only this class." }, from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, required: [] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view activities");
    const params = new URLSearchParams({
      organizationId: String(tenant.organizationId),
      userId: String(tenant.userId || ""),
      userRole: tenant.userRole || "",
      accountType: tenant.accountType || "",
      userEmail: tenant.userEmail || "",
    });
    if (args?.className) params.set("className", String(args.className));
    if (args?.from) params.set("from", String(args.from));
    if (args?.to) params.set("to", String(args.to));
    try {
      return await callInternalApi(`/internal/api/activities?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) error.denied = true;
      throw error;
    }
  },
};
