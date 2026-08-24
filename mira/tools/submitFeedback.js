const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "submit_feedback",
  description:
    "Submit feedback about the app to the platform on the caller's behalf - a bug report, feature request, review, or general comment. This is write-only " +
    "(no way to view past feedback from here). Never invent details the user didn't actually give you.",
  parameters: {
    type: "object",
    properties: {
      feedbackType: { type: "string", enum: ["feature_request", "bug_report", "review", "general", "ux_design", "performance"] },
      area: { type: "string", enum: ["students", "attendance", "assessments", "guardians", "payments", "employees", "reports", "settings", "notifications", "mobile", "other"] },
      subject: { type: "string", description: "Max 120 characters." },
      message: { type: "string", description: "Max 2000 characters." },
      rating: { type: "number", description: "1-5. Required for feedbackType 'review', ignored otherwise." },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Required for feedbackType 'feature_request' or 'bug_report', ignored otherwise." },
    },
    required: ["feedbackType", "area", "subject", "message"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "submit feedback");
    if (!args?.feedbackType || !args?.area || !args?.subject || !args?.message) {
      return { status: "needs_info", message: "I need feedbackType, area, subject, and message." };
    }

    try {
      const result = await callWriteApi("/internal/api/feedback/submit", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        feedbackType: args.feedbackType,
        area: args.area,
        subject: args.subject,
        message: args.message,
        rating: args.rating,
        priority: args.priority,
      });
      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
