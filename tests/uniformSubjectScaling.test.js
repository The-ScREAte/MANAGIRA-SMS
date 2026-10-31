const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UNIFORM_SUBJECT_SCALING_TERM_ID,
  calculateUniformSubjectScores,
  normalizeUniformSubjectScaling,
} = require("../utils/uniformSubjectScaling");

test("uniform subject scaling normalizes assessments to the configured subject maximum", () => {
  const assessments = [
    { assessment_id: 1, max_score: 100, weight: 60, category: "Class Assessment" },
    { assessment_id: 2, max_score: 50, weight: 25, category: "Exams Assessment" },
  ];
  const scaled = calculateUniformSubjectScores(
    assessments,
    (assessment) => assessment.assessment_id === 1 ? 100 : 50,
    100,
    (assessment) => assessment.category === "Class Assessment" ? "class" : "exams"
  );

  assert.equal(scaled.maxScore, 100);
  assert.equal(scaled.totalScore, 100);
  assert.equal(scaled.categoryScores.class, 60 / 85 * 100);
  assert.equal(scaled.categoryScores.exams, 25 / 85 * 100);
});

test("uniform subject scaling weights partial performance and caps scores at the base", () => {
  const assessments = [
    { assessment_id: 1, max_score: 100, weight: 60, category: "Class Assessment" },
    { assessment_id: 2, max_score: 100, weight: 25, category: "Exams Assessment" },
  ];
  const scaled = calculateUniformSubjectScores(assessments, (assessment) => (
    assessment.assessment_id === 1 ? 50 : 100
  ), 50, () => "subject");

  assert.ok(Math.abs(scaled.totalScore - (((50 * 60 + 100 * 25) / 85) / 100 * 50)) < 1e-10);
  assert.equal(scaled.maxScore, 50);
  const overMaximum = calculateUniformSubjectScores(assessments, () => 150, 100, () => "subject");
  assert.equal(overMaximum.totalScore, 100);
});

test("missing assessment weights fall back to raw maximums and config defaults safely", () => {
  const scaled = calculateUniformSubjectScores(
    [{ assessment_id: 1, max_score: 40, weight: 0 }],
    () => 20,
    100,
    () => "other"
  );
  assert.equal(scaled.totalScore, 50);
  assert.deepEqual(normalizeUniformSubjectScaling({ enabled: true, baseMaxScore: 0 }), {
    enabled: true,
    baseMaxScore: 100,
    applyToClasses: [],
  });
  assert.equal(UNIFORM_SUBJECT_SCALING_TERM_ID, -3);
});
