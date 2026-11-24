"use strict";
// "Accept late until" and "Shuffle questions" on a test need the columns from
// database/migrations/2027-01-10_assessment_simplify.sql. Until they exist on this server's database
// everything works as before (checked again each minute, so it turns on soon after the migration runs).
const COLUMNS = [
  ["assessments", "late_until"],
  ["student_assessment_attempts", "is_late"],
  ["assessment_question_sets", "shuffle_questions"],
];
let known = false;
let lastCheck = 0;
let running = null;

function check() {
  if (running) return running;
  running = require("../config/db").query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'assessments' AND column_name = 'late_until')
          OR (table_name = 'student_assessment_attempts' AND column_name = 'is_late')
          OR (table_name = 'assessment_question_sets' AND column_name = 'shuffle_questions'))`
  )
    .then(({ rows }) => { known = Number(rows[0] && rows[0].n) === COLUMNS.length; })
    .catch(() => {})
    .finally(() => { lastCheck = Date.now(); running = null; });
  return running;
}

function ready() {
  if (!known && Date.now() - lastCheck > 60000) check();
  return known;
}
async function whenChecked() {
  // Only the very first check is waited for. A re-check runs in the background: a request that holds a
  // database connection (a transaction) must never wait for a pooled query, or enough of them at once
  // (a class handing in a test) use every connection and wait for each other.
  if (!known && Date.now() - lastCheck > 60000) { const again = check(); if (!lastCheck) await again; }
  return known;
}

// SQL: a test still takes answers until its cut-off: the later of its due date and "accept late until".
// `a` is the alias of the assessments table, with its trailing dot ("a." or "").
function stillOpenSql(a = "a.") {
  const end = ready() ? `GREATEST(${a}edit_window_end, COALESCE(${a}late_until, ${a}edit_window_end))` : `${a}edit_window_end`;
  return `(${a}edit_window_end IS NULL OR ${end} >= NOW())`;
}

// Checked once when the server starts, so the answer is known before the first page is asked for.
check();

module.exports = { ready, whenChecked, stillOpenSql };
