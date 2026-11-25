const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isBlank, subjectTotals } = require("../utils/termTotals");
const { calculateUniformSubjectScores } = require("../utils/uniformSubjectScaling");
const { buildMeritSheetData } = require("../utils/meritSheetData");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

// One student's sample: Quiz 8/10, Midterm 30/50, Exam never entered (out of 100).
const sample = [
  { id: 1, score: 8, max: 10, weight: 20, category: "Class Assessment" },
  { id: 2, score: 30, max: 50, weight: 30, category: "Class Assessment" },
  { id: 3, score: null, max: 100, weight: 50, category: "Exams Assessment" },
];

test("a blank is not counted, a 0 that was entered is", () => {
  assert.equal(isBlank(null), true);
  assert.equal(isBlank(undefined), true);
  assert.equal(isBlank(""), true);
  assert.equal(isBlank("  "), true);
  assert.equal(isBlank(0), false);
  assert.equal(isBlank("0"), false);
  assert.equal(isBlank("12.5"), false);

  const blank = subjectTotals(sample);
  assert.equal(blank.entered, 2);
  assert.equal(blank.total, 38);
  assert.equal(blank.max, 60);
  assert.ok(Math.abs(blank.percentage - (38 / 60) * 100) < 1e-9);
  assert.equal(blank.categories.has("Exams Assessment"), false);

  const zero = subjectTotals(sample.map((item) => (item.id === 3 ? { ...item, score: 0 } : item)));
  assert.equal(zero.entered, 3);
  assert.equal(zero.total, 38);
  assert.equal(zero.max, 160);
  assert.ok(Math.abs(zero.percentage - (38 / 160) * 100) < 1e-9);
  assert.equal(zero.categories.get("Exams Assessment"), 0);

  const none = subjectTotals([]);
  assert.deepEqual([none.entered, none.total, none.max, none.percentage], [0, 0, 0, null]);
});

test("the gradebook, the report card and the merit sheet give the same number for the same scores", async () => {
  // The gradebook (saved with the scores) and the report card add one student's items the same way.
  const gradebook = subjectTotals(sample.map((i) => ({ score: i.score, max: i.max, category: i.category })));
  const reportCard = subjectTotals(sample.map((i) => ({ score: i.score, max: i.max, category: i.category })));
  assert.equal(reportCard.total, gradebook.total);
  assert.equal(reportCard.percentage, gradebook.percentage);
  assert.equal(Math.round(gradebook.percentage * 100) / 100, 63.33);

  // The merit sheet, run on the same data (the blank is not a row in assessment_results).
  const db = {
    async query(sql) {
      if (/SELECT organization_name, logo_path/.test(sql)) return { rows: [{ organization_name: "School", logo_path: null }] };
      if (/SELECT use_custom_student_id/.test(sql)) return { rows: [{ use_custom_student_id: false, student_id_prefix: "" }] };
      if (/SELECT c\.class_name, t\.term_name, sy\.year_label/.test(sql)) return { rows: [{ class_name: "G3", term_name: "T1", year_label: "2026" }] };
      if (/SELECT subject_id, subject_name/.test(sql)) return { rows: [{ subject_id: 7, subject_name: "Math" }] };
      if (/SELECT assessment_id, subject_id, title, weight, category, max_score/.test(sql)) {
        return { rows: sample.map((i) => ({ assessment_id: i.id, subject_id: 7, title: "T" + i.id, weight: i.weight, category: i.category, max_score: i.max })) };
      }
      if (/SELECT es\.student_id, s\.custom_student_id/.test(sql)) return { rows: [{ student_id: 31, first_name: "Ava", last_name: "S", gender: "f" }] };
      if (/FROM assessment_results ar/.test(sql)) {
        return { rows: sample.filter((i) => i.score !== null).map((i) => ({ student_id: 31, subject_id: 7, assessment_title: "T" + i.id, score: i.score, grade: "B", weight: i.weight })) };
      }
      if (/SELECT from_percentage, to_percentage/.test(sql)) return { rows: [] };
      if (/SELECT display_settings/.test(sql)) return { rows: [] };
      throw new Error("Unexpected query: " + sql);
    },
  };
  const merit = await buildMeritSheetData(db, { organizationId: 1, classId: 2, termId: 3, subjectIds: [7], assessmentIds: [1, 2, 3] });
  const row = merit.meritSheet[0];
  assert.equal(row.percentage, "63.33%");
  assert.equal(row.totalScore, "38.00");
  assert.equal(row.averageScore, "38.00");
  assert.equal(row.scores[0].assessments[2].score, "-");
  assert.equal(row.scores[0].entered, 2);
});

test("weighted subjects: a blank drops from the numerator and the weights", () => {
  const forAll = (earned) => calculateUniformSubjectScores(
    sample.map((i) => ({ assessment_id: i.id, max_score: i.max, weight: i.weight, category: i.category })),
    (assessment) => (earned[assessment.assessment_id] === undefined ? null : earned[assessment.assessment_id]),
    100,
    () => "all"
  );
  // 8/10 on weight 20 and 30/50 on weight 30, the weight-50 exam left out: out of 50 weight, scaled to 100.
  const blank = forAll({ 1: 8, 2: 30 });
  assert.ok(Math.abs(blank.totalScore - ((0.8 * 20 + 0.6 * 30) / 50) * 100) < 1e-9);
  assert.equal(blank.maxScore, 100);
  // The same exam entered as 0 counts: the weight stays.
  const zero = forAll({ 1: 8, 2: 30, 3: 0 });
  assert.ok(Math.abs(zero.totalScore - (0.8 * 20 + 0.6 * 30)) < 1e-9);
  // Nothing entered: nothing counted.
  assert.deepEqual(forAll({}), { totalScore: 0, maxScore: 0, categoryScores: {} });
});

test("the report card, the gradebook and the report builder all count entered scores only", () => {
  const print = read("controllers", "printController.js");
  assert.doesNotMatch(print, /COALESCE\(ar\.score, 0\)/);
  assert.match(print, /termTotals\.subjectTotals\(getScoredItems/);
  const common = read("controllers", "commonController.js");
  assert.equal((common.match(/termTotals\.subjectTotals\(/g) || []).length, 2);
  assert.match(read("utils", "meritSheetData.js"), /termTotals\.subjectTotals/);
  const builder = read("utils", "reportBuilder.js");
  assert.match(builder, /ar\.score IS NOT NULL/);
  assert.doesNotMatch(builder, /SUM\(a3\.max_score\)/);
});

// The report builder's SQL against the shared rule, on whatever scores the database holds.
test("the report builder's subject totals match the shared rule", async (t) => {
  if (!process.env.DB_CONNECTION_STRING) return t.skip("no database");
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DB_CONNECTION_STRING, ssl: process.env.DB_SSL === "false" ? false : undefined, max: 1 });
  try {
    const { rows: pick } = await pool.query(
      "SELECT organization_id, class_id, term_id FROM assessment_results WHERE score IS NOT NULL AND class_id IS NOT NULL AND term_id IS NOT NULL GROUP BY 1, 2, 3 ORDER BY COUNT(*) DESC LIMIT 1"
    );
    if (!pick.length) return t.skip("no scores");
    const { organization_id: org, class_id: cls, term_id: term } = pick[0];
    const params = [org];
    const bind = (value) => { params.push(value); return "$" + params.length; };
    const { subjectTotalsSql } = require("../utils/reportBuilder");
    const { rows } = await pool.query(
      "SELECT ss.student_id, ss.subject_id, ss.total, ss.max_total FROM " + subjectTotalsSql(bind, { class: [cls], term: [term] }) + " ORDER BY 1, 2 LIMIT 300",
      params
    );
    const { rows: cells } = await pool.query(
      `SELECT ar.student_id, a.subject_id, a.max_score::float AS max, ar.score::float AS score
         FROM assessment_results ar JOIN assessments a ON a.assessment_id = ar.assessment_id
        WHERE ar.organization_id = $1 AND ar.class_id = $2 AND ar.term_id = $3 AND a.obsolete_at IS NULL AND COALESCE(a.entry_mode, 'score') = 'score'`,
      [org, cls, term]
    );
    const by = new Map();
    cells.forEach((c) => {
      const k = c.student_id + "|" + c.subject_id;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ score: c.score, max: c.max });
    });
    for (const row of rows) {
      const expected = subjectTotals(by.get(row.student_id + "|" + row.subject_id));
      assert.ok(Math.abs(expected.total - Number(row.total)) < 0.011, "total " + row.student_id + "/" + row.subject_id);
      assert.ok(Math.abs(expected.max - Number(row.max_total)) < 0.011, "max " + row.student_id + "/" + row.subject_id);
    }
  } finally {
    await pool.end();
  }
});
