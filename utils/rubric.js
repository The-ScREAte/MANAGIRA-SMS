"use strict";
// A rubric on a written question: a few criteria, each with its own marks. The question's marks are
// their total, and a marker gives marks per criterion. Stored in assessment_questions.rubric_json
// ({ criteria: [{ name, marks }] }); a marker's marks per criterion in student_assessment_responses.rubric_marks.
// The columns come from database/migrations/2027-01-12_assessment_rubrics.sql: until they exist
// everything works as before and the rubric option isn't offered (checked again each minute).
const MAX_CRITERIA = 10;
const MAX_NAME = 80;
const MAX_MARKS = 100;

let known = false;
let lastCheck = 0;
let running = null;
function check() {
  if (running) return running;
  running = require("../config/db").query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'assessment_questions' AND column_name = 'rubric_json')
          OR (table_name = 'student_assessment_responses' AND column_name = 'rubric_marks'))`
  )
    .then(({ rows }) => { known = Number(rows[0] && rows[0].n) === 2; })
    .catch(() => {})
    .finally(() => { lastCheck = Date.now(); running = null; });
  return running;
}
function ready() {
  if (!known && Date.now() - lastCheck > 60000) check();
  return known;
}
async function whenChecked() {
  // Only the very first check is waited for (a re-check in the background: see utils/assessmentSimple.js).
  if (!known && Date.now() - lastCheck > 60000) { const again = check(); if (!lastCheck) await again; }
  return known;
}

const round2 = (n) => Math.round(n * 100) / 100;

// What a teacher sent, made safe. Null when there is no usable rubric.
function clean(raw) {
  const list = raw && Array.isArray(raw.criteria) ? raw.criteria : Array.isArray(raw) ? raw : null;
  if (!list) return null;
  const criteria = [];
  for (const item of list.slice(0, MAX_CRITERIA)) {
    const name = String((item && item.name) == null ? "" : item.name).replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
    const marks = round2(Number(item && item.marks));
    if (!name || !Number.isFinite(marks) || marks <= 0 || marks > MAX_MARKS) continue;
    criteria.push({ name, marks });
  }
  return criteria.length ? { criteria } : null;
}

// The question's marks when it has a rubric.
function total(rubric) {
  const parsed = clean(rubric);
  return parsed ? round2(parsed.criteria.reduce((sum, c) => sum + c.marks, 0)) : 0;
}

// A marker's marks per criterion, held to each criterion's own marks. Returns { marks: [..], total }.
function score(rubric, given) {
  const parsed = clean(rubric);
  if (!parsed) return null;
  const marks = parsed.criteria.map((criterion, index) => {
    const value = Number(Array.isArray(given) ? given[index] : NaN);
    return Number.isFinite(value) ? round2(Math.max(0, Math.min(value, criterion.marks))) : 0;
  });
  return { marks, total: round2(marks.reduce((sum, n) => sum + n, 0)) };
}

check();
module.exports = { ready, whenChecked, clean, total, score, MAX_CRITERIA };
