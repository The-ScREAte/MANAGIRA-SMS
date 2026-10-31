const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMeritSheetData, formatMeritSheetGrade, resolveScoreBand } = require("../utils/meritSheetData");

test("merit sheet overall grade uses the configured class grade bands", () => {
  const configuredBands = [
    { from_percentage: 0, to_percentage: 69, grade_label: "D", remark: "Needs Improvement" },
    { from_percentage: 70, to_percentage: 79, grade_label: "C", remark: "Good" },
    { from_percentage: 80, to_percentage: 89, grade_label: "B", remark: "Very Good" },
    { from_percentage: 90, to_percentage: 100, grade_label: "A", remark: "Excellent" },
  ];

  assert.equal(resolveScoreBand(configuredBands, 95).grade_label, "A");
  assert.equal(resolveScoreBand(configuredBands, 84).grade_label, "B");
  assert.equal(resolveScoreBand(configuredBands, 75).grade_label, "C");
  assert.equal(resolveScoreBand(configuredBands, 60).grade_label, "D");
});

test("merit sheet grade display follows the saved grade format", () => {
  assert.equal(formatMeritSheetGrade("A1", "numbers"), "1");
  assert.equal(formatMeritSheetGrade("A", "numbers"), "A");
  assert.equal(formatMeritSheetGrade("A1", "letters"), "A1");
  assert.equal(formatMeritSheetGrade("A1", "both"), "A1");
  assert.equal(formatMeritSheetGrade("", "letters"), "-");
});

test("merit sheet output uses saved class grade bands and grade presentation", async () => {
  const db = {
    async query(sql) {
      if (/SELECT organization_name, logo_path/.test(sql)) {
        return { rows: [{ organization_name: "Test School", logo_path: null }] };
      }
      if (/SELECT use_custom_student_id/.test(sql)) {
        return { rows: [{ use_custom_student_id: false, student_id_prefix: "" }] };
      }
      if (/SELECT c\.class_name, t\.term_name, sy\.year_label/.test(sql)) {
        return { rows: [{ class_name: "Grade 3", term_name: "Term 1", year_label: "2026-2027" }] };
      }
      if (/SELECT subject_id, subject_name/.test(sql)) {
        return { rows: [{ subject_id: 7, subject_name: "Math" }] };
      }
      if (/SELECT assessment_id, subject_id, title, weight, category, max_score/.test(sql)) {
        return { rows: [{ assessment_id: 12, subject_id: 7, title: "Exam", weight: 100, max_score: 100 }] };
      }
      if (/SELECT es\.student_id, s\.custom_student_id/.test(sql)) {
        return { rows: [{ student_id: 31, custom_student_id: null, first_name: "Ava", last_name: "Student", gender: "female" }] };
      }
      if (/FROM assessment_results ar/.test(sql)) {
        return { rows: [{ student_id: 31, subject_id: 7, assessment_title: "Exam", score: 95, grade: "A1", weight: 100 }] };
      }
      if (/SELECT from_percentage, to_percentage/.test(sql)) {
        return { rows: [{ from_percentage: 90, to_percentage: 100, grade_label: "A1", remark: "Excellent" }] };
      }
      if (/SELECT display_settings/.test(sql)) {
        return { rows: [{ display_settings: { sections: { gradePresentation: { mode: "numbers" } } } }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await buildMeritSheetData(db, {
    organizationId: 146,
    classId: 87,
    termId: 235,
    subjectIds: [7],
    assessmentIds: [12],
  });

  assert.equal(result.meritSheet[0].percentage, "95.00%");
  assert.equal(result.meritSheet[0].overallGrade, "1");
  assert.equal(result.meritSheet[0].remark, "Excellent");
});
