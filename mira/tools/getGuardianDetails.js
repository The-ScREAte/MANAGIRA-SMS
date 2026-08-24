const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "get_guardian_details",
  description:
    "Look up a guardian's full contact details (phone, email, address, hometown), which student(s) they're linked to, and their parent-portal access status (whether they have an account, and whether they've set a password). Look up by exactly one of: guardianName, studentName (finds that student's guardian(s)), or email. Staff only.",
  parameters: {
    type: "object",
    properties: {
      guardianName: { type: "string", description: "Guardian's name or partial name." },
      studentName: { type: "string", description: "Find the guardian(s) linked to this student instead." },
      email: { type: "string", description: "Guardian's exact email." },
    },
    required: [],
  },
  // Staff-only: full guardian PII (phone/email/address) plus portal
  // access/password status, with no ownership check against the caller -
  // a guardian/student session must not be able to pull another family's
  // contact details or account status this way.
  async handler(args, tenant) {
    assertIsStaff(tenant, "view guardian details");
    const guardianName = String(args?.guardianName || "").trim();
    const studentName = String(args?.studentName || "").trim();
    const email = String(args?.email || "").trim();
    if (!guardianName && !studentName && !email) {
      return { status: "needs_info", message: "I need a guardian name, a student name, or a guardian's exact email to look this up." };
    }

    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    if (guardianName) params.set("guardianName", guardianName);
    if (studentName) params.set("studentName", studentName);
    if (email) params.set("email", email);

    try {
      const { guardians } = await callInternalApi(`/internal/api/guardians/details?${params.toString()}`);
      if (!guardians.length) {
        return { status: "not_found", message: "No matching guardian was found." };
      }
      return { guardians };
    } catch (error) {
      return { status: error.status === 404 ? "not_found" : "needs_info", message: error.message };
    }
  },
};
