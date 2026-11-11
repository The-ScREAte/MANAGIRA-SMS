const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "create_activity",
  description: 'Add an activity for a class, or for the whole school if no class is named. Parents and students of that class see it and get a notification, so say that when you confirm it. Teachers can add to their own classes; whole-school needs Publish Events & Announcements.',
  parameters: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, endDate: { type: "string", description: "YYYY-MM-DD, only if it runs over several days" }, startTime: { type: "string", description: "HH:MM, 24-hour" }, endTime: { type: "string", description: "HH:MM, 24-hour. Only if the person gave an end time or how long it lasts." }, location: { type: "string", description: "Only if the person said where. Never guess one." }, details: { type: "string", description: "Only what the person said about it. Leave out if they said nothing more than the title." }, className: { type: "string", description: "Leave out for the whole school." } }, required: ["title", "date"] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "add activities");
    const result = await callWriteApi("/internal/api/activities/create", {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
      userName: tenant.displayName,
      title: args?.title,
      date: args?.date,
      endDate: args?.endDate,
      startTime: args?.startTime,
      endTime: args?.endTime,
      location: args?.location,
      details: args?.details,
      className: args?.className,
    });
    await logMiraActivity(tenant, {
      actionType: "Created",
      moduleName: "Activities",
      recordType: "create_activity",
      recordLabel: String(result.title || args?.questionSetId || ""),
      description: "create_activity through Mira.",
    });
    return result;
  },
};
