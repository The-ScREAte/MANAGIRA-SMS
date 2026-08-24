const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "delete_website_image",
  description:
    "Delete an image from the school's public website. DESTRUCTIVE and PERMANENT - removes the actual file, not just the listing. Needs Manage Settings. " +
    "Identify by imageId (from list_website_gallery_images) or a distinctive snippet of its caption. " +
    "First call with confirm omitted/false to get the warning; relay it in full and get explicit confirmation. On any clear yes in a later message, call again with confirm=true.",
  parameters: {
    type: "object",
    properties: {
      imageId: { type: "number" },
      captionSnippet: { type: "string" },
      confirm: { type: "boolean", description: "Set true ONLY after the user has explicitly confirmed the delete after seeing the danger warning." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete website images");
    if (!args?.imageId && !args?.captionSnippet) {
      return { status: "needs_info", message: "I need an imageId or a snippet of the image's caption to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/website/images/delete", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        imageId: args?.imageId,
        captionSnippet: args?.captionSnippet,
        confirm: args?.confirm === true,
      });

      if (result.status === "confirmation_required") return result;

      await logMiraActivity(tenant, {
        actionType: "Deleted",
        moduleName: "School Website",
        recordType: "image",
        recordId: String(result.imageId),
        description: `Deleted a website image via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 404) return { status: "not_found", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
