"use strict";

// One rule for a subject's total, whoever adds it up (the gradebook, the report card, the merit
// sheet, the report builder): a score that was never entered is not counted. It is left out of the
// total, out of the maximum it is measured against and out of any weighting, so a student is
// measured on what they were actually scored on. A teacher who wants a zero enters 0, and 0 counts.
//
// The same rule is in SQL where totals are kept (controllers/commonController.js, saved with the
// scores and when an assessment changes) and in utils/reportBuilder.js, utils/miraRead/academics.js.

// No score entered: nothing, an empty cell, or something that isn't a number.
function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return !Number.isFinite(Number(value));
}

// Two decimals, halves up, the way a person rounds 89.995 (to 90.00) even though the machine holds
// 89.99499999999999: the digits past what a double can hold are dropped first.
const round2 = (value) => Math.round(Number((Number(value) * 100).toPrecision(12))) / 100;

// A score as a percentage of what it is out of, to two decimals (what every page shows and what
// is kept with the scores); null when there is no maximum. Grades are looked up from this number,
// so a page never shows 90.00 % beside the grade for 89.99.
const percentOf = (total, max) => (Number(max) > 0 ? round2((Number(total) / Number(max)) * 100) : null);

// items: [{ score, max, category }] for one student in one subject. Returns what was scored:
//   entered     how many scores count
//   total, max  their sum and the sum of the maximums they are out of
//   percentage  total / max * 100, or null when nothing counts or the maximum is 0
//   categories  Map category -> sum of the scores counted in it (a category with none is absent)
function subjectTotals(items) {
  let entered = 0;
  let total = 0;
  let max = 0;
  const categories = new Map();
  (items || []).forEach((item) => {
    if (!item || isBlank(item.score)) return;
    const score = Number(item.score);
    entered += 1;
    total += score;
    max += Number(item.max) || 0;
    const key = item.category === undefined ? "" : item.category;
    categories.set(key, (categories.get(key) || 0) + score);
  });
  return { entered, total, max, percentage: max > 0 ? (total / max) * 100 : null, categories };
  // percentage is the exact ratio; use percentOf(total, max) for the number that is shown and kept.
}

module.exports = { isBlank, subjectTotals, round2, percentOf };
