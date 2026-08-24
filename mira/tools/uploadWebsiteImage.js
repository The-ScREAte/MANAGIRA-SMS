const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

module.exports = {
  name: "upload_website_image",
  description:
    "Publish an image the user just attached in this chat to the school's public website gallery. Look at the image yourself before calling this - write a real, specific caption describing what's actually in it (people, setting, activity, anything visible); never a generic placeholder like \"school photo\", and never invent details you can't actually see. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: {
      caption: { type: "string", description: "A real, specific caption based on what you can see in the image." },
      contentType: { type: "string", enum: ["slideshow", "siteImage"], description: "\"slideshow\" = homepage slideshow rotation; \"siteImage\" = general gallery. Defaults to siteImage." },
      imageIndex: { type: "number", description: "If more than one image was attached in this message, which one (0-based). Defaults to the most recently attached." },
    },
    required: ["caption"],
  },
  async handler(args, tenant, context) {
    assertIsStaff(tenant, "publish website images");

    const images = context?.images || [];
    if (!images.length) {
      return { status: "needs_info", message: "I don't see an image attached to this message - please attach the photo you'd like posted to the website." };
    }
    const index = Number.isInteger(args?.imageIndex) && args.imageIndex >= 0 && args.imageIndex < images.length ? args.imageIndex : images.length - 1;
    const image = images[index];
    const caption = String(args?.caption || "").trim();
    if (!caption) {
      return { status: "needs_info", message: "I need a caption for the image - describe what you actually see in it." };
    }

    try {
      const result = await callWriteApi("/internal/api/website/images/upload", {
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        userRole: tenant.userRole,
        accountType: tenant.accountType,
        userEmail: tenant.userEmail,
        imageDataUrl: image.dataUrl,
        caption,
        contentType: args?.contentType,
      });

      await logMiraActivity(tenant, {
        actionType: "Created",
        moduleName: "School Website",
        recordType: "image",
        recordId: String(result.imageId),
        recordLabel: caption.slice(0, 80),
        description: `Published an image to the school website ("${caption.slice(0, 120)}${caption.length > 120 ? "..." : ""}") via Mira (AI assistant).`,
      });

      return { status: "done", ...result };
    } catch (error) {
      if (error.denied) throw error;
      if (error.status === 400) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
