const { searchGuides } = require("../services/helpSearch");

// Reads Managira's own help guides (code, in memory): no school data, so every role may use it.
module.exports = {
  name: "search_help_guides",
  description: "Search all of Managira's help guides (staff, parent, student, driver and admin: PayGira, report settings, Custom editor, attendance and lunch, admissions, transportation, grading, Mira, sign-in and single sign-on, plans and billing, data migration and more). Use it for any how-to, 'where do I', 'what is' or 'can I' question about using Managira, and again with different words when the guide excerpts you were given don't answer. Returns the best sections with a link each. Read-only.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to look up, in plain words (for example 'post report cards to parents' or 'reset a teacher password')." },
      audience: { type: "string", enum: ["staff", "admin", "parent", "student", "driver"], description: "Whose point of view the answer is for. Default staff. Guides written for that role come first; the rest are still searched." },
      limit: { type: "integer", description: "How many guides to return (1 to 8, default 6)." },
    },
    required: ["query"],
  },
  async handler(args) {
    const query = String(args?.query || "").trim();
    if (!query) return { ok: false, error_message: "Say what to look up." };
    const results = searchGuides(query, { audience: args?.audience || "staff", limit: Math.min(8, Number(args?.limit) || 6), snippetChars: 360 });
    if (!results.length) return { ok: true, results: [], note: "No guide covers this. Say so plainly; don't guess steps. Try different words once, then tell the person and name the page to check." };
    return {
      ok: true,
      results: results.map((r) => ({ title: r.title, topic: r.topic, section: r.section, url: r.url, snippet: r.snippet })),
      note: "Read a whole guide with get_help_guide. Cite the url of each guide you use.",
    };
  },
};
