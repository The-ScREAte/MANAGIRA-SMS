// Report Builder tools: everything the Report Builder page does (browse
// reports, run them with filters, save, share, schedule, favorite, export to
// Excel/CSV/Word, Managira templates). All of it runs through the main app's
// Report Builder for the signed-in staff member (controllers/
// internalReportBuilderController.js), so the answers are the school's own
// data with that person's permissions - nothing else.
const { callInternalApi } = require("../internalApiClient");
const { assertIsStaff, callWriteApi } = require("./_writeAuth");
const { logMiraActivity } = require("./_activityLog");

const who = (tenant) => ({
  organizationId: tenant.organizationId,
  userId: tenant.userId,
  userRole: tenant.userRole,
  accountType: tenant.accountType,
  userEmail: tenant.userEmail,
});

// Report Builder problems (an unknown column, a class that doesn't exist)
// come back as needs_info with the real choices, so the model asks instead of guessing.
async function attempt(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error.status === 403) { error.denied = true; throw error; }
    if ([400, 404, 409, 413].includes(error.status)) return { status: "needs_info", message: error.message };
    throw error;
  }
}

const DEFINITION = {
  reportType: { type: "string", description: "The report's key from report_builder_catalog (e.g. students, attendance, fee_balances)." },
  columns: { type: "array", items: { type: "string" }, description: "Column keys or labels exactly as report_builder_catalog lists them. Omit for the report's default columns." },
  filters: {
    type: "object",
    description: "Filter key -> value(s), using only filters and allowedValues from report_builder_catalog. Classes/terms/lists by name (e.g. {\"class\": [\"JHS 1\"], \"term\": [\"Fall Semester\"], \"gender\": [\"Female\"]}); dates as {\"from\": \"YYYY-MM-DD\", \"to\": \"YYYY-MM-DD\"}; text filters as text.",
    additionalProperties: true,
  },
  sortBy: { type: "string", description: "Optional column to sort by (must be one of the chosen columns)." },
  sortDirection: { type: "string", enum: ["asc", "desc"] },
};

const catalog = {
  name: "report_builder_catalog",
  description:
    "The Report Builder's reports, exactly as this person can use them. Without reportType: the list of reports (students, admissions, assessments, merit sheets, " +
    "attendance, parents, messages, staff, fees & payments, events, activity log...). With reportType: that report's columns and filters, and every filter's allowed " +
    "values from the school's own data (class names, terms, genders, statuses...). Always check this before run_report - never invent a report, column, filter or value.",
  parameters: { type: "object", properties: { reportType: { type: "string" } }, required: [] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "use the Report Builder");
    const query = new URLSearchParams(args?.reportType ? { reportType: args.reportType } : {});
    return attempt(() => callInternalApi(`/internal/api/report-builder/catalog?${query}`));
  },
};

const run = {
  name: "run_report",
  description:
    "Run a Report Builder report - a new one (reportType, columns, filters) or a saved one (savedReport) - on the school's live data. Returns the exact `total` " +
    "of matching records, up to 50 rows per page, and the filters applied. Use this for any list or count across students, attendance, fees, scores, staff, " +
    "parents, messages, admissions or activity. For 'how many' answer with `total` - never count rows yourself - and say which filters it's for. If there are more " +
    "rows than shown, say so and offer export_report. A figure only answers the question if filtersApplied matches what was asked - if a filter " +
    "was refused, fix it (see report_builder_catalog) and run again; never present an unfiltered total as a filtered one.",
  parameters: {
    type: "object",
    properties: { ...DEFINITION, savedReport: { type: "string", description: "Run a saved report by its name instead (see list_saved_reports)." }, page: { type: "integer", description: "Page of 50 rows (default 1)." } },
    required: [],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "run reports");
    return attempt(() => callWriteApi("/internal/api/report-builder/run", { ...who(tenant), ...args }));
  },
};

const listSaved = {
  name: "list_saved_reports",
  description: "The Report Builder's My reports: saved reports this person made or that were shared with them (name, report, owner, shares, email schedule, favorite).",
  parameters: { type: "object", properties: {}, required: [] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "see saved reports");
    return attempt(() => callInternalApi("/internal/api/report-builder/saved"));
  },
};

const save = {
  name: "save_report",
  description:
    "Save a report design to My reports (name + reportType, columns, filters), optionally with the school header on exports. To change an existing saved report's " +
    "design pass replaceSavedReport: the first call returns a warning to show; call again with confirm=true after the user's yes.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      ...DEFINITION,
      includeSchoolHeader: { type: "boolean", description: "Exports start with the school's name, logo, address, phone and date." },
      replaceSavedReport: { type: "string", description: "Name of the saved report to overwrite (owner only)." },
      confirm: { type: "boolean" },
    },
    required: ["reportType"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "save reports");
    const result = await attempt(() => callWriteApi("/internal/api/report-builder/save", { ...who(tenant), ...args }));
    if (result.status === "done") {
      await logMiraActivity(tenant, { actionType: result.updated ? "Updated" : "Created", moduleName: "Reports", recordType: "saved_report", recordLabel: result.savedReport, description: `${result.updated ? "Updated" : "Saved"} the report "${result.savedReport}" via Mira (AI assistant).` });
    }
    return result;
  },
};

const remove = {
  name: "delete_saved_report",
  description: "Delete one of this person's saved reports. First call without confirm returns the warning to show; call again with confirm=true only after an explicit yes.",
  parameters: { type: "object", properties: { savedReport: { type: "string" }, confirm: { type: "boolean" } }, required: ["savedReport"] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "delete saved reports");
    const result = await attempt(() => callWriteApi("/internal/api/report-builder/delete", { ...who(tenant), ...args }));
    if (result.status === "done") await logMiraActivity(tenant, { actionType: "Deleted", moduleName: "Reports", recordType: "saved_report", recordLabel: result.deleted, description: `Deleted the saved report "${result.deleted}" via Mira (AI assistant).` });
    return result;
  },
};

const share = {
  name: "share_saved_report",
  description:
    "Share a saved report with staff, or stop sharing (by staff names). They see it in My reports with only the data their own role allows. First call shows who " +
    "will have it; call again with confirm=true after the user's yes.",
  parameters: {
    type: "object",
    properties: {
      savedReport: { type: "string" },
      addStaff: { type: "array", items: { type: "string" }, description: "Staff names to share with." },
      removeStaff: { type: "array", items: { type: "string" }, description: "Staff names to stop sharing with." },
      confirm: { type: "boolean" },
    },
    required: ["savedReport"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "share reports");
    const result = await attempt(() => callWriteApi("/internal/api/report-builder/share", { ...who(tenant), ...args }));
    if (result.status === "done") await logMiraActivity(tenant, { actionType: "Shared", moduleName: "Reports", recordType: "saved_report", recordLabel: result.savedReport, description: `Shared "${result.savedReport}" with ${result.sharedWith.join(", ") || "nobody"} via Mira (AI assistant).` });
    return result;
  },
};

const schedule = {
  name: "schedule_saved_report",
  description:
    "Email a saved report automatically (daily, weekly on chosen days, or monthly on a day), as Excel, CSV or Word, to the person and optionally everyone it's " +
    "shared with - or stop it (frequency omitted). First call shows the plan; call again with confirm=true after the user's yes.",
  parameters: {
    type: "object",
    properties: {
      savedReport: { type: "string" },
      frequency: { type: "string", enum: ["daily", "weekly", "monthly"], description: "Omit to stop the emails." },
      weekdays: { type: "array", items: { type: "string" }, description: "For weekly: day names." },
      monthDay: { type: "integer", description: "For monthly: 1-31." },
      sendHour: { type: "integer", description: "0-23, school time (default 7)." },
      format: { type: "string", enum: ["xlsx", "csv", "docx"] },
      includeShared: { type: "boolean" },
      confirm: { type: "boolean" },
    },
    required: ["savedReport"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "schedule reports");
    const result = await attempt(() => callWriteApi("/internal/api/report-builder/schedule", { ...who(tenant), ...args }));
    if (result.status === "done") await logMiraActivity(tenant, { actionType: "Updated", moduleName: "Reports", recordType: "report_schedule", recordLabel: args.savedReport, description: `Report schedule: ${result.schedule} (via Mira).` });
    return result;
  },
};

const favorite = {
  name: "favorite_saved_report",
  description: "Star (favorite=true) or unstar a saved report so it sits at the top of My reports.",
  parameters: { type: "object", properties: { savedReport: { type: "string" }, favorite: { type: "boolean" } }, required: ["savedReport", "favorite"] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "favorite reports");
    return attempt(() => callWriteApi("/internal/api/report-builder/favorite", { ...who(tenant), ...args }));
  },
};

const exportReport = {
  name: "export_report",
  description:
    "Make a download link for a report - a saved one (savedReport) or a design (reportType, columns, filters) - as Excel (xlsx), CSV, Word (docx), or a Managira " +
    "template (mgrt: the design only, no data, to share with other schools). The link opens only for this person while signed in and always has the latest data. " +
    "Give it as a markdown link with the row count and filters.",
  parameters: {
    type: "object",
    properties: {
      ...DEFINITION,
      savedReport: { type: "string" },
      format: { type: "string", enum: ["xlsx", "csv", "docx", "mgrt"] },
      name: { type: "string", description: "File name (defaults to the report's name)." },
      includeSchoolHeader: { type: "boolean" },
    },
    required: ["format"],
  },
  async handler(args, tenant) {
    assertIsStaff(tenant, "export reports");
    return attempt(() => callWriteApi("/internal/api/report-builder/export-link", { ...who(tenant), ...args }));
  },
};

const importTemplate = {
  name: "import_report_template",
  description:
    "Add a Managira report template (.mgrt file the user attached) to My reports. Pass the attached file's text exactly as given - never write or edit a template " +
    "yourself. It fills with this school's own data; anything the school doesn't have is left out and listed - tell the user what was left out.",
  parameters: { type: "object", properties: { template: { type: "string", description: "The attached .mgrt file's full text." } }, required: ["template"] },
  async handler(args, tenant) {
    assertIsStaff(tenant, "import report templates");
    const result = await attempt(() => callWriteApi("/internal/api/report-builder/import", { ...who(tenant), template: args.template }));
    if (result.status === "done") await logMiraActivity(tenant, { actionType: "Created", moduleName: "Reports", recordType: "saved_report", recordLabel: result.savedReport, description: `Imported the report template "${result.savedReport}" via Mira (AI assistant).` });
    return result;
  },
};

module.exports = [catalog, run, listSaved, save, remove, share, schedule, favorite, exportReport, importTemplate];
