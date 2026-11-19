// Remind only the families still outstanding for one parent form (Level 2: it reaches people).
// Call without confirm first: it returns the preview (form, classes, how many families, the exact
// message, how it's sent). With confirm=true, and only after the person's own yes, it sends
// through /internal/api/forms/remind (the editor's Send a reminder: each family hears at most once a
// day for a form, teachers only for their own classes).
const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");

const MAX_STUDENTS = 500;

module.exports = {
  name: "remind_form_outstanding",
  description:
    "Send a reminder to the parents who haven't completed a form the school asked them to fill in (only those still outstanding). " +
    "Call WITHOUT confirm first and show the person the preview exactly as returned (form, classes, number of families, the message, how it's sent); " +
    "call again with the same arguments and confirm=true only after their clear yes.",
  parameters: {
    type: "object",
    properties: {
      form: { type: "string", description: "The form's title or part of it, e.g. \"Field trip permission\"." },
      classes: { type: "string", description: "Class or grade in the person's words, e.g. \"Grade 6\". Omit for every class the person can see." },
      confirm: { type: "boolean", description: "true only after the person said yes to the preview." },
    },
    required: ["form"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "send reminders");
    const params = new URLSearchParams({ audience: "parent", status: "outstanding", formQuery: String(args.form || "").slice(0, 80) });
    if (args?.classes) params.set("classQuery", String(args.classes).slice(0, 80));
    let r;
    try {
      r = await callInternalApi(`/internal/api/forms/status?${params}`);
    } catch (error) {
      if (error.status === 403) { error.denied = true; throw error; }
      return { status: "needs_info", error_code: error.code || null, message: error.message };
    }
    const forms = r.byForm.filter((f) => f.audience === "parent");
    if (!forms.length) return { status: "needs_info", message: `No live parent form matches "${args.form}" in ${r.scope.classes.join(", ")}.` };
    if (forms.length > 1) return { status: "needs_info", message: `More than one form matches: ${forms.map((f) => `"${f.title}"`).join(", ")}. Which one?` };
    const form = forms[0];
    if (!form.outstanding) return { status: "done", sent: 0, message: `Every family in ${r.scope.classes.join(", ")} has already completed "${form.title}". Nothing to send.` };
    if (form.outstanding > MAX_STUDENTS) {
      return { status: "needs_info", message: `${form.outstanding} students are outstanding, more than ${MAX_STUDENTS} in one go. Narrow it to a class or grade first.` };
    }
    if (args?.confirm !== true) {
      return {
        status: "confirm",
        preview: {
          form: form.title,
          classes: r.scope.classes,
          families_of_students: form.outstanding,
          due: form.dueDate || "no deadline",
          message: { title: `Reminder: ${form.title}`, text: `Please fill it in for <the child's name>${form.dueDate ? ` by ${form.dueDate}` : ""}.` },
          sent_by: "a Managira notice and an email to each parent (plus text or WhatsApp if the form is set to use them)",
          undo: "A reminder can't be unsent. Each family hears at most once a day for this form.",
        },
        message: "Show this preview and ask for a clear yes. Then call again with the same arguments and confirm=true.",
      };
    }
    try {
      const done = await callWriteApi("/internal/api/forms/remind", {
        organizationId: tenant.organizationId, userId: tenant.userId, userRole: tenant.userRole, accountType: tenant.accountType, userEmail: tenant.userEmail,
        formId: form.formId, classQuery: args.classes || null,
      });
      return { status: "done", sent: done.sent, form: done.form, message: done.sent ? `Reminder sent to the families of ${done.sent} student${done.sent === 1 ? "" : "s"}.` : "Nobody new to remind today: these families were already reminded today." };
    } catch (error) {
      if (error.denied) throw error;
      return { status: "needs_info", message: error.message };
    }
  },
};
