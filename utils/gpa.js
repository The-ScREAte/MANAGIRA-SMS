"use strict";
// GPA (feature gpa). Turned on in Report Settings › Advanced ("GPA"), it prints each student's
// GPA on report cards (the term's subjects) and transcripts (each term, and over all of
// Managira's terms). Points come from the grade letters on the standard 4.0 scale: A 4.0, B 3.0,
// C 2.0, D 1.0, F 0, a + adds 0.3 and a − takes 0.3 away (A+ stays 4.0); a grade that isn't a
// letter doesn't count. Weighted GPA: a subject can be Honors or AP/IB (Report Settings), which
// adds the school's bonus (0.5 and 1.0 unless it chose otherwise) to a passing grade.
// A GPA from the school's old system (student_source_gpas, a data migration) is kept and printed
// as it was: never worked out again.
const features = require("./shards/features");

const BASE = { A: 4, B: 3, C: 2, D: 1, E: 0, F: 0 };
const LEVELS = { honors: "Honors", ap: "AP / IB" };
const DEFAULT_SETTINGS = { honors: 0.5, ap: 1.0 };

function pointsFor(label) {
  const m = String(label || "").trim().toUpperCase().replace(/[–−]/g, "-").match(/^([A-F])\s*([+-])?$/);
  if (!m) return null;
  let points = BASE[m[1]];
  if (m[2] === "+" && points > 0 && points < 4) points += 0.3;
  if (m[2] === "-" && points > 0) points -= 0.3;
  return Math.round(points * 10) / 10;
}
const round2 = (n) => Math.round(n * 100) / 100;
const average = (list) => (list.length ? round2(list.reduce((a, b) => a + b, 0) / list.length) : null);

// The average of the grades' points (each subject counts the same), or null when none count.
const gpaOfGrades = (labels) => average((labels || []).map(pointsFor).filter((p) => p !== null));

// Unweighted and weighted together, from [{ grade, level }]: a level's bonus only on a pass.
function gpaOf(items, settings = DEFAULT_SETTINGS) {
  const scored = (items || []).map((item) => ({ points: pointsFor(item.grade), level: item.level })).filter((item) => item.points !== null);
  const bonus = (item) => (item.points > 0 && item.level === "honors" ? Number(settings.honors) : item.points > 0 && item.level === "ap" ? Number(settings.ap) : 0);
  const weightedAny = scored.some((item) => bonus(item) > 0);
  return {
    unweighted: average(scored.map((item) => item.points)),
    weighted: weightedAny ? average(scored.map((item) => item.points + bonus(item))) : null,
  };
}
const formatGpa = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(2));

const featureOn = (organizationId) => features.isOn("gpa", { organizationId: Number(organizationId) || null });
// The school prints GPA somewhere: Report Settings has it on for at least one class and term.
async function schoolShowsGpa(db, organizationId) {
  if (!featureOn(organizationId)) return false;
  const { rows } = await db.query(
    "SELECT 1 FROM report_settings WHERE organization_id = $1 AND display_settings->'sections'->>'gpa' = 'true' LIMIT 1",
    [organizationId]
  ).catch(() => ({ rows: [] }));
  return rows.length > 0;
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
// Saves the bonuses and the levels of the subjects given (of this school only).
async function saveSettings(db, organizationId, { honors, ap, levels }, actor) {
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
  return { ok: true, honors: h, ap: a, levels: entries.length };
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

module.exports = { pointsFor, gpaOfGrades, gpaOf, formatGpa, featureOn, schoolShowsGpa, weightsReady, settingsFor, levelsFor, saveSettings, sourceGpaOf, LEVELS, DEFAULT_SETTINGS, SCALE_TEXT: "A 4.0 · B 3.0 · C 2.0 · D 1.0 · F 0 (+ adds 0.3, − takes 0.3 away)" };
