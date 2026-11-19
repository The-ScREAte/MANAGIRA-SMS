// A student's enrollment is how class lists, report cards and promotion find them in a term, so the code
// that writes enrollments is held to a few rules that earlier bugs broke (students vanishing from classes).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
function sources() {
  const files = [];
  ["controllers", "utils", "jobs", "routes", "middleware"].forEach((dir) => {
    const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push([path.relative(ROOT, full), fs.readFileSync(full, "utf8")]);
    });
    if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
  });
  return files;
}
const all = sources();

test("an enrollment is never created without a term", () => {
  all.forEach(([file, text]) => {
    [...text.matchAll(/INSERT INTO enrollments\s*\(([^)]*)\)/gi)].forEach((m) => {
      assert.match(m[1], /term_id/, `${file}: an enrollment must name its term (${m[0].slice(0, 60)})`);
    });
  });
});

test("Edit Student never clears a student's enrollment across a whole school year", () => {
  all.forEach(([file, text]) => {
    assert.ok(!/DELETE FROM enrolled_students es\s+USING enrollments e[\s\S]{0,200}e\.school_year_id/i.test(text), `${file}: deleting a student's enrollments by school year removes their other terms`);
  });
});

test("a class change moves the student in the current term only", () => {
  const text = fs.readFileSync(path.join(ROOT, "controllers/commonController.js"), "utf8");
  assert.ok(!/SET class_id = \$1\s+FROM enrollments e\s+INNER JOIN school_years sy[\s\S]{0,200}sy\.current = TRUE/i.test(text), "a class change must not rewrite every term of the year");
  assert.ok(text.includes("moveStudentsToClassInCurrentTerm"));
});

test("the keeper only adds: it never deletes an enrollment", () => {
  const text = fs.readFileSync(path.join(ROOT, "utils/enrollmentKeeper.js"), "utf8");
  assert.ok(!/DELETE FROM/i.test(text));
});

test("the database refuses to take a student out of a term that holds their records", () => {
  const text = fs.readFileSync(path.join(ROOT, "utils/recordSafety.js"), "utf8");
  assert.match(text, /CREATE CONSTRAINT TRIGGER enrolled_students_keep_records/);
  assert.match(text, /CREATE CONSTRAINT TRIGGER enrollments_keep_records/);
});
