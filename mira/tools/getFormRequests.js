// Forms & requests (read): which forms the school asked parents or students to fill in, who still
// has each one to do this period, and who has done it, for a class, several classes or the whole
// school. Runs as the person through /internal/api/forms/status (utils/formRequests.js): the same
// rules as the families' Requests tab and the staff Forms page, and totals worked out on the
// server over the whole scope.
const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff } = require("./_writeAuth");

const codeOf = (status) => (status === 403 ? "PERMISSION_DENIED" : status === 404 ? "NOT_FOUND" : status === 400 ? "VALIDATION" : "FAILED");

module.exports = {
  name: "get_form_requests",
  description:
    "Forms & requests: the forms, permission slips, consent and sign-ups the school asked PARENTS (default) or STUDENTS to fill in " +
    "(people call them tasks, requests, forms, to-dos), and who still hasn't completed them this period. Use it for questions like " +
    "\"how many Grade 6 parents haven't completed their forms\", \"who hasn't signed the trip slip\", \"what's outstanding for 6A\". " +
    "classes takes the person's words (\"Grade 6\", \"6A\", \"JHS 1\"); every matching class is included and named. " +
    "Returns server-computed totals (use them as given, never count the list), each form's outstanding and completed counts with due dates, " +
    "and the students with what they still owe (up to 500; truncated says if there were more).",
  parameters: {
    type: "object",
    properties: {
      classes: { type: "string", description: "Class or grade in the person's words, e.g. \"Grade 6\", \"6A\", \"JHS 1\". Omit for every class the person can see." },
      form: { type: "string", description: "Part of a form's title to narrow to one form, e.g. \"trip\". Omit for every form." },
      audience: { type: "string", enum: ["parent", "student", "all"], description: "Who was asked to fill it in: parent (default), student, or all." },
      status: { type: "string", enum: ["outstanding", "completed", "all"], description: "Which students to list: outstanding (default), completed, or all." },
    },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "see form completion");
    const params = new URLSearchParams();
    if (args?.classes) params.set("classQuery", String(args.classes).slice(0, 80));
    if (args?.form) params.set("formQuery", String(args.form).slice(0, 80));
    params.set("audience", ["parent", "student", "all"].includes(args?.audience) ? args.audience : "parent");
    params.set("status", ["outstanding", "completed", "all"].includes(args?.status) ? args.status : "outstanding");
    try {
      const r = await callInternalApi(`/internal/api/forms/status?${params}`);
      return {
        ok: true,
        as_of: r.asOf,
        scope: r.scope,
        totals: r.totals,
        by_form: r.byForm,
        students: r.students.map((s) => ({ name: s.name, class: s.class, outstanding: s.outstanding.map((o) => `${o.title}${o.dueDate ? ` (due ${o.dueDate}${o.overdue ? ", overdue" : ""})` : ""}`) })),
        listed: r.listed,
        truncated: r.truncated,
        how_to_answer: r.totals.formsAsked
          ? "Lead with totals.studentsWithOutstanding of totals.studentsInScope, name scope.classes and the date, then each form's outstanding count and due date. Offer the list of names or a reminder (remind_form_outstanding) to only those families."
          : "No live form was asked of this audience in these classes: say so plainly, naming the classes.",
      };
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      return { ok: false, error_code: error.code || codeOf(error.status), error_message: error.message };
    }
  },
};
