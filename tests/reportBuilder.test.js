const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REPORTS,
  FAMILIES,
  getReport,
  splitTerms,
  normalizeColumns,
  normalizeCriteria,
  buildQueries,
} = require("../utils/reportBuilder");
const createReportBuilderController = require("../controllers/reportBuilderController");
const { createReportService, isScheduleDue, csvCell, toCsv } = createReportBuilderController._test;

const allowAll = async () => true;

test("report builder only accepts configured report columns", () => {
  const report = getReport("students");
  assert.deepEqual(
    normalizeColumns(report, ["student_name", "email", "parent_phone", "student_name", "s.email; DROP TABLE students"]),
    ["student_name", "email", "parent_phone"]
  );
  assert.deepEqual(normalizeColumns(report, ["not_a_column"]), report.defaultColumns);
  assert.equal(getReport("custom_sql"), null);
  assert.equal(getReport("constructor"), null);
});

test("fee columns and criteria need the fee permission", () => {
  const report = getReport("students");
  assert.deepEqual(normalizeColumns(report, ["student_name", "fee_balance"], new Set()), ["student_name"]);
  assert.deepEqual(normalizeColumns(report, ["student_name", "fee_balance"], new Set(["manage_paygira", "feature:fees"])), ["student_name", "fee_balance"]);
  assert.deepEqual(normalizeCriteria(report, { fees: "owing" }, new Set()).values, {});
});

test("every report has valid defaults, criteria, joins and a date criterion", () => {
  for (const [key, report] of Object.entries(REPORTS)) {
    assert.ok(report.title && report.variant, `${key} needs a title and a view label`);
    assert.ok(report.defaultColumns.every((column) => Object.hasOwn(report.columns, column)), `${key} default columns`);
    assert.ok(!report.defaultSort || Object.hasOwn(report.columns, report.defaultSort.key), `${key} default sort`);
    assert.equal(new Set(report.criteria.map((criterion) => criterion.key)).size, report.criteria.length, `${key} criteria keys`);
    assert.ok(report.criteria.some((criterion) => ["date", "term"].includes(criterion.type)), `${key} needs a date or term filter`);
    for (const item of [...Object.values(report.columns), ...report.criteria]) {
      assert.ok(!item.join || report.joins?.[item.join], `${key} join ${item.join}`);
    }
  }
});

test("every report belongs to exactly one list entry", () => {
  const views = FAMILIES.flatMap((family) => family.views);
  assert.deepEqual([...views].sort(), Object.keys(REPORTS).sort());
  assert.equal(new Set(views).size, views.length);
  assert.ok(FAMILIES.length <= 12, "the list stays short");
});

test("students cover former students and bus riders", () => {
  const report = getReport("students");
  const queries = buildQueries(report, { columns: ["student_name", "bus_route", "left_on"], criteria: { status: "left" }, organizationId: 63 });
  assert.match(queries.data.sql, /bus ON TRUE/);
  assert.match(queries.count.sql, /arch ON TRUE/);
  assert.deepEqual(normalizeColumns(report, ["student_name", "bus_route"], new Set(["manage_students"])), ["student_name"]);
  assert.deepEqual(normalizeColumns(report, ["student_name", "bus_route"], new Set(["feature:transport"])), ["student_name", "bus_route"]);
});

test("text criteria accept several names at once", () => {
  assert.deepEqual(splitTerms(" Ama, Kofi Mensah ;Ama\nYaw "), ["Ama", "Kofi Mensah", "Yaw"]);
  const report = getReport("students");
  const { count } = buildQueries(report, { columns: ["student_name"], criteria: { search: "Ama, Yaw" }, organizationId: 63 });
  assert.deepEqual(count.values, [63, "Ama%", "% Ama%", "Yaw%", "% Yaw%"]);
  const anywhere = buildQueries(report, { columns: ["student_name"], criteria: { hometown: "Accra" }, organizationId: 63 });
  assert.deepEqual(anywhere.count.values, [63, "%Accra%"]);
});

test("criteria are limited to the report's own definitions and validated", () => {
  const report = getReport("attendance");
  const result = normalizeCriteria(report, {
    search: "  Ana  ",
    class: "12abc",
    term: "42",
    unknown: "x",
    date: { from: "2025-03-01", to: "" },
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.values, { search: "Ana", term: [42], date: { from: "2025-03-01", to: "" } });
  // Class, term and list filters take one or more values.
  assert.deepEqual(normalizeCriteria(report, { class: ["3", "x", 5, "3"], status: ["Absent", ""] }).values, { class: [3, 5], status: ["Absent"] });
  assert.equal(normalizeCriteria(report, { date: { from: "2025-02-30" } }).error, "Enter dates in a valid YYYY-MM-DD format.");
  assert.equal(normalizeCriteria(report, { date: { from: "2025-04-02", to: "2025-04-01" } }).error,
    "The start date must be before the end date.");
  assert.deepEqual(normalizeCriteria(getReport("students"), { status: "1=1" }).values, {});
});

test("report SQL binds organization, criteria and class scope as values", () => {
  const report = getReport("assessment_results");
  const criteria = normalizeCriteria(report, { class: "7", term: "9", search: "Ava%' OR 1=1 --" }).values;
  const queries = buildQueries(report, {
    columns: ["student_name", "percentage"], criteria, organizationId: 63, allowedClassIds: [7, 8], limit: 50, offset: 50,
  });
  assert.match(queries.count.sql, /ar\.organization_id = \$1/);
  assert.match(queries.count.sql, /ar\.class_id = ANY\(\$2::int\[\]\)/);
  assert.match(queries.count.sql, /ar\.class_id = ANY\(\$3::int\[\]\) AND ar\.term_id = ANY\(\$4::int\[\]\)/);
  assert.deepEqual(queries.count.values, [63, [7, 8], [7], [9], "Ava%' OR 1=1 --%", "% Ava%' OR 1=1 --%"]);
  assert.match(queries.data.sql, /LIMIT \$7 OFFSET \$8/);
  assert.deepEqual(queries.data.values.slice(-2), [50, 50]);
});

test("optional joins are only added when a column or criterion needs them", () => {
  const report = getReport("students");
  const plain = buildQueries(report, { columns: ["student_name"], organizationId: 63 });
  assert.doesNotMatch(plain.data.sql, /parent ON TRUE|att ON TRUE|fees ON TRUE/);
  const withParent = buildQueries(report, { columns: ["student_name", "parent_phone"], criteria: { absences: "any" }, organizationId: 63 });
  assert.match(withParent.data.sql, /parent ON TRUE/);
  assert.match(withParent.data.sql, /att ON TRUE/);
  assert.match(withParent.count.sql, /att ON TRUE/);
  assert.doesNotMatch(withParent.count.sql, /parent ON TRUE/);
});

test("grouped attendance reports filter dates inside the rollup", () => {
  const queries = buildQueries(getReport("class_attendance"), {
    columns: ["date", "present"], criteria: { date: { from: "2026-01-01", to: "2026-01-31" } }, organizationId: 63,
  });
  assert.match(queries.count.sql, /WHERE date >= \$2::date AND date < \(\$3::date \+ 1\)\s+GROUP BY/);
  assert.deepEqual(queries.count.values, [63, "2026-01-01", "2026-01-31"]);
});

test("sorting only uses selected columns", () => {
  const report = getReport("activity_log");
  const query = (sort) => buildQueries(report, { columns: ["created_at", "user_name"], organizationId: 63, sort }).sort;
  assert.deepEqual(query(), { key: "created_at", dir: "desc" });
  assert.deepEqual(query({ key: "user_name", dir: "asc" }), { key: "user_name", dir: "asc" });
  assert.deepEqual(query({ key: "l.user_name; --", dir: "asc" }), { key: "created_at", dir: "desc" });
});

test("class-limited staff get no rows without classes, and school-wide reports stay closed", () => {
  assert.match(buildQueries(getReport("students"), { columns: ["student_name"], organizationId: 63, allowedClassIds: [] }).count.sql, /1 = 0/);
  assert.match(buildQueries(getReport("activity_log"), { columns: ["user_name"], organizationId: 63, allowedClassIds: [5] }).count.sql, /1 = 0/);
});

test("page lists only the reports a role may run, grouped", async () => {
  const db = { async query() { return { rows: [] }; } };
  const render = async (session, hasPermission) => {
    const controller = createReportBuilderController(db, { hasPermission });
    const response = {
      locals: { isEmbeddedFrame: true },
      status(code) { this.statusCode = code; return this; },
      send(value) { this.body = value; return this; },
      render(view, locals) { this.view = view; this.rendered = locals; return this; },
    };
    await controller.page({ session, query: { type: "activity_log" } }, response);
    return response;
  };

  const admin = await render({ organizationId: 63, userId: 1, userRole: "admin" }, allowAll);
  assert.equal(admin.view, "common/reportBuilder");
  const adminKeys = admin.rendered.reportTypes.map(({ key }) => key);
  assert.ok(adminKeys.includes("activity_log"));
  assert.ok(admin.rendered.families.some((family) => family.key === "attendance" && family.views.length === 3));
  assert.ok(!adminKeys.includes("fee_balances"), "fee reports need the school to use fees");
  assert.equal(admin.rendered.initialType, "activity_log");

  const teacher = await render({ organizationId: 63, userId: 5, userRole: "Teacher" },
    async (_db, _identity, key) => key === "mark_attendance" || key === "manage_reports");
  const teacherKeys = teacher.rendered.reportTypes.map(({ key }) => key);
  assert.ok(teacherKeys.includes("attendance"));
  assert.ok(!teacherKeys.includes("activity_log"), "teachers do not see school-wide reports");
  assert.ok(!teacherKeys.includes("students"), "teachers need the student permission");
  assert.equal(teacher.rendered.initialType, "");
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
  const controller = createReportBuilderController(db, { hasPermission: allowAll });
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await controller.run({
    session: { organizationId: 63, userId: 808, userRole: "Teacher" },
    body: { reportType: "students", columns: ["student_name"], criteria: {}, page: 1 },
  }, response);

  assert.equal(response.body.success, true);
  assert.equal(response.body.rows[0].student_name, "Ava Student");
  const countQuery = queries.find(({ sql }) => sql.includes("COUNT(*)::int AS total"));
  assert.match(countQuery.sql, /s\.class_id = ANY\(\$2::int\[\]\)/);
  assert.deepEqual(countQuery.values, [63, [12]]);
});

test("saved reports are limited to their owner or people they are shared with", async () => {
  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [] };
    },
  };
  const controller = createReportBuilderController(db, { hasPermission: allowAll });
  const makeResponse = () => ({
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  });
  const req = { session: { organizationId: 99, userId: 4, userRole: "Teacher" }, params: { reportId: "123" }, body: {} };
  for (const action of ["loadSaved", "deleteSaved", "update", "sharing", "updateShares", "updateSchedule", "favorite"]) {
    const response = makeResponse();
    await controller[action](req, response);
    assert.equal(response.statusCode, 404, action);
  }
  const loadQuery = queries.find(({ sql }) => sql.includes("FROM custom_report_definitions r") && sql.includes("custom_report_shares"));
  assert.match(loadQuery.sql, /r\.organization_id = \$2/);
  assert.match(loadQuery.sql, /r\.created_by = \$3/);
  const deleteQuery = queries.find(({ sql }) => sql.includes("DELETE FROM custom_report_definitions"));
  assert.match(deleteQuery.sql, /created_by = \$3/);
  assert.deepEqual(deleteQuery.values, [123, 99, 4]);
});

test("schedules are due once a day from 7 AM school time", () => {
  const monday8am = new Date("2026-11-02T08:00:00Z");
  assert.equal(isScheduleDue({ frequency: "daily", last_sent_on: null }, monday8am, "UTC"), true);
  assert.equal(isScheduleDue({ frequency: "daily", last_sent_on: "2026-11-02" }, monday8am, "UTC"), false);
  assert.equal(isScheduleDue({ frequency: "daily", last_sent_on: null }, new Date("2026-11-02T06:00:00Z"), "UTC"), false);
  assert.equal(isScheduleDue({ frequency: "weekly", weekday: 1, last_sent_on: "2026-10-26" }, monday8am, "UTC"), true);
  assert.equal(isScheduleDue({ frequency: "weekly", weekday: 2, last_sent_on: null }, monday8am, "UTC"), false);
  assert.equal(isScheduleDue({ frequency: "weekly", weekdays: [1, 3, 5], last_sent_on: null }, monday8am, "UTC"), true);
  assert.equal(isScheduleDue({ frequency: "weekly", weekdays: [2, 4], last_sent_on: null }, monday8am, "UTC"), false);
  assert.equal(isScheduleDue({ frequency: "monthly", month_day: 31, last_sent_on: null }, new Date("2026-11-30T09:00:00Z"), "UTC"), true);
  // 08:00 UTC is 01:00 in Denver: not yet due there.
  assert.equal(isScheduleDue({ frequency: "daily", last_sent_on: null }, monday8am, "America/Denver"), false);
});

test("CSV output quotes values and neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell('A "quote"'), '"A ""quote"""');
  assert.equal(csvCell("=HYPERLINK(\"bad\")"), `"'=HYPERLINK(""bad"")"`);
  assert.equal(
    toCsv([{ student_name: "Doe, Jane", email: null }], ["student_name", "email"], getReport("students")),
    '﻿"Student name","Email"\r\n"Doe, Jane",""'
  );
});

test("report service exposes access checks for scheduled sends", () => {
  const service = createReportService({ query: async () => ({ rows: [] }) }, { hasPermission: allowAll });
  assert.equal(typeof service.getContext, "function");
  assert.equal(typeof service.loadData, "function");
});

test("export header choices are stored as plain yes/no flags", () => {
  const { normalizeBranding, hasBranding, imageInfo } = require("../utils/reportBranding");
  assert.deepEqual(normalizeBranding({ orgName: true, logo: "yes", phone: true, extra: true }),
    { orgName: true, logo: false, address: false, phone: true, date: false });
  assert.equal(hasBranding(normalizeBranding({})), false);
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(120, 16);
  png.writeUInt32BE(60, 20);
  assert.deepEqual(imageInfo(png), { extension: "png", width: 120, height: 60 });
  assert.equal(imageInfo(Buffer.from("<svg></svg>")), null);
});

test("Excel export puts the school header above the table", async () => {
  const ExcelJS = require("exceljs");
  const { toWorkbook } = createReportBuilderController._test;
  const header = { orgName: "Test School", address: "1 Main St", phone: "555", date: "1 November 2026", logo: null };
  const buffer = await toWorkbook([{ student_name: "Ama" }], ["student_name"], getReport("students"), { title: "Roster", header });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("A1").value, "Test School");
  assert.equal(sheet.getCell("A4").value, "Roster");
  assert.equal(sheet.getCell("A5").value, "Generated 1 November 2026");
  assert.equal(sheet.getCell("A7").value, "Student name");
  assert.equal(sheet.getCell("A8").value, "Ama");
  const plain = new ExcelJS.Workbook();
  await plain.xlsx.load(await toWorkbook([{ student_name: "Ama" }], ["student_name"], getReport("students")));
  assert.equal(plain.worksheets[0].getCell("A1").value, "Student name");
});

test("merit sheet ranks within class and term and adds the school's own columns", async () => {
  const report = getReport("merit_ranking");
  const queries = buildQueries(report, { columns: ["position", "student_name", "overall_grade"], criteria: { class: [7], term: [9], position: "top5" }, organizationId: 63 });
  assert.match(queries.data.sql, /RANK\(\) OVER \(PARTITION BY g\.class_id, g\.term_id ORDER BY ROUND\(g\.total, 2\) DESC\)/);
  assert.match(queries.data.sql, /ar\.class_id = ANY\(\$2::int\[\]\) AND ar\.term_id = ANY\(\$3::int\[\]\)/);
  assert.match(queries.data.sql, /m\.position <= 5/);
  assert.match(queries.data.sql, /FROM score_remarks b/);
  const db = {
    async query(sql) {
      if (sql.includes("FROM subjects")) return { rows: [{ name: "Maths" }, { name: "Akan's Literature" }] };
      if (sql.includes("organization_custom_remark_types")) return { rows: [{ id: 4, type_key: "custom:head's-remark", label: "Head's remark" }] };
      return { rows: [] };
    },
  };
  const extra = await report.extend(db, 63);
  const subjectColumn = Object.values(extra.columns).find((column) => column.label === "Akan's Literature");
  assert.match(subjectColumn.expression, /->> 'Akan''s Literature'/);
  assert.equal(extra.columns.remark_4.label, "Head's remark");
  assert.match(extra.columns.remark_4.expression, /->> 'custom:head''s-remark'/);
  assert.ok(extra.criteria.some((criterion) => criterion.key === "remark_4"));
});
