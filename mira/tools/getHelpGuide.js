const { guideText } = require("../services/helpSearch");

// The whole text of one help guide (steps, notes, tables, FAQs, where to find things), trimmed.
module.exports = {
  name: "get_help_guide",
  description: "Read one Managira help guide in full (its steps, notes and frequently asked questions), trimmed to about 6,000 characters. Give the url or slug from search_help_guides or from the guide excerpts, and optionally a section name to read first. Read-only.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The guide's link (/legal/user-documentation/<slug>) or its slug." },
      slug: { type: "string", description: "The guide's slug, if you have it instead of the link." },
      section: { type: "string", description: "A section heading (or words from it) to put first." },
    },
    required: [],
  },
  async handler(args) {
    const ref = String(args?.url || args?.slug || "").trim();
    if (!ref) return { ok: false, error_message: "Give the guide's url or slug." };
    const guide = guideText(ref, { section: args?.section, maxChars: 6000 });
    if (!guide) return { ok: false, error_message: "No guide matches that. Use search_help_guides to find it." };
    return { ok: true, title: guide.title, topic: guide.topic, url: guide.url, text: guide.text, truncated: guide.truncated, sections: guide.sections };
  },
};
