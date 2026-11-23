// Nothing is deleted while records are attached to it (enforced in code, before any preview):
// every delete below first asks the main app what points at the record (GET /internal/api/delete-check,
// controllers/miraDeleteCheck.js).
//   Nothing attached        the delete goes on as before (preview, then confirm).
//   Records attached        it isn't deleted. Mira gets the list, and offers to keep the record or
//                           to clear what's attached first, one step at a time.
//   includeAttached: true   only when the person has asked to delete what's attached too (the
//                           orchestrator refuses the flag otherwise). A delete that takes its
//                           attached records with it (a subject's scores, an enrollment's
//                           placements, a bus's riders) then shows every one of them in its preview
//                           and still needs the name typed; one the database blocks (a class with
//                           students, a term with attendance) gets the steps to clear them instead.
const { callInternalApi } = require("../internalApiClient");

const CHECKS = {
  delete_class: (a) => ({ kind: "class", name: a.className }),
  delete_term: (a) => ({ kind: "term", termName: a.termName, yearLabel: a.yearLabel }),
  delete_school_year: (a) => ({ kind: "school_year", name: a.yearLabel }),
  delete_enrollment: (a) => ({ kind: "enrollment", termName: a.termName, yearLabel: a.yearLabel }),
  delete_subject: (a) => ({ kind: "subject", name: a.subjectName, className: a.className }),
  delete_document: (a) => ({ kind: "document", documentId: a.documentId, name: a.title }),
  delete_transport_bus: (a) => ({ kind: "bus", name: a.busNumber }),
  delete_transport_route: (a) => ({ kind: "route", name: a.routeName }),
  delete_transport_stop: (a) => ({ kind: "stop", name: a.stopName }),
};

const INCLUDE_ATTACHED = {
  type: "boolean",
  description: "Only when the person has clearly asked to delete what's attached to it too (\"and everything in it\", \"including its scores\"). Never set it on your own.",
};

// "1 class open in its enrollment", not "1 classes": the first word goes singular for a count of one.
const SINGULAR = { classes: "class", students: "student", placements: "placement", records: "record", assessments: "assessment", terms: "term", subjects: "subject", teachers: "teacher", scores: "score", places: "place", people: "person", cards: "card" };
const one = (what) => what.replace(/^(?:\w+ )?(\w+)/, (m) => m.split(" ").map((w) => SINGULAR[w] || w).join(" "));
const list = (attached) => attached.map((a) => `${a.count.toLocaleString("en-US")} ${a.count === 1 ? one(a.what) : a.what}`).join(", ");

function wrap(tool) {
  const check = CHECKS[tool.name];
  if (!check) return tool;
  const handler = tool.handler;
  return {
    ...tool,
    parameters: { ...tool.parameters, properties: { ...tool.parameters.properties, includeAttached: INCLUDE_ATTACHED } },
    async handler(args, tenant, context) {
      const { includeAttached, ...rest } = args || {};
      const query = Object.fromEntries(Object.entries(check(rest)).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      let found;
      try {
        found = await callInternalApi(`/internal/api/delete-check?${new URLSearchParams(query)}`);
      } catch (error) {
        // Unsure what's attached: nothing is deleted.
        return { status: "blocked", message: `I couldn't check what's attached to it, so nothing was deleted: ${error.message}` };
      }
      if (found.ambiguous) return { status: "needs_info", message: `More than one matches: ${found.ambiguous.join("; ")}. Which one?` };
      if (!found.found || !found.total) return handler(rest, tenant, context);

      const what = list(found.attached);
      if (!includeAttached) {
        return {
          status: "blocked",
          nothing_changed: true,
          attached: found.attached,
          message: `${found.name} wasn't deleted: it still has ${what} attached. ` +
            (found.cascades
              ? "Deleting it would delete all of that too, permanently. "
              : `It can only be deleted once those are cleared${found.clear.length ? ` (${found.clear.join("; ")})` : ""}. `) +
            "Tell the person exactly what's attached, then ask whether to keep it, or to " +
            (found.cascades ? "delete it with everything attached (they must say so)." : "clear what's attached first, one step at a time, each with its own preview."),
        };
      }
      if (!found.cascades) {
        return {
          status: "blocked",
          nothing_changed: true,
          attached: found.attached,
          message: `${found.name} can't be deleted in one step: Managira won't delete it while ${what} ${found.attached.length === 1 && found.attached[0].count === 1 ? "is" : "are"} attached. ` +
            `To get there: ${found.clear.join("; ")}. Warn the person that each of those steps is permanent, and offer to do them one at a time, each previewed.`,
        };
      }
      const result = await handler(rest, tenant, context);
      // The preview names everything that goes with it.
      if (result && typeof result === "object" && !Array.isArray(result)) {
        return { ...result, also_deletes: found.attached, warning: `${result.warning ? `${result.warning} ` : ""}This also permanently deletes ${what}.` };
      }
      return result;
    },
  };
}

module.exports = { wrap, CHECKS };
