"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const css = read("public", "css", "classroomPages.css");

test("classroom pages phone rules: 12px cards, sticky drawer footers with safe areas, 16px fields", () => {
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /padding: 12px; box-sizing: border-box/);
  assert.match(css, /position: sticky; bottom: 0;[^}]*env\(safe-area-inset-bottom/);
  assert.match(css, /font-size: 16px; \}/);
  assert.match(css, /\.attendance-sheet th\.student-name[^{]*\{ position: sticky; left: 0;/);
});

test("the pages link classroomPages.css", () => {
  for (const f of [["views", "common", "attendanceCollection.ejs"], ["views", "common", "allClassAssessmentExams.ejs"], ["views", "common", "studentDetails.ejs"]]) {
    assert.ok(read(...f).includes("/css/classroomPages.css"), f.join("/"));
  }
});
