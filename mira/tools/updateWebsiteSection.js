const { logMiraActivity } = require("./_activityLog");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

const SECTIONS = ["quickFacts", "programs", "leadership", "testimonials", "faq", "about", "contact", "page"];
const PAGE_KEYS = ["quickFacts", "about", "programs", "gallery", "events", "announcements", "articles", "leadership", "testimonials", "faq", "contact"];
const SECTION_NAMES = {
  quickFacts: "Quick Facts", programs: "Programs & Facilities", leadership: "Leadership", testimonials: "Testimonials",
  faq: "FAQ", about: "About photo", contact: "Contact form", page: "Page order",
};

const item = {
  type: "object",
  description:
    "quickFacts: {value, label} e.g. {value:\"450+\", label:\"Students\"}. programs: {title, description, imageIndex?}. " +
    "leadership: {name, role, message?, imageIndex?}. testimonials: {quote, name, relation?}. faq: {question, answer}. " +
    "imageIndex = which image the user attached in this chat (0-based, in the order attached).",
  properties: {
    value: { type: "string" }, label: { type: "string" },
    title: { type: "string" }, description: { type: "string" },
    name: { type: "string" }, role: { type: "string" }, message: { type: "string" },
    quote: { type: "string" }, relation: { type: "string" },
    question: { type: "string" }, answer: { type: "string" },
    imageIndex: { type: "number" },
  },
};

module.exports = {
  name: "update_website_section",
  description:
    "Build or edit a section of the school's public website: quickFacts (headline numbers), programs (programs & facilities with photos), " +
    "leadership (leaders with photos), testimonials, faq, about (the photo beside About Us), contact (the contact form) or page (the order of " +
    "sections on the website, hiding built-in ones, renaming built-in headings). A section shows on the " +
    "website only when enabled and filled in. items REPLACES the list; addItems appends; updateItems changes items matched by their " +
    "title/name/question; removeItems removes by title/name/question. Photos: use imageIndex for images the user attached in this chat. " +
    "Call WITHOUT confirm first and show the user exactly what will be published; after their yes call again with the same arguments and " +
    "confirm=true. Needs Manage Settings.",
  parameters: {
    type: "object",
    properties: {
      section: { type: "string", enum: SECTIONS },
      enabled: { type: "boolean", description: "Show the section on the website (not used for about)." },
      title: { type: "string", description: "Section heading (programs, leadership, testimonials, faq, contact)." },
      intro: { type: "string", description: "Short intro under the heading (programs, contact)." },
      items: { type: "array", items: item, description: "REPLACES all items." },
      addItems: { type: "array", items: item },
      updateItems: {
        type: "array",
        items: { ...item, properties: { match: { type: "string", description: "Current title/name/question of the item." }, ...item.properties } },
      },
      removeItems: { type: "array", items: { type: "string" }, description: "Titles/names/questions of items to remove." },
      imageIndex: { type: "number", description: "about: which attached image to use as the About photo." },
      imageCaption: { type: "string", description: "about: short caption for the photo." },
      notifyEmail: { type: "string", description: "contact: the school email that receives website messages (required to switch the form on)." },
      address: { type: "string", description: "contact: address shown beside the form." },
      officeHours: { type: "string", description: "contact: e.g. Mon-Fri, 8am-4pm." },
      showMap: { type: "boolean", description: "contact: show a map of the address." },
      order: { type: "array", items: { type: "string", enum: PAGE_KEYS }, description: "page: every section key in the order it should appear (top first)." },
      hidden: { type: "array", items: { type: "string", enum: ["about", "gallery", "events", "announcements", "articles"] }, description: "page: built-in sections to hide." },
      titles: { type: "object", description: "page: new headings for built-in sections, e.g. {\"gallery\": \"Life at School\"}.", properties: { about: { type: "string" }, gallery: { type: "string" }, events: { type: "string" }, announcements: { type: "string" }, articles: { type: "string" } } },
      confirm: { type: "boolean" },
    },
    required: ["section"],
  },
  async handler(args, tenant, context) {
    assertIsStaff(tenant, "edit the school website");
    const section = String(args?.section || "");
    if (!SECTIONS.includes(section)) return { status: "needs_info", message: `Choose a section: ${SECTIONS.join(", ")}.` };

    const images = context?.images || [];
    const confirm = args?.confirm === true;
    const identity = {
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      userRole: tenant.userRole,
      accountType: tenant.accountType,
      userEmail: tenant.userEmail,
    };
    const uploaded = new Map();
    const photoPlan = [];

    // Photos are uploaded only when publishing; the preview lists which photo goes where.
    async function photoFor(index, label) {
      if (!Number.isInteger(index)) return undefined;
      if (index < 0 || index >= images.length) {
        const error = new Error(images.length
          ? `There are only ${images.length} attached image(s) - imageIndex ${index} doesn't exist.`
          : "I no longer have the photo - please attach it again.");
        error.needsInfo = true;
        throw error;
      }
      photoPlan.push({ for: label, attachedImage: index + 1 });
      if (!confirm) return undefined;
      if (!uploaded.has(index)) {
        const result = await callWriteApi("/internal/api/website/sections/image", { ...identity, imageDataUrl: images[index].dataUrl });
        uploaded.set(index, result.imageUrl);
      }
      return uploaded.get(index);
    }
    async function withPhotos(list) {
      if (!Array.isArray(list)) return undefined;
      const out = [];
      for (const raw of list) {
        const { imageIndex, ...rest } = raw || {};
        const url = await photoFor(imageIndex, rest.title || rest.name || rest.match || "item");
        out.push(url ? { ...rest, imageUrl: url } : rest);
      }
      return out;
    }

    try {
      const payload = {
        ...identity,
        section,
        enabled: typeof args?.enabled === "boolean" ? args.enabled : undefined,
        title: args?.title,
        intro: args?.intro,
        items: await withPhotos(args?.items),
        addItems: await withPhotos(args?.addItems),
        updateItems: await withPhotos(args?.updateItems),
        removeItems: args?.removeItems,
        notifyEmail: args?.notifyEmail,
        address: args?.address,
        officeHours: args?.officeHours,
        showMap: typeof args?.showMap === "boolean" ? args.showMap : undefined,
        imageCaption: args?.imageCaption,
        order: args?.order,
        hidden: args?.hidden,
        titles: args?.titles,
        confirm,
      };
      if (section === "about") {
        const url = await photoFor(args?.imageIndex, "About photo");
        if (url) payload.imageUrl = url;
      }

      const result = await callWriteApi("/internal/api/website/sections/save", payload);
      if (result.status === "confirmation_required") {
        return { status: "confirm", ...result, photos: photoPlan.length ? photoPlan : undefined };
      }

      await logMiraActivity(tenant, {
        actionType: "Updated",
        moduleName: "School Website",
        recordType: "website_section",
        recordLabel: SECTION_NAMES[section],
        description: `Updated the website's ${SECTION_NAMES[section]} section via Mira (AI assistant).`,
      });
      return { ...result, status: "done" };
    } catch (error) {
      if (error.needsInfo) return { status: "needs_info", message: error.message };
      if (error.denied) throw error;
      if ([400, 404].includes(error.status)) return { status: "needs_info", message: error.message };
      throw error;
    }
  },
};
