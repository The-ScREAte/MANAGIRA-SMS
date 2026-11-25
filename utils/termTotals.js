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

const round2 = (value) => Math.round(value * 100) / 100;

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
}

module.exports = { isBlank, subjectTotals, round2 };
