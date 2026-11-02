const test = require("node:test");
const assert = require("node:assert/strict");

const tpl = require("../utils/reportTemplates");

// A school whose own lists differ from the one that made the template.
const fakeDb = {
  async query(sql) {
    if (/FROM classes/.test(sql)) return { rows: [{ value: 7, label: "Year 7" }] };
    if (/FROM terms/.test(sql)) return { rows: [{ value: 9, name: "Term 1", year: "2027", is_current: true }] };
    return { rows: [{ value: "Female", label: "Female" }] };
  },
};
const report = {
  title: "Merit sheet",
  variant: "Class ranking",
  columns: { student_name: { label: "Student" }, subject_ab12: { label: "Science" } },
  criteria: [
    { key: "class", label: "Class", type: "class" },
    { key: "term", label: "Term", type: "term" },
    { key: "gender", label: "Gender", type: "select", optionsSql: "SELECT" },
    { key: "position", label: "Position", type: "choice", options: [{ value: "top10", label: "Top 10" }] },
    { key: "search", label: "Student name", type: "text" },
  ],
};
const context = { organizationId: 2, allowedClassIds: null, granted: null, accessibleReports: new Map([["merit_ranking", report]]) };

test("a template keeps the design and leaves out names, ids and free text", async () => {
  const file = await tpl.buildTemplate(fakeDb, context, {
    reportType: "merit_ranking", report, columns: ["student_name", "subject_ab12"],
    criteria: { class: [7], term: [9], gender: ["Female"], position: "top10", search: "Ama" },
  }, "Top ten");
  assert.equal(file.format, tpl.FORMAT);
  assert.deepEqual(file.columns.map((c) => c.key), ["student_name", "subject_ab12"]);
  assert.deepEqual(file.filters.map((f) => f.key), ["class", "term", "gender", "position"]);
  assert.deepEqual(file.filters[0].items, [{ label: "Year 7" }]);
  assert.ok(!JSON.stringify(file).includes("Ama"));
  assert.ok(!JSON.stringify(file).includes('"7"') && !/organization/i.test(JSON.stringify(file)));
});

test("importing matches the school's own lists by name and lists what it lacks", async () => {
  const read = await tpl.readTemplate(fakeDb, context, {
    format: tpl.FORMAT, version: 1, name: "Shared", report: { type: "merit_ranking", title: "Merit sheet" },
    columns: [{ key: "student_name" }, { key: "subject_zz99", label: "science" }, { key: "subject_qq", label: "French" }],
    filters: [
      { key: "class", type: "class", items: [{ label: "year 7" }, { label: "Grade 6" }] },
      { key: "term", type: "term", items: [{ name: "Term 1", year: "2026" }] },
      { key: "position", type: "choice", value: "top10" },
      { key: "position", type: "choice", value: "drop table" },
    ],
  });
  assert.deepEqual(read.columns, ["student_name", "subject_ab12"]); // Science matched by name
  assert.deepEqual(read.criteria.class, ["7"]);
  assert.deepEqual(read.criteria.term, ["9"]); // same term name, this school's current year
  assert.equal(read.criteria.position, "top10");
  assert.ok(read.skipped.includes("Column: French"));
  assert.ok(read.skipped.some((s) => /Grade 6/.test(s)));
});

test("files that aren't templates, or reports the school can't use, are refused", async () => {
  assert.match((await tpl.readTemplate(fakeDb, context, { hello: 1 })).error, /isn't a Managira report template/);
  assert.match((await tpl.readTemplate(fakeDb, context, { format: tpl.FORMAT, version: 1, report: { type: "payments", title: "Payments" } })).error, /isn't available/);
  assert.match((await tpl.readTemplate(fakeDb, context, { format: tpl.FORMAT, version: 9, report: { type: "merit_ranking" } })).error, /newer version/);
});
