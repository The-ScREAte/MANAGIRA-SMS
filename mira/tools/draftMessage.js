const { callInternalApi } = require("../internalApiClient");

// Drafts message text only - never sends. Sending is a deliberate,
// separate confirm step in the real guardian-messaging UI (the main app's
// utils/guardianMessaging.js), which Mira does not call here.
function buildDraft({ guardianName, studentName, topic, schoolName }) {
  return (
    `Hi ${guardianName || "there"},\n\n` +
    `This is a message from ${schoolName || "the school"} regarding ${studentName ? studentName + ". " : ""}` +
    `${topic || "an update we wanted to share with you"}.\n\n` +
    `Please let us know if you have any questions.\n\nBest,\n${schoolName || "The school team"}`
  );
}

module.exports = {
  name: "draft_message",
  description:
    "Draft (but do not send) a message to a student's guardian about a topic. Looks up the guardian's contact info for the given student within the caller's own school. Requires the student's numeric ID (use find_student first).",
  parameters: {
    type: "object",
    properties: {
      studentId: { type: "number", description: "The student's numeric ID." },
      topic: { type: "string", description: "What the message should be about." },
    },
    required: ["studentId", "topic"],
  },
  async handler(args, tenant) {
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    const [guardiansResult, orgResult] = await Promise.all([
      callInternalApi(`/internal/api/students/${encodeURIComponent(args?.studentId)}/guardians?${params.toString()}`),
      callInternalApi(`/internal/api/organizations/${tenant.organizationId}`),
    ]);

    const guardians = guardiansResult.guardians || [];
    if (!guardians.length) {
      return { drafted: false, reason: "No guardian on file for this student." };
    }

    const drafts = guardians.map((g) => ({
      to: { guardianId: g.guardian_id, name: `${g.first_name} ${g.last_name}`, phone: g.phone, email: g.email },
      body: buildDraft({
        guardianName: g.first_name,
        topic: args?.topic,
        schoolName: orgResult.organization?.organization_name,
      }),
    }));

    return { drafted: true, drafts, note: "Draft only - not sent. Sending requires the Mailroom/Notify Guardians confirm step in the main app." };
  },
};
