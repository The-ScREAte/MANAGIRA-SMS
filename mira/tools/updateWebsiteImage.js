const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "update_website_image",
  description:
    "Edit an existing website image's caption or allocation (hero/slideshow/siteImage). Only pass what's changing. Needs Manage Settings. " +
    "Identify the image by imageId (from list_website_gallery_images) or a distinctive snippet of its current caption.",
  parameters: {
    type: "object",
    properties: {
      imageId: { type: "number" },
      captionSnippet: { type: "string", description: "A distinctive snippet of the image's CURRENT caption, if imageId isn't known." },
      caption: { type: "string", description: "New caption, if changing it." },
      allocation: { type: "string", enum: ["hero", "slideshow", "siteImage"], description: "New allocation, if changing it." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "edit website images");
    if (!args?.imageId && !args?.captionSnippet) {
      return { status: "needs_info", message: "I need an imageId or a snippet of the image's current caption to find it." };
    }

    try {
      const result = await callWriteApi("/internal/api/website/images/update", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        imageId: args?.imageId,
        captionSnippet: args?.captionSnippet,
        caption: args?.caption,
        allocation: args?.allocation,
      });

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "School Website",
        recordType: "image",
        recordId: String(result.imageId),
        recordLabel: (result.caption || "").slice(0, 80),
        description: `Updated a website image via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400 || error.status === 404) return { status: "needs_info", message: error.message };
      if (error.status === 409) return { status: "ambiguous", message: error.message };
      throw error;
    }
  },
};
