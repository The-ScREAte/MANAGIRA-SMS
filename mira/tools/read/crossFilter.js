// find_students: one question about several things at once ("Grade 4 students who ride the bus,
// owe fees and were absent more than twice this month") answered on the server as ALL of the
// conditions together (utils/miraRead/crossFilter.js), never by Mira comparing lists.
const { readTool } = require("./_factory");

module.exports = {
  tools: [
    readTool({
      name: "get_class_readiness",
      description:
        "Per class, worked out on the server: students, report cards posted / not posted / sent, scores still missing in the gradebook, and the class's teachers " +
        "(main, assistants, subject teachers). status ready_to_post = classes where report cards aren't all posted yet but every score is entered; " +
        "missing_scores = classes still missing scores; not_posted; all. Use it for any question that combines report cards with scores or teachers across classes " +
        "(\"which teachers have classes ready to post\", \"which classes still have missing scores\"). Omit classes for every class the person can see.",
      parameters: {
        type: "object",
        properties: {
          classes: { type: "string", description: "Classes or grades as the person wrote them. Omit for every class." },
          term: { type: "string", description: "Term name; omit for the current term." },
          status: { type: "string", enum: ["ready_to_post", "missing_scores", "not_posted", "all"] },
        },
      },
      query: (a) => ({ classes: a.classes, term: a.term, status: a.status }),
      access: { allOf: ["reports_terminal", "manage_assessments"] },
      areas: ["reports", "assessments"],
      coverage: "reports_and_transcripts",
    }),
    readTool({
      name: "find_students",
      description:
        "Find the students who match ALL of several conditions at once, worked out on the server: in these classes or grades (as the person wrote them; " +
        "every class of a grade is included and named), riding the bus, owing fees, absent at least N days in a date range, or with a parent form outstanding. " +
        "Use it whenever a question combines two or more of these (\"Grade 4 students who ride the bus and owe fees\", \"who was absent 3+ days and has a form outstanding\"). " +
        "\"More than twice\" means min_absences 3. \"This month\" is from the 1st of this month to today (see Coming days). Returns totals.matched (use it as the answer), " +
        "each condition's own count, and the students. If one condition can't be checked the whole answer is refused with why.",
      parameters: {
        type: "object",
        properties: {
          classes: { type: "string", description: "Classes or grades as the person wrote them, e.g. \"Grade 4\" or \"6A, 6B\". Omit for every class they can see." },
          rides_bus: { type: "boolean", description: "true: only students with an active bus assignment; false: only those without one." },
          owes_fees: { type: "boolean", description: "true: only students who still owe money (PayGira Overdue)." },
          min_owed: { type: "number", description: "Only students owing at least this amount." },
          min_absences: { type: "integer", description: "Only students absent at least this many school days in the dates. \"More than twice\" = 3." },
          from: { type: "string", description: "Attendance dates from, YYYY-MM-DD (or YYYY-MM)." },
          to: { type: "string", description: "Attendance dates to, YYYY-MM-DD." },
          forms_outstanding: { type: "boolean", description: "true: only students with a form their parents haven't completed." },
        },
      },
      query: (a) => ({ classes: a.classes, rides_bus: a.rides_bus, owes_fees: a.owes_fees, min_owed: a.min_owed, min_absences: a.min_absences, from: a.from, to: a.to, forms_outstanding: a.forms_outstanding }),
      access: { open: true },
      areas: ["students", "transport"],
      coverage: "students",
    }),
  ],
};
