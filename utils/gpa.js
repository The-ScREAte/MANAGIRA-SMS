"use strict";
// GPA (feature gpa). Transcripts always print it (each term, and over all of Managira's finished
// terms); report cards print the term's GPA where Report Settings › Advanced ticks "GPA"; parents
// and the student see this term's and the cumulative GPA unless the class turns it off (Class
// settings › Share with › GPA, familyGpa).
//
// How it's worked out (the way US schools and registrars do it):
//  - grade points on the standard K-12 4.0 scale: A 4.0, B 3.0, C 2.0, D 1.0, F 0; a + adds 0.3 and
//    a − takes 0.3 away (A+ stays 4.0). A grade that isn't a letter (Pass, a number) doesn't count.
//  - each course counts by its credits (subjects.gpa_credits, feature gpa_credits; 1 when unset):
//    quality points = grade points × credits, GPA = quality points ÷ GPA credits.
//  - a term's GPA uses that term's courses; the cumulative GPA uses every course up to then, the
//    same way (all the quality points over all the credits), never an average of term GPAs.
//  - weighted GPA: a subject can be Honors or AP/IB (Report Settings), which adds the school's bonus
//    (0.5 and 1.0 unless it chose otherwise) to a passing grade, never to an F.
//  - worked out in whole numbers (credits in hundredths, points in hundredths) and rounded half up
//    to two decimals once, at the end, so no rounding error builds up.
// A GPA from the school's old system (student_source_gpas, a data migration) is kept and printed
// as it was: never worked out again.
const features = require("./shards/features");

const BASE = { A: 4, B: 3, C: 2, D: 1, E: 0, F: 0 };
const LEVELS = { honors: "Honors", ap: "AP / IB" };
const DEFAULT_SETTINGS = { honors: 0.5, ap: 1.0 };
const DEFAULT_CREDITS = 1;
const MAX_CREDITS = 20;

function pointsFor(label) {
  const m = String(label || "").trim().toUpperCase().replace(/[–−]/g, "-").match(/^([A-F])\s*([+-])?$/);
  if (!m) return null;
  let points = BASE[m[1]];
  if (m[2] === "+" && points > 0 && points < 4) points += 0.3;
  if (m[2] === "-" && points > 0) points -= 0.3;
  return Math.round(points * 10) / 10;
}

// Grades that aren't letters: withdrawn, audited or incomplete courses attempt no credit, and these
// earn none (failed, no pass, no credit). Any other grade that isn't a letter (Pass, a number on a
// school's own scale) is attempted and earned but has no grade points.
const NOT_ATTEMPTED = new Set(["W", "WP", "WD", "AU", "AUD", "AUDIT", "I", "INC", "IP", "NG"]);
const NOT_EARNED = new Set(["F", "E", "FAIL", "NP", "NC", "U", "WF", "UW"]);
const gradeKeyOf = (label) => String(label || "").trim().toUpperCase().replace(/[–−]/g, "-");

// A course's credits: a number from 0 to MAX_CREDITS, else the default (1).
function creditsOf(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_CREDITS;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_CREDITS ? n : DEFAULT_CREDITS;
}
const hundredths = (n) => Math.round(Number(n) * 100);
// a ÷ b, both whole numbers ≥ 0, rounded half up to a whole number (exact, no floating error).
const divideRounded = (a, b) => Math.floor((2 * a + b) / (2 * b));
// a ÷ b as a GPA with two decimals: a in quality units (credits × points, both in hundredths),
// b in hundredths of a credit.
const gpaFrom = (qualityUnits, creditUnits) => (creditUnits > 0 ? divideRounded(qualityUnits, creditUnits) / 100 : null);

// Everything a transcript prints about some courses, from [{ grade, level, credits }]:
// credits attempted and earned, GPA credits (the credits of letter-graded courses), quality points
// and the GPA, unweighted and weighted (null when no Honors or AP subject adds to a pass).
function totalsOf(items, settings = DEFAULT_SETTINGS) {
  const honors = hundredths(settings && settings.honors !== undefined ? settings.honors : DEFAULT_SETTINGS.honors);
  const ap = hundredths(settings && settings.ap !== undefined ? settings.ap : DEFAULT_SETTINGS.ap);
  let attempted = 0;
  let earned = 0;
  let gpaCredits = 0;
  let quality = 0;
  let weightedQuality = 0;
  let weightedAny = false;
  (items || []).forEach((item) => {
    const key = gradeKeyOf(item && item.grade);
    if (!key || /^[-—]+$/.test(key) || NOT_ATTEMPTED.has(key)) return; // no grade yet
    const credits = hundredths(creditsOf(item.credits));
    const points = pointsFor(key);
    attempted += credits;
    if (points === null) {
      if (!NOT_EARNED.has(key)) earned += credits;
      return;
    }
    const p = hundredths(points);
    if (p > 0) earned += credits;
    const bonus = p > 0 ? (item.level === "honors" ? honors : item.level === "ap" ? ap : 0) : 0;
    if (bonus > 0) weightedAny = true;
    gpaCredits += credits;
    quality += p * credits;
    weightedQuality += (p + bonus) * credits;
  });
  return {
    attempted: attempted / 100,
    earned: earned / 100,
    gpaCredits: gpaCredits / 100,
    qualityPoints: divideRounded(quality, 100) / 100,
    unweighted: gpaFrom(quality, gpaCredits),
    weighted: weightedAny ? gpaFrom(weightedQuality, gpaCredits) : null,
  };
}

// The GPA of some grade letters, each course counting the same, or null when none count.
const gpaOfGrades = (labels) => totalsOf((labels || []).map((grade) => ({ grade }))).unweighted;

// Unweighted and weighted together, from [{ grade, level, credits }]: a level's bonus only on a pass.
// Report Settings' GPA switch (sections.gpa): the original transcript page shows GPA only when a
// school turned it on (used while transcript_designs isn't released to the school).
async function schoolShowsGpa(db, organizationId) {
  if (!featureOn(organizationId)) return false;
  const { rows } = await db.query(
    "SELECT 1 FROM report_settings WHERE organization_id = $1 AND display_settings->'sections'->>'gpa' = 'true' LIMIT 1",
    [organizationId]
  ).catch(() => ({ rows: [] }));
  return rows.length > 0;
}

function gpaOf(items, settings = DEFAULT_SETTINGS) {
  const totals = totalsOf(items, settings);
  return { unweighted: totals.unweighted, weighted: totals.weighted };
}
const formatGpa = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(2));
// Credits as a transcript prints them: 1.00, 0.50, 2.25.
const formatCredits = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(2));

const featureOn = (organizationId) => features.isOn("gpa", { organizationId: Number(organizationId) || null });
const creditsOn = (organizationId) => featureOn(organizationId) && features.isOn("gpa_credits", { organizationId: Number(organizationId) || null });

// Each course's transcript summary in order, the way a registrar prints it: for every term (rows
// grouped by `keyOf`, in the order given), its own totals and the cumulative totals up to and
// including it; and the totals over all of them. Rows: { grade, level, credits }.
function termByTerm(rows, keyOf, settings = DEFAULT_SETTINGS) {
  const order = [];
  const byTerm = new Map();
  (rows || []).forEach((row) => {
    const key = keyOf(row);
    if (!byTerm.has(key)) { byTerm.set(key, []); order.push(key); }
    byTerm.get(key).push(row);
  });
  const terms = {};
  const sofar = [];
  order.forEach((key) => {
    sofar.push(...byTerm.get(key));
    terms[key] = { ...totalsOf(byTerm.get(key), settings), cumulative: totalsOf(sofar, settings) };
  });
  return { terms, all: totalsOf(rows, settings) };
}

// Weighted GPA's columns are there (2026-11-30_gpa_backups.sql has run).
let ready = false;
let checkedAt = 0;
async function weightsReady(db) {
  if (ready || Date.now() - checkedAt < 60000) return ready;
  checkedAt = Date.now();
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'subjects' AND column_name = 'gpa_level')::int
          + (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('gpa_settings', 'student_source_gpas'))::int AS n`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  ready = Number(rows[0].n) === 3;
  return ready;
}
async function settingsFor(db, organizationId) {
  if (!(await weightsReady(db))) return { ...DEFAULT_SETTINGS };
  const { rows } = await db.query("SELECT honors_bonus, ap_bonus FROM gpa_settings WHERE organization_id = $1", [organizationId]).catch(() => ({ rows: [] }));
  return rows[0] ? { honors: Number(rows[0].honors_bonus), ap: Number(rows[0].ap_bonus) } : { ...DEFAULT_SETTINGS };
}
// subject id -> level, for the subjects given (or a class's).
async function levelsFor(db, organizationId, { subjectIds = null, classId = null } = {}) {
  if (!(await weightsReady(db))) return new Map();
  const { rows } = await db.query(
    `SELECT subject_id, gpa_level FROM subjects WHERE organization_id = $1 AND gpa_level IS NOT NULL
        AND ($2::int[] IS NULL OR subject_id = ANY($2::int[])) AND ($3::int IS NULL OR class_id = $3)`,
    [organizationId, subjectIds, classId]
  );
  return new Map(rows.map((r) => [Number(r.subject_id), r.gpa_level]));
}

// Course credits' column is there (2026-12-11_subject_credits.sql has run); asked again a minute
// after a "no".
let creditsColumn = false;
let creditsCheckedAt = 0;
async function creditsReady(db) {
  if (creditsColumn || Date.now() - creditsCheckedAt < 60000) return creditsColumn;
  creditsCheckedAt = Date.now();
  const { rows } = await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'subjects' AND column_name = 'gpa_credits'"
  ).catch(() => ({ rows: [] }));
  creditsColumn = rows.length > 0;
  return creditsColumn;
}
// subject id -> credits set by the school (only those set; every other course counts 1), where the
// school has course credits (feature gpa_credits).
async function creditsFor(db, organizationId, { subjectIds = null, classId = null } = {}) {
  if (!creditsOn(organizationId) || !(await creditsReady(db))) return new Map();
  const { rows } = await db.query(
    `SELECT subject_id, gpa_credits FROM subjects WHERE organization_id = $1 AND gpa_credits IS NOT NULL
        AND ($2::int[] IS NULL OR subject_id = ANY($2::int[])) AND ($3::int IS NULL OR class_id = $3)`,
    [organizationId, subjectIds, classId]
  );
  return new Map(rows.map((r) => [Number(r.subject_id), Number(r.gpa_credits)]));
}
// Each subject's level and credits together: subject id -> { level, credits }, and whether any of
// them has credits set (a transcript then prints its credits).
async function subjectsGpaInfo(db, organizationId, subjectIds) {
  const ids = [...new Set((subjectIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return { info: new Map(), usesCredits: false };
  const [levels, credits] = await Promise.all([
    levelsFor(db, organizationId, { subjectIds: ids }),
    creditsFor(db, organizationId, { subjectIds: ids }),
  ]);
  const info = new Map(ids.map((id) => [id, { level: levels.get(id) || null, credits: credits.has(id) ? credits.get(id) : null }]));
  return { info, usesCredits: credits.size > 0 };
}

// Saves the bonuses, and the levels and credits of the subjects given (of this school only).
async function saveSettings(db, organizationId, { honors, ap, levels, credits }, actor) {
  if (!(await weightsReady(db))) return { error: "Run the GPA database update first." };
  // A bonus not given keeps what it was; one out of range (0 to 2) too.
  const current = await settingsFor(db, organizationId);
  const bonus = (value, fallback) => { if (value === undefined || value === null || value === "") return fallback; const n = Number(value); return Number.isFinite(n) && n >= 0 && n <= 2 ? Math.round(n * 100) / 100 : fallback; };
  const h = bonus(honors, current.honors);
  const a = bonus(ap, current.ap);
  await db.query(
    `INSERT INTO gpa_settings (organization_id, honors_bonus, ap_bonus, updated_by, updated_at) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (organization_id) DO UPDATE SET honors_bonus = EXCLUDED.honors_bonus, ap_bonus = EXCLUDED.ap_bonus, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [organizationId, h, a, actor]
  );
  const entries = Object.entries(levels && typeof levels === "object" ? levels : {})
    .map(([id, level]) => [Number.parseInt(id, 10), LEVELS[level] ? level : null])
    .filter(([id]) => Number.isInteger(id) && id > 0)
    .slice(0, 500);
  if (entries.length) {
    await db.query(
      `UPDATE subjects s SET gpa_level = x.level FROM unnest($2::int[], $3::text[]) AS x(id, level)
        WHERE s.subject_id = x.id AND s.organization_id = $1`,
      [organizationId, entries.map((e) => e[0]), entries.map((e) => e[1])]
    );
  }
  // Credits (feature gpa_credits): a number from 0 to MAX_CREDITS in hundredths; empty puts the
  // course back to the default (1). A value out of range is left as it was.
  let creditsSaved = 0;
  if (credits && typeof credits === "object" && creditsOn(organizationId) && (await creditsReady(db))) {
    const rows = Object.entries(credits)
      .map(([id, value]) => {
        const subjectId = Number.parseInt(id, 10);
        if (!Number.isInteger(subjectId) || subjectId <= 0) return null;
        if (value === null || value === undefined || String(value).trim() === "") return [subjectId, null];
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 && n <= MAX_CREDITS ? [subjectId, Math.round(n * 100) / 100] : null;
      })
      .filter(Boolean)
      .slice(0, 500);
    if (rows.length) {
      await db.query(
        `UPDATE subjects s SET gpa_credits = x.credits FROM unnest($2::int[], $3::numeric[]) AS x(id, credits)
          WHERE s.subject_id = x.id AND s.organization_id = $1 AND s.gpa_credits IS DISTINCT FROM x.credits`,
        [organizationId, rows.map((r) => r[0]), rows.map((r) => r[1])]
      );
      creditsSaved = rows.length;
    }
  }
  return { ok: true, honors: h, ap: a, levels: entries.length, credits: creditsSaved };
}

// A student's GPA from the old system, as it was exported.
async function sourceGpaOf(db, organizationId, studentId) {
  if (!(await weightsReady(db))) return null;
  const { rows } = await db.query(
    "SELECT source, gpa_weighted, gpa_unweighted, gpa, as_of FROM student_source_gpas WHERE organization_id = $1 AND student_id = $2 ORDER BY updated_at DESC LIMIT 1",
    [organizationId, studentId]
  ).catch(() => ({ rows: [] }));
  const row = rows[0];
  if (!row || (row.gpa_weighted === null && row.gpa_unweighted === null && row.gpa === null)) return null;
  // As exported, to print exactly.
  return { source: row.source, weighted: row.gpa_weighted, unweighted: row.gpa_unweighted, gpa: row.gpa, asOf: row.as_of };
}

// Each finished term's subjects with their percentage and grade, exactly as the transcript prints
// them. A term counts once it isn't the current one or its end date has passed. The grade is the
// class's grade range for that term (the nearest one), else A to D. With `families`, a subject with
// a score still waiting for the teacher's ✓ (the assessments flow) is left out, as on every page
// parents and students see.
async function endedTermGrades(db, organizationId, studentId, { families = false } = {}) {
  const approval = require("./assessmentApproval");
  const waiting = families ? approval.waitingSql("ar", approval.flowOn(organizationId)) : "FALSE";
  const { rows } = await db.query(
    `SELECT sub.subject_name, sub.subject_id,
            MAX(ar.total_percentage) AS total_percentage,
            MAX(
              COALESCE(
                (
                  SELECT COALESCE(NULLIF(sr.grade_label, ''),
                    CASE
                      WHEN ar.total_percentage >= 90 THEN 'A'
                      WHEN ar.total_percentage >= 80 THEN 'B'
                      WHEN ar.total_percentage >= 70 THEN 'C'
                      WHEN ar.total_percentage >= 60 THEN 'D'
                      ELSE 'F'
                    END
                  )
                  FROM score_remarks sr
                  WHERE sr.organization_id = ar.organization_id
                    AND sr.class_id = ar.class_id
                    AND sr.term_id = ar.term_id
                    AND NULLIF(TRIM(sr.grade_label), '') IS NOT NULL
                  ORDER BY
                    CASE
                      WHEN ar.total_percentage IS NULL THEN 1000000000
                      WHEN ar.total_percentage::numeric BETWEEN sr.from_percentage AND sr.to_percentage THEN 0
                      WHEN ar.total_percentage::numeric < sr.from_percentage THEN sr.from_percentage - ar.total_percentage::numeric
                      ELSE ar.total_percentage::numeric - sr.to_percentage
                    END ASC,
                    sr.from_percentage DESC
                  LIMIT 1
                ),
                CASE
                  WHEN ar.total_percentage IS NULL THEN NULL
                  WHEN ar.total_percentage >= 90 THEN 'A'
                  WHEN ar.total_percentage >= 80 THEN 'B'
                  WHEN ar.total_percentage >= 70 THEN 'C'
                  WHEN ar.total_percentage >= 60 THEN 'D'
                  ELSE 'F'
                END
              )
            ) AS grade,
            t.term_name,
            t.start_date,
            t.end_date,
            sy.year_label
       FROM assessment_results ar
       JOIN assessments a ON ar.assessment_id = a.assessment_id
       JOIN subjects sub ON a.subject_id = sub.subject_id
       JOIN terms t ON ar.term_id = t.term_id
       JOIN school_years sy ON t.school_year_id = sy.id
      WHERE ar.student_id = $1 AND ar.organization_id = $2
        AND (
          t.current = FALSE
          OR (t.end_date IS NOT NULL AND t.end_date < CURRENT_DATE)
        )
        -- a term that hasn't started yet isn't finished, whatever its "current" flag says
        AND (t.start_date IS NULL OR t.start_date <= CURRENT_DATE)
      GROUP BY sub.subject_id, sub.subject_name, t.term_name, t.start_date, t.end_date, sy.year_label
     HAVING NOT BOOL_OR(${waiting})
      ORDER BY COALESCE(t.end_date, t.start_date), t.start_date, sub.subject_name`,
    [studentId, organizationId]
  );
  return rows;
}

const shown = (g) => (g && g.unweighted !== null ? { unweighted: formatGpa(g.unweighted), weighted: g.weighted === null ? null : formatGpa(g.weighted) } : null);

// GPA for parents and the student (Class settings › Share with › GPA decides who sees it):
// this term's, from the grades the page already shows (only what families may see), and the
// cumulative over finished terms, the same as the transcript but leaving out subjects still
// waiting for the teacher's ✓. Null when there's nothing to show (no letter grades, or the
// school doesn't have GPA).
async function familyGpa(db, organizationId, studentId, { termGrades = [] } = {}) {
  if (!featureOn(organizationId)) return null;
  const [settings, ended] = await Promise.all([
    settingsFor(db, organizationId),
    endedTermGrades(db, organizationId, studentId, { families: true }),
  ]);
  const { info } = await subjectsGpaInfo(db, organizationId, [...termGrades, ...ended].map((r) => r.subject_id));
  const item = (r) => ({ grade: r.grade, ...(info.get(Number(r.subject_id)) || {}) });
  const term = shown(gpaOf(termGrades.map(item), settings));
  const counted = ended.filter((r) => pointsFor(r.grade) !== null);
  const cumulative = shown(gpaOf(ended.map(item), settings));
  if (!term && !cumulative) return null;
  const terms = new Set(counted.map(termKeyOf)).size;
  return { term, cumulative, terms };
}

// A term's key on a transcript: its school year, name and dates (the same in every place).
const termKeyOf = (r) => `${r.year_label}__${r.term_name}__${r.start_date || ""}__${r.end_date || ""}`;

// The GPA a transcript prints, from endedTermGrades' rows in their order: each term's totals with
// the cumulative totals up to it, the totals over every term, the school's bonuses, and whether
// courses carry credits (the transcript then prints them). Each row also gets what a registrar
// prints beside a course: `credits` (null where the school has no course credits), credits
// `attempted` and `earned`, and `qualityPoints` (grade points × credits; null for a grade that
// isn't a letter). `info`: subject id -> { level, credits }.
function transcriptFromRows(rows, { info = new Map(), usesCredits = false, settings = DEFAULT_SETTINGS } = {}) {
  const items = (rows || []).map((r) => {
    const own = info.get(Number(r.subject_id)) || {};
    const one = totalsOf([{ grade: r.grade, credits: own.credits }], settings);
    r.credits = usesCredits ? creditsOf(own.credits) : null;
    r.attempted = one.attempted;
    r.earned = one.earned;
    r.qualityPoints = one.gpaCredits > 0 ? one.qualityPoints : null;
    return { ...r, level: own.level || null, credits: own.credits };
  });
  return { ...termByTerm(items, termKeyOf, settings), settings, usesCredits };
}
async function transcriptGpa(db, organizationId, rows) {
  const [settings, { info, usesCredits }] = await Promise.all([
    settingsFor(db, organizationId),
    subjectsGpaInfo(db, organizationId, (rows || []).map((r) => r.subject_id)),
  ]);
  return transcriptFromRows(rows, { info, usesCredits, settings });
}

const SCALE = [["A+", 4.0], ["A", 4.0], ["A−", 3.7], ["B+", 3.3], ["B", 3.0], ["B−", 2.7], ["C+", 2.3], ["C", 2.0], ["C−", 1.7], ["D+", 1.3], ["D", 1.0], ["D−", 0.7], ["F", 0.0]];
const SCALE_TEXT = "A 4.0 · B 3.0 · C 2.0 · D 1.0 · F 0 (+ adds 0.3, − takes 0.3 away)";

module.exports = {
  schoolShowsGpa,
  pointsFor, gpaOfGrades, gpaOf, totalsOf, termByTerm, creditsOf, formatGpa, formatCredits, featureOn, creditsOn,
  weightsReady, creditsReady, settingsFor, levelsFor, creditsFor, subjectsGpaInfo, saveSettings, sourceGpaOf,
  endedTermGrades, familyGpa, transcriptGpa, transcriptFromRows, termKeyOf, LEVELS, DEFAULT_SETTINGS, DEFAULT_CREDITS, MAX_CREDITS, SCALE, SCALE_TEXT,
};
