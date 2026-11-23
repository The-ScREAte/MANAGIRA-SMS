const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

// The report-card signatures the school has uploaded, and which classes use each.
module.exports = {
  name: "list_report_signatures",
  description:
    "List the report-card signatures the school has uploaded (name, title, obsolete or not) and which classes' report cards use each. " +
    "Use it before apply_report_signature. Needs Report Settings.",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "see report-card signatures");
    try {
      return await callInternalApi("/internal/api/reports/signatures");
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      if ([400, 404].includes(error.status)) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
