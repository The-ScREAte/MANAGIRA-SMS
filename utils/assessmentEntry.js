"use strict";

// How an assessment's results are recorded.
//
//   score  - a number out of "Score out of" (the usual way).
//   choice - one of the school's own choices, typed when the assessment is set
//            up: Yes / No, Pass / Fail, Complete / Incomplete, anything.
//
// A choice assessment either
//   - gives each choice points (Yes = 10, No = 0): the points are saved as the
//     score, so totals, grades, positions and report cards work exactly as for
//     a typed score ("Score out of" is the highest choice's points); or
//   - gives no points: only the choice is kept. The assessment then weighs 0%
//     with nothing to score out of, so it can never change a total anywhere;
//     the choice itself shows on the score sheet, report card and portals.
//
// Results keep the chosen label in assessment_results.choice_label (and the
// points, if any, in assessment_results.score).

const ENTRY_MODES = ["score", "choice"];
const MAX_CHOICES = 10;
const MAX_LABEL_LENGTH = 40;

const CHOICE_PRESETS = [
  { name: "Yes / No", options: [{ label: "Yes", points: 1 }, { label: "No", points: 0 }] },
  { name: "Pass / Fail", options: [{ label: "Pass", points: 1 }, { label: "Fail", points: 0 }] },
  { name: "Complete / Incomplete", options: [{ label: "Complete", points: 1 }, { label: "Incomplete", points: 0 }] },
  { name: "Met / Not met", options: [{ label: "Met", points: 1 }, { label: "Not met", points: 0 }] },
];

let ready = null;
function ensureAssessmentEntrySchema(db) {
  if (!ready) {
    ready = (async () => {
      await db.query(`
        ALTER TABLE assessments
          ADD COLUMN IF NOT EXISTS entry_mode TEXT NOT NULL DEFAULT 'score',
          ADD COLUMN IF NOT EXISTS choice_options JSONB
      `);
      await db.query("ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS choice_label TEXT");
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

const normalizeMode = (value) => (String(value || "").trim().toLowerCase() === "choice" ? "choice" : "score");
const cleanLabel = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);

function parsePoints(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n <= 999.99 ? n : NaN;
}

/**
 * Checks the choices typed for an assessment.
 * Returns { ok: true, options, countsInTotal, maxScore } or { ok: false, error }.
 * Either every choice has points or none does.
 */
function normalizeChoiceOptions(input) {
  let raw = input;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch (_) { raw = []; }
  }
  if (!Array.isArray(raw)) raw = [];
  const options = [];
  const seen = new Set();
  for (const item of raw) {
    const label = cleanLabel(item && item.label);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `The choice "${label}" is listed twice.` };
    seen.add(key);
    const points = parsePoints(item && item.points);
    if (Number.isNaN(points)) return { ok: false, error: `Points for "${label}" must be a number from 0 to 999.99.` };
    options.push({ label, points });
  }
  if (options.length < 2) return { ok: false, error: "Add at least two choices (for example Yes and No)." };
  if (options.length > MAX_CHOICES) return { ok: false, error: `Use at most ${MAX_CHOICES} choices.` };
  const withPoints = options.filter((o) => o.points !== null).length;
  if (withPoints && withPoints !== options.length) {
    return { ok: false, error: "Give every choice points, or leave the points empty for all of them." };
  }
  const countsInTotal = withPoints === options.length;
  const maxScore = countsInTotal ? Math.max(...options.map((o) => o.points)) : 0;
  if (countsInTotal && !(maxScore > 0)) {
    return { ok: false, error: "At least one choice needs more than 0 points, or leave the points empty for all of them." };
  }
  return { ok: true, options, countsInTotal, maxScore };
}

function optionsOf(assessment) {
  let raw = assessment && assessment.choice_options;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch (_) { raw = null; }
  }
  return Array.isArray(raw) ? raw.filter((o) => o && cleanLabel(o.label)) : [];
}

const isChoice = (assessment) => normalizeMode(assessment && assessment.entry_mode) === "choice" && optionsOf(assessment).length > 0;
const choiceCountsInTotal = (assessment) => isChoice(assessment) && optionsOf(assessment).every((o) => o.points !== null && o.points !== undefined);

/**
 * The choice a teacher picked (by its label, any letter case), or a number
 * that matches one choice's points (imports, Mira). Returns { label, points }
 * or null when it matches nothing.
 */
function resolveChoice(assessment, value) {
  const options = optionsOf(assessment);
  const text = cleanLabel(value).toLowerCase();
  if (!text) return null;
  const byLabel = options.find((o) => cleanLabel(o.label).toLowerCase() === text);
  if (byLabel) return { label: cleanLabel(byLabel.label), points: byLabel.points == null ? null : Number(byLabel.points) };
  const n = Number(value);
  if (Number.isFinite(n) && choiceCountsInTotal(assessment)) {
    const byPoints = options.filter((o) => Number(o.points) === n);
    if (byPoints.length === 1) return { label: cleanLabel(byPoints[0].label), points: n };
  }
  return null;
}

/**
 * An online test marked out of the assessment's score: the choice it earns is
 * the one with the most points at or below that score (choices with points
 * only). Without points there is no way to tell, so the teacher picks it.
 */
function choiceForScore(assessment, score) {
  if (!choiceCountsInTotal(assessment)) return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const sorted = optionsOf(assessment).slice().sort((a, b) => Number(a.points) - Number(b.points));
  let picked = sorted[0];
  for (const option of sorted) if (Number(option.points) <= n) picked = option;
  return picked ? { label: cleanLabel(picked.label), points: Number(picked.points) } : null;
}

// "Yes / No" style summary for lists.
const choiceSummary = (assessment) => optionsOf(assessment).map((o) => cleanLabel(o.label)).join(" / ");

module.exports = {
  ENTRY_MODES,
  CHOICE_PRESETS,
  MAX_CHOICES,
  MAX_LABEL_LENGTH,
  ensureAssessmentEntrySchema,
  normalizeMode,
  normalizeChoiceOptions,
  optionsOf,
  isChoice,
  choiceCountsInTotal,
  resolveChoice,
  choiceForScore,
  choiceSummary,
};
