const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

module.exports = {
  name: "list_sent_messages",
  description:
    "Recent Mailroom messages and whether each was delivered (sent / failed / still sending), newest first - use to check on messages sent " +
    "earlier or find failures. Optional filters: channel and status. Needs the Mailroom permission.",
  parameters: {
    type: "object",
    properties: {
      channel: { type: "string", enum: ["email", "sms", "whatsapp"] },
      status: { type: "string", enum: ["sent", "failed", "pending"] },
      limit: { type: "number", description: "Default 20, max 50." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "view Mailroom history");
    const params = new URLSearchParams({ organizationId: String(tenant.organizationId) });
    if (args?.channel) params.set("channel", args.channel);
    if (args?.status) params.set("status", args.status);
    if (args?.limit) params.set("limit", String(args.limit));
    try {
      return await callInternalApi(`/internal/api/messages/history?${params.toString()}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      throw error;
    }
  },
};
