const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getReport,
  normalizeColumns,
  normalizeCriteria,
  buildWhere,
  buildSelect,
} = require("../utils/reportBuilder");
const createReportBuilderController = require("../controllers/reportBuilderController");
const { validateReportInput, csvCell, toCsv } = createReportBuilderController._test;

test("report builder only accepts configured report columns", () => {
  const report = getReport("students");
  assert.deepEqual(
    normalizeColumns(report, ["student_name", "email", "parent_phone", "student_name", "s.email; DROP TABLE students"]),
    ["student_name", "email", "parent_phone"]
  );
  assert.deepEqual(
    ["student_name", "parent_name", "parent_relationship", "parent_phone", "parent_email"]
      .filter((key) => Object.hasOwn(report.columns, key)),
    ["student_name", "parent_name", "parent_relationship", "parent_phone", "parent_email"]
  );
  assert.deepEqual(normalizeColumns(report, ["not_a_column"]), report.defaultColumns);
  assert.equal(getReport("custom_sql"), null);
});

test("report criteria are normalized and invalid dates are rejected", () => {
  const criteria = normalizeCriteria({
    search: "  Ana  ",
    classId: "12abc",
    termId: "42",
    fromDate: "2025-02-30",
    toDate: "2025-03-01",
  });
  assert.equal(criteria.search, "Ana");
  assert.equal(criteria.classId, null);
  assert.equal(criteria.termId, 42);
  assert.equal(criteria.validDates, false);
  assert.equal(validateReportInput({ reportType: "attendance", criteria: { fromDate: "2025-02-30" } }).error,
    "Enter dates in a valid YYYY-MM-DD format.");
  assert.equal(validateReportInput({
    reportType: "attendance",
    criteria: { fromDate: "2025-04-02", toDate: "2025-04-01" },
  }).error, "The start date must be before the end date.");
});

test("report SQL binds organization, user criteria, and class scope as values", () => {
  const report = getReport("assessment_results");
  const criteria = normalizeCriteria({ classId: "7", termId: "9", search: "Ava%' OR 1=1 --" });
  const where = buildWhere(report, criteria, 63, [7, 8]);

  assert.match(where.sql, /ar\.organization_id = \$1/);
  assert.match(where.sql, /ar\.class_id = ANY\(\$2::int\[\]\)/);
  assert.match(where.sql, /ar\.class_id = \$3/);
  assert.match(where.sql, /ar\.term_id = \$4/);
  assert.match(where.sql, /ILIKE \$5/);
  assert.deepEqual(where.values, [63, [7, 8], 7, 9, "%Ava%' OR 1=1 --%"]);

  const selection = buildSelect(report, ["student_name", "percentage"], where, { limit: 50, offset: 50 });
  assert.match(selection.sql, /ORDER BY TRIM\(CONCAT_WS/);
  assert.match(selection.sql, /LIMIT \$6 OFFSET \$7/);
  assert.deepEqual(selection.values.slice(-2), [50, 50]);
});

test("student report joins only guardian records linked to that student and school", () => {
  const report = getReport("students");
  assert.match(report.from, /gp\.organization_id = s\.organization_id/);
  assert.match(report.from, /gs\.student_id = s\.student_id/);
  assert.match(report.from, /g\.organization_id = s\.organization_id/);
  assert.match(report.from, /g\.student_id = s\.student_id/);

  const where = buildWhere(report, normalizeCriteria({}), 63, null);
  assert.equal(where.sql, "s.organization_id = $1");
  assert.deepEqual(where.values, [63]);
});

test("report SQL returns no rows to users without assigned classes", () => {
  const report = getReport("students");
  const where = buildWhere(report, normalizeCriteria({}), 63, []);
  assert.match(where.sql, /1 = 0/);
  assert.deepEqual(where.values, [63]);
});

test("report builder page supplies configured columns and supported criteria for every report", async () => {
  const db = {
    async query(sql) {
      if (sql.includes("SELECT class_id, class_name")) return { rows: [] };
      if (sql.includes("SELECT term_id, term_name")) return { rows: [] };
      if (sql.includes("SELECT report_id, report_name")) return { rows: [] };
      return { rows: [] };
    },
  };
  const controller = createReportBuilderController(db);
  const response = {
    locals: { isEmbeddedFrame: true },
    status(code) { this.statusCode = code; return this; },
    render(view, locals) { this.view = view; this.rendered = locals; return this; },
  };

  await controller.page({ session: { organizationId: 63, userRole: "admin" } }, response);

  assert.equal(response.view, "common/reportBuilder");
  assert.equal(response.rendered.reportTypes.length, 4);
  for (const report of response.rendered.reportTypes) {
    assert.ok(report.columns.length > 0, `${report.key} should provide columns`);
    assert.ok(report.defaultColumns.length > 0, `${report.key} should provide default columns`);
    assert.ok(report.defaultColumns.every((key) => report.columns.some((column) => column.key === key)));
    assert.equal(report.hasClassFilter, true);
  }
  assert.equal(response.rendered.reportTypes.find(({ key }) => key === "students").hasTermFilter, false);
  assert.equal(response.rendered.reportTypes.find(({ key }) => key === "attendance").hasDateFilter, true);
  assert.equal(response.rendered.reportTypes.find(({ key }) => key === "assessment_results").hasTermFilter, true);
});

test("CSV output quotes values and neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell('A "quote"'), '"A ""quote"""');
  assert.equal(csvCell("=HYPERLINK(\"bad\")"), `"'=HYPERLINK(""bad"")"`);
  assert.equal(
    toCsv([{ student_name: "Doe, Jane", email: null }], ["student_name", "email"], getReport("students")),
    '\uFEFF"Student name","Email"\r\n"Doe, Jane",""'
  );
});

test("report preview scopes a teacher's rows to assigned classes and the active school", async () => {
  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("FROM user_classes")) return { rows: [{ class_id: 12 }] };
      if (sql.includes("COUNT(*)")) return { rows: [{ total: 1 }] };
      return { rows: [{ student_name: "Ava Student" }] };
    },
  };
  const controller = createReportBuilderController(db);
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await controller.run({
    session: {
      organizationId: 63,
      userId: 808,
      userRole: "Teacher",
    },
    body: {
      reportType: "students",
      columns: ["student_name"],
      criteria: {},
      page: 1,
    },
  }, response);

  assert.equal(response.statusCode, undefined);
  assert.equal(response.body.success, true);
  assert.equal(response.body.rows[0].student_name, "Ava Student");
  assert.match(queries[1].sql, /s\.organization_id = \$1/);
  assert.match(queries[1].sql, /s\.class_id = ANY\(\$2::int\[\]\)/);
  assert.deepEqual(queries[1].values, [63, [12]]);
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("saved reports cannot be loaded or deleted from another school's account", async () => {
  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("SELECT report_id, report_name")) return { rows: [] };
      return { rows: [] };
    },
  };
  const controller = createReportBuilderController(db);
  const makeResponse = () => ({
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  });
  const req = { session: { organizationId: 99 }, params: { reportId: "123" } };
  const loadResponse = makeResponse();
  await controller.loadSaved(req, loadResponse);
  const deleteResponse = makeResponse();
  await controller.deleteSaved(req, deleteResponse);

  assert.equal(loadResponse.statusCode, 404);
  assert.equal(deleteResponse.statusCode, 404);
  const loadQuery = queries.find(({ sql }) => sql.includes("SELECT report_id, report_name"));
  const deleteQuery = queries.find(({ sql }) => sql.includes("DELETE FROM custom_report_definitions"));
  assert.match(loadQuery.sql, /report_id = \$1 AND organization_id = \$2/);
  assert.deepEqual(loadQuery.values, [123, 99]);
  assert.match(deleteQuery.sql, /report_id = \$1 AND organization_id = \$2/);
  assert.deepEqual(deleteQuery.values, [123, 99]);
});
