// Students below an attendance level, from the Report Builder's attendance per
// student report, run as the person: their own permissions and class limits
// apply, and totals are exact. Feature: mira_outreach (services/access.js).
const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");
const { checkTool } = require("../services/access");

const COLUMNS = ["student_name", "class_name", "term_name", "days", "present", "absent", "rate"];
const MAX_PAGES = 20; // 50 rows a page: up to 1,000 students checked for an uncommon level

async function currentTerm(organizationId) {
  const { terms } = await callInternalApi(`/internal/api/terms?organizationId=${encodeURIComponent(organizationId)}`);
  return (Array.isArray(terms) ? terms : []).find((term) => term.current || term.current_term) || null;
}

module.exports = {
  name: "find_low_attendance",
  description:
    "Students whose attendance is below a percentage (default 90%) for a term (default: the current term), in one or more classes or the whole school. " +
    "Returns the exact total, and for each student their class, attendance %, days marked, present and absent. Staff limited to some classes only see " +
    "those classes. Use the student names it returns for follow-ups such as draft_family_messages.",
  parameters: {
    type: "object",
    properties: {
      classNames: { type: "array", items: { type: "string" }, description: "Class names exactly as the school names them (e.g. \"7th Grade\"). Omit for every class the person can see." },
      term: { type: "string", description: "Term name. Omit for the current term." },
      below: { type: "number", description: "Attendance percentage to stay under (default 90)." },
    },
    required: [],
  },
  async handler(args, tenant, context) {
    assertIsStaff(tenant, "look up attendance");
    const below = Number(args?.below) > 0 && Number(args.below) <= 100 ? Number(args.below) : 90;
    const classNames = (Array.isArray(args?.classNames) ? args.classNames : args?.className ? [args.className] : [])
      .map((name) => String(name || "").trim()).filter(Boolean);

    let termFilter = args?.term ? String(args.term).trim() : "";
    let termLabel = termFilter;
    if (!termFilter) {
      const term = await currentTerm(tenant.organizationId);
      if (!term) return { status: "needs_info", message: "There's no current term set for this school. Which term should I check?" };
      termFilter = String(term.term_id);
      termLabel = `${term.term_name}${term.year_label ? ` ${term.year_label}` : ""} (current term)`;
    }

    // The report's own choices cover 90% and 75%; any other level is checked row by row.
    const builtIn = below === 90 ? "below90" : below === 75 ? "below75" : null;
    const filters = { term: [termFilter], ...(classNames.length ? { class: classNames } : {}), ...(builtIn ? { rate: builtIn } : {}) };
    const who = { organizationId: tenant.organizationId, userId: tenant.userId, userRole: tenant.userRole, accountType: tenant.accountType, userEmail: tenant.userEmail };
    const run = (page) => callWriteApi("/internal/api/report-builder/run", { ...who, reportType: "attendance_summary", columns: COLUMNS, filters, sortBy: "rate", sortDirection: "asc", page });

    let first;
    try {
      first = await run(1);
    } catch (error) {
      if (error.denied) throw error;
      if ([400, 404, 409].includes(error.status)) return { status: "needs_info", message: error.message };
      throw error;
    }

    let rows = first.rows || [];
    let total = first.total;
    let complete = (first.pageCount || 1) <= 1;
    if (!builtIn) {
      for (let page = 2; page <= Math.min(first.pageCount || 1, MAX_PAGES); page += 1) rows = rows.concat((await run(page)).rows || []);
      complete = (first.pageCount || 1) <= MAX_PAGES;
      rows = rows.filter((row) => row["Attendance %"] !== null && Number(row["Attendance %"]) < below);
      total = rows.length;
    }

    const students = rows.map((row) => ({
      student: row["Student name"],
      class: row.Class,
      attendancePercent: row["Attendance %"] === null ? null : Number(row["Attendance %"]),
      daysMarked: row["Days marked"],
      present: row.Present,
      absent: row.Absent,
    }));

    // The next step this person can actually take, said once at the end of the answer.
    const canDraft = context?.access && checkTool("draft_family_messages", tenant, context.access).allowed;
    const nextStep = !total
      ? "End by offering to check a wider group (another class, or every class)."
      : canDraft
        ? `End your answer with exactly this question: "Would you like me to draft a message to their families?" If they say yes, call draft_family_messages for these ${total > 25 ? "students (up to 25 at a time)" : "students"}.`
        : "";

    return {
      status: "done",
      question: `Students below ${below}% attendance`,
      term: termLabel,
      classes: classNames.length ? classNames : "every class you can see",
      filtersApplied: first.filtersApplied,
      total,
      students: students.slice(0, 50),
      note: [
        total > 50 ? `Showing the 50 lowest of ${total}; offer export_report for the full list.` : `All ${total} matching students.`,
        complete ? "" : "Only the first 1,000 students were checked; narrow it to a class for a complete answer.",
        "Attendance % is present days out of days marked this term.",
      ].filter(Boolean).join(" "),
      ...(nextStep ? { nextStep } : {}),
    };
  },
};
