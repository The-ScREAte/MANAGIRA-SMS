"use strict";

// The weekly briefing (feature `weekly_briefing`): one short email a week to each family about
// each of their children, and one to each student who has a student-portal login. The school
// chooses the day, the time and what goes in (Management Tools › Weekly briefing); a class can
// make its own choices (the class's Weekly briefing tab). Everything is on until the school
// turns it off.
//
// Everything in it is what the family already sees in the portal, by the same rules: grades only
// once the teacher has posted them, events the school shares with families, a driver's note only
// once a lead shared it with parents, forms and daily records only where the school shows them
// to families. A section with nothing to say is left out, a child with nothing to report is left
// out, and nobody gets an empty email.

const { BoundedMap } = require("./boundedMap");
const { activeStudentSql } = require("./activeStudents");
const { renderModernEmail, detailsBlock, escapeHtml } = require("./emailLayout");

const BASE_URL = (process.env.BASE_URL_PRODUCTION || process.env.BASE_URL || "https://managira.com").replace(/\/+$/, "");
const TABLE_MISSING = "42P01";

// What a briefing can hold. `audiences` says who may get it: payments are for parents only.
const SECTIONS = [
  { key: "attendance", label: "Attendance", hint: "Days present and absent this week.", audiences: ["parents", "students"] },
  { key: "lunch", label: "Lunch", hint: "Days the student had lunch at school this week, where the class takes lunch.", audiences: ["parents", "students"] },
  { key: "grades", label: "New grades", hint: "Grades teachers posted this week, as the portal shows them.", audiences: ["parents", "students"] },
  { key: "bus", label: "Bus", hint: "For students who ride a bus: their route, pickup time and this week's rides.", audiences: ["parents", "students"] },
  { key: "records", label: "Daily class records", hint: "The school's own daily class forms that it shows to families.", audiences: ["parents", "students"] },
  { key: "forms", label: "Forms to fill in", hint: "School forms still waiting for an answer.", audiences: ["parents", "students"] },
  { key: "payments", label: "Payments", hint: "Unpaid bills, and repeating charges such as lunch.", audiences: ["parents"] },
  { key: "tests", label: "Tests coming up", hint: "Online tests that open in the next seven days.", audiences: ["parents", "students"] },
  { key: "activities", label: "Class activities", hint: "Class activities in the next seven days.", audiences: ["parents", "students"] },
  { key: "events", label: "School events", hint: "School events in the next seven days that are shared with families.", audiences: ["parents", "students"] },
];
const SECTION_KEYS = SECTIONS.map((section) => section.key);
const AUDIENCES = ["parents", "students"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// US time zones first; any other valid zone a school already uses is kept.
const TIME_ZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
];
const DEFAULT_SCHEDULE = { day: 5, hour: 16, timeZone: "America/New_York" };
const MAX_LINES = 5;

// ── Settings ───────────────────────────────────────────────────────────────────────────────

const validZone = (zone) => {
  try {
    return Boolean(zone) && new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone === zone;
  } catch (_) {
    return false;
  }
};

const truthy = (value) => value === true || value === "on" || value === "true" || value === "1" || value === 1;

// Every section on unless it was turned off, so a new section starts on for everyone.
function normalizeAudience(raw, audience) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sections = {};
  for (const section of SECTIONS) {
    if (!section.audiences.includes(audience)) continue;
    sections[section.key] = source.sections && Object.hasOwn(source.sections, section.key) ? source.sections[section.key] !== false : true;
  }
  return { on: source.on !== false, sections };
}

function normalizeSchedule(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const day = Number.parseInt(source.day, 10);
  const hour = Number.parseInt(source.hour, 10);
  return {
    day: day >= 0 && day <= 6 ? day : DEFAULT_SCHEDULE.day,
    hour: hour >= 0 && hour <= 23 ? hour : DEFAULT_SCHEDULE.hour,
    timeZone: validZone(source.timeZone) ? source.timeZone : DEFAULT_SCHEDULE.timeZone,
  };
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    parents: normalizeAudience(source.parents, "parents"),
    students: normalizeAudience(source.students, "students"),
  };
}

// A settings form (the school's page or a class's): checkboxes named `parents_on`,
// `parents_<section>`, `students_on`, `students_<section>`.
function settingsFromForm(body = {}) {
  const read = (audience) => {
    const sections = {};
    for (const section of SECTIONS) {
      if (section.audiences.includes(audience)) sections[section.key] = truthy(body[`${audience}_${section.key}`]);
    }
    return { on: truthy(body[`${audience}_on`]), sections };
  };
  return { parents: read("parents"), students: read("students") };
}

const settingsCache = new BoundedMap(500); // organization id -> { at, value }
const SETTINGS_TTL_MS = 60 * 1000;

// A school's choices: { school, schedule, classes: Map(classId -> settings) }.
async function settingsFor(db, organizationId, { fresh = false } = {}) {
  const key = Number(organizationId);
  const hit = settingsCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;
  let rows = [];
  try {
    ({ rows } = await db.query(
      `SELECT class_id, settings, updated_by_name, updated_at FROM weekly_briefing_settings WHERE organization_id = $1`,
      [key]
    ));
  } catch (error) {
    if (error.code !== TABLE_MISSING) throw error;
  }
  const schoolRow = rows.find((row) => Number(row.class_id) === 0);
  const value = {
    ready: true,
    school: normalizeSettings(schoolRow?.settings),
    schedule: normalizeSchedule(schoolRow?.settings?.schedule),
    savedBy: schoolRow ? { name: schoolRow.updated_by_name || "", at: schoolRow.updated_at } : null,
    classes: new Map(rows
      .filter((row) => Number(row.class_id) > 0)
      .map((row) => [Number(row.class_id), { ...normalizeSettings(row.settings), savedBy: { name: row.updated_by_name || "", at: row.updated_at } }])),
  };
  settingsCache.set(key, { at: Date.now(), value });
  return value;
}

const forget = (organizationId) => settingsCache.delete(Number(organizationId));

// The choices that apply to a class: its own, or the school's.
function settingsForClass(all, classId) {
  return all.classes.get(Number(classId)) || all.school;
}

async function saveSchoolSettings(db, organizationId, body, actor = {}) {
  const settings = { ...settingsFromForm(body), schedule: normalizeSchedule({ day: body.day, hour: body.hour, timeZone: body.timeZone }) };
  await db.query(
    `INSERT INTO weekly_briefing_settings (organization_id, class_id, settings, updated_by, updated_by_name, updated_at)
     VALUES ($1, 0, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (organization_id, class_id) DO UPDATE
       SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
    [organizationId, JSON.stringify(settings), actor.id || null, actor.name || null]
  );
  forget(organizationId);
  return settings;
}

// A class either follows the school ("school") or keeps its own choices ("own").
async function saveClassSettings(db, organizationId, classId, body, actor = {}) {
  if (String(body.mode || "") !== "own") {
    await db.query(`DELETE FROM weekly_briefing_settings WHERE organization_id = $1 AND class_id = $2`, [organizationId, classId]);
    forget(organizationId);
    return null;
  }
  const settings = settingsFromForm(body);
  await db.query(
    `INSERT INTO weekly_briefing_settings (organization_id, class_id, settings, updated_by, updated_by_name, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
     ON CONFLICT (organization_id, class_id) DO UPDATE
       SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
    [organizationId, classId, JSON.stringify(settings), actor.id || null, actor.name || null]
  );
  forget(organizationId);
  return settings;
}

// ── Dates in the school's time zone ──────────────────────────────────────────────────────

function zoned(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
  };
}

function addDays(key, days) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const dayLabel = (key, options = { weekday: "short", month: "short", day: "numeric" }) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" }).replace(/([A-Z][a-z]{2}) (\d)/g, `$1${"\u00a0"}$2`);

function rangeLabel(from, to, long = false) {
  const month = long ? "long" : "short";
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const left = a.toLocaleDateString("en-US", { month, day: "numeric", timeZone: "UTC" });
  const right = sameMonth
    ? String(b.getUTCDate())
    : b.toLocaleDateString("en-US", { month, day: "numeric", timeZone: "UTC" });
  return `${left}–${right}`;
}

// The week behind (the seven days ending today) and the week ahead (the seven days after).
function windowsFor(now, timeZone) {
  const today = zoned(now, timeZone).key;
  return {
    today,
    timeZone,
    past: { from: addDays(today, -6), to: today },
    next: { from: addDays(today, 1), to: addDays(today, 7) },
  };
}

const NBSP = "\u00a0";
const together = (text) => String(text).replace(/\s+/g, NBSP);

function timeLabel(value) {
  if (!value) return "";
  const [h, m] = String(value).split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return together(new Date(Date.UTC(2000, 0, 1, h, m || 0)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }));
}

const hourLabel = (hour) => timeLabel(`${hour}:00`);
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const trimNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? String(Number(number.toFixed(2))) : "";
};

// ── What happened, per student ──────────────────────────────────────────────────────────

const safe = (promise, fallback) => promise.catch((error) => {
  if (error && (error.code === TABLE_MISSING || error.code === "42703")) return fallback;
  throw error;
});

async function attendanceFor(db, organizationId, studentIds, past) {
  const { rows } = await safe(db.query(
    `SELECT student_id, COUNT(*)::int AS days, COUNT(*) FILTER (WHERE present)::int AS present,
            ARRAY_AGG(to_char(day, 'YYYY-MM-DD') ORDER BY day) FILTER (WHERE NOT present) AS absent_days
       FROM (SELECT student_id, date AS day, BOOL_OR(status::text = 'Present') AS present
               FROM attendance_records
              WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND date BETWEEN $3::date AND $4::date
              GROUP BY student_id, date) d
      GROUP BY student_id`,
    [organizationId, studentIds, past.from, past.to]
  ), { rows: [] });
  return new Map(rows.map((row) => [Number(row.student_id), row]));
}

// Lunch taken on the class attendance page (class_lunch): days with lunch out of the days marked.
async function lunchFor(db, organizationId, studentIds, past) {
  const { rows } = await safe(db.query(
    `SELECT student_id, COUNT(*)::int AS days, COUNT(*) FILTER (WHERE had_lunch)::int AS had
       FROM class_lunch
      WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND lunch_date BETWEEN $3::date AND $4::date
      GROUP BY student_id`,
    [organizationId, studentIds, past.from, past.to]
  ), { rows: [] });
  return new Map(rows.map((row) => [Number(row.student_id), row]));
}

// Class settings › Share with: what each student's class shares with parents and with students
// (attendance, lunch, bus & transport). Without the feature, everything is shared.
async function sharingFor(db, organizationId, studentIds) {
  try {
    const classSettings = require("./classSettings");
    const [parents, students] = await Promise.all([
      classSettings.parentsSeeFor(db, organizationId, studentIds),
      classSettings.studentsSeeFor(db, organizationId, studentIds),
    ]);
    return { parents, students };
  } catch (_) {
    return { parents: new Map(), students: new Map() };
  }
}

async function gradesFor(db, organizationId, studentIds, past, timeZone) {
  const approval = require("./assessmentApproval");
  // Whether this database has the assessments flow is read once per process: wait for it.
  await approval.whenColumnsChecked().catch(() => {});
  if (!approval.flowOn(organizationId)) return new Map();
  // Posted this week: approved in the window and not changed since (what the portal shows now).
  const { rows } = await safe(db.query(
    `SELECT ar.student_id, a.title, s.subject_name, ar.score, ar.choice_label, a.max_score
       FROM assessment_results ar
       JOIN assessments a ON a.assessment_id = ar.assessment_id AND a.organization_id = ar.organization_id
       LEFT JOIN subjects s ON s.subject_id = a.subject_id
      WHERE ar.organization_id = $1 AND ar.student_id = ANY($2::int[])
        AND ar.pending_since IS NULL AND ar.approved_at IS NOT NULL
        AND ar.approved_at >= ($3::date::timestamp AT TIME ZONE $5)
        AND ar.approved_at < (($4::date + 1)::timestamp AT TIME ZONE $5)
        AND COALESCE(a.is_active, TRUE) = TRUE AND a.obsolete_at IS NULL
        AND (ar.score IS NOT NULL OR NULLIF(TRIM(ar.choice_label), '') IS NOT NULL)
      ORDER BY ar.approved_at, a.title`,
    [organizationId, studentIds, past.from, past.to, timeZone]
  ), { rows: [] });
  const out = new Map();
  for (const row of rows) {
    const grade = row.choice_label && String(row.choice_label).trim()
      ? String(row.choice_label).trim()
      : `${trimNumber(row.score)}${Number(row.max_score) > 0 ? `${NBSP}/${NBSP}${trimNumber(row.max_score)}` : ""}`;
    const list = out.get(Number(row.student_id)) || [];
    list.push({ title: row.title, subject: row.subject_name || "", grade });
    out.set(Number(row.student_id), list);
  }
  return out;
}

async function testsFor(db, organizationId, students, next) {
  const classIds = [...new Set(students.map((student) => student.classId).filter(Boolean))];
  if (!classIds.length) return new Map();
  // Online tests ready to open (approved questions), as the student's notifications show them.
  const { rows } = await safe(db.query(
    `SELECT a.assessment_id, a.title, a.class_id, a.subject_id, s.subject_name, to_char(a.edit_window_start, 'YYYY-MM-DD') AS opens
       FROM assessments a
       JOIN subjects s ON s.subject_id = a.subject_id AND s.organization_id = a.organization_id
      WHERE a.organization_id = $1 AND a.class_id = ANY($2::int[])
        AND COALESCE(a.is_active, TRUE) = TRUE AND a.obsolete_at IS NULL
        AND a.edit_window_start >= $3::date AND a.edit_window_start < ($4::date + 1)
        AND EXISTS (SELECT 1 FROM assessment_question_sets qs
                     WHERE qs.organization_id = $1 AND qs.assessment_id = a.assessment_id AND qs.retake_student_id IS NULL
                       AND LOWER(COALESCE(qs.review_status, 'pending')) = 'approved' AND COALESCE(qs.is_active, TRUE))
      ORDER BY a.edit_window_start, a.title`,
    [organizationId, classIds, next.from, next.to]
  ), { rows: [] });
  if (!rows.length) return new Map();
  const takes = await safe(db.query(
    `SELECT student_id, subject_id FROM student_subjects WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND subject_id = ANY($3::int[])`,
    [organizationId, students.map((student) => student.id), [...new Set(rows.map((row) => Number(row.subject_id)))]]
  ), { rows: [] });
  const taking = new Set(takes.rows.map((row) => `${row.student_id}:${row.subject_id}`));
  const out = new Map();
  for (const student of students) {
    const list = rows
      .filter((row) => Number(row.class_id) === Number(student.classId) && taking.has(`${student.id}:${row.subject_id}`))
      .map((row) => ({ title: row.title, subject: row.subject_name || "", opens: row.opens }));
    if (list.length) out.set(student.id, list);
  }
  return out;
}

async function activitiesFor(db, organizationId, students, next) {
  const { listActivities } = require("./classActivities");
  const classIds = [...new Set(students.map((student) => student.classId).filter(Boolean))];
  const rows = await listActivities(db, organizationId, {
    classIds, studentIds: students.map((student) => student.id), from: next.from, to: addDays(next.to, 1),
  }).catch(() => []);
  const out = new Map();
  for (const student of students) {
    const list = rows.filter((row) => (row.studentId
      ? row.studentId === student.id
      : row.classId === null || row.classId === Number(student.classId)));
    if (list.length) out.set(student.id, list);
  }
  return out;
}

async function eventsFor(db, organizationId, next) {
  // The events families see on their calendar (utils/familyCalendar.js).
  const { rows } = await safe(db.query(
    `SELECT name, to_char(event_date, 'YYYY-MM-DD') AS day, to_char(end_date, 'YYYY-MM-DD') AS end_day, start_time, all_day
       FROM school_events
      WHERE organization_id = $1 AND visibility IN ('public', 'both') AND event_date IS NOT NULL
        AND event_date <= $3::date AND COALESCE(end_date, event_date) >= $2::date
      ORDER BY event_date, start_time NULLS FIRST, name`,
    [organizationId, next.from, next.to]
  ), { rows: [] });
  return rows;
}

async function busFor(db, organizationId, studentIds, past, timeZone) {
  const switches = require("./integrationSwitches");
  if (!(await switches.isOn(db, organizationId, "transportation").catch(() => false))) return new Map();
  const [assignments, rides, notRiding, notes] = await Promise.all([
    safe(db.query(
      `SELECT DISTINCT ON (tsa.student_id) tsa.student_id, r.route_name, st.stop_name,
              COALESCE(tsa.pickup_time, st.pickup_time) AS pickup_time
         FROM transport_student_assignments tsa
         LEFT JOIN transport_routes r ON r.route_id = tsa.route_id AND r.organization_id = tsa.organization_id
         LEFT JOIN transport_stops st ON st.stop_id = tsa.stop_id AND st.organization_id = tsa.organization_id
        WHERE tsa.organization_id = $1 AND tsa.student_id = ANY($2::int[]) AND COALESCE(tsa.active, TRUE) = TRUE
        ORDER BY tsa.student_id, tsa.updated_at DESC NULLS LAST`,
      [organizationId, studentIds]
    ), { rows: [] }),
    safe(db.query(
      `SELECT ta.student_id, COUNT(DISTINCT ta.trip_id) FILTER (WHERE ta.arrived)::int AS rides
         FROM transport_trip_arrivals ta
         JOIN transport_trip_sessions t ON t.trip_id = ta.trip_id AND t.organization_id = ta.organization_id
        WHERE ta.organization_id = $1 AND ta.student_id = ANY($2::int[])
          AND t.started_at >= ($3::date::timestamp AT TIME ZONE $5) AND t.started_at < (($4::date + 1)::timestamp AT TIME ZONE $5)
        GROUP BY ta.student_id`,
      [organizationId, studentIds, past.from, past.to, timeZone]
    ), { rows: [] }),
    safe(db.query(
      `SELECT student_id, ARRAY_AGG(DISTINCT to_char(ride_date, 'YYYY-MM-DD')) AS days
         FROM transport_not_riding
        WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND ride_date BETWEEN $3::date AND $4::date
        GROUP BY student_id`,
      [organizationId, studentIds, past.from, past.to]
    ), { rows: [] }),
    // A driver's note reaches a family only once a lead shared it with parents.
    safe(db.query(
      `SELECT student_id, COUNT(*)::int AS notes
         FROM transport_driver_reports
        WHERE organization_id = $1 AND student_id = ANY($2::int[]) AND share_with_parents = TRUE
          AND created_at >= ($3::date::timestamp AT TIME ZONE $5) AND created_at < (($4::date + 1)::timestamp AT TIME ZONE $5)
        GROUP BY student_id`,
      [organizationId, studentIds, past.from, past.to, timeZone]
    ), { rows: [] }),
  ]);
  const byStudent = (result) => new Map(result.rows.map((row) => [Number(row.student_id), row]));
  const rideMap = byStudent(rides);
  const skipMap = byStudent(notRiding);
  const noteMap = byStudent(notes);
  const out = new Map();
  for (const row of assignments.rows) {
    const id = Number(row.student_id);
    out.set(id, {
      route: row.route_name || "",
      stop: row.stop_name || "",
      pickup: timeLabel(row.pickup_time),
      rides: Number(rideMap.get(id)?.rides || 0),
      notRiding: (skipMap.get(id)?.days || []).sort(),
      notes: Number(noteMap.get(id)?.notes || 0),
    });
  }
  return out;
}

// Forms waiting for this family (or this student), and the school's daily class records shown
// to them (a lunch count), summed up for the week.
async function formsAndRecordsFor(db, organizationId, students, past, audience) {
  const forms = require("./customForms");
  const out = { forms: new Map(), records: new Map() };
  if (!(await forms.ready(db).catch(() => false))) return out;
  const portal = audience === "parents" ? "parent" : "student";
  const live = await forms.liveFor(db, organizationId, portal).catch(() => []);
  if (!live.length) return out;
  const records = live.filter((section) => section.filledBy === "staff" && section.repeat === "day" && !section.protected);
  // Forms still to fill in, for every student in one read.
  const todo = await forms.toDoMany(db, organizationId, students, portal, { day: past.to }).catch(() => new Map());
  for (const [studentId, list] of todo) {
    out.forms.set(studentId, list.map((form) => ({ name: form.name, due: form.dueDate, required: form.required })));
  }
  if (records.length) {
    const { rows } = await safe(db.query(
      `SELECT section_id, student_id, data, to_char(entry_date, 'YYYY-MM-DD') AS day
         FROM custom_section_entries
        WHERE organization_id = $1 AND section_id = ANY($2::int[]) AND student_id = ANY($3::int[])
          AND entry_date BETWEEN $4::date AND $5::date`,
      [organizationId, records.map((section) => section.id), students.map((student) => student.id), past.from, past.to]
    ), { rows: [] });
    for (const student of students) {
      const lines = [];
      for (const section of records) {
        if (!forms.inSection(section, student.classId)) continue;
        const entries = rows.filter((row) => Number(row.section_id) === section.id && Number(row.student_id) === student.id);
        if (!entries.length) continue;
        const field = forms.quickFields(section)[0];
        if (!field) {
          lines.push({ name: section.name, text: `recorded on ${plural(new Set(entries.map((row) => row.day)).size, "day")}` });
          continue;
        }
        const counts = new Map();
        for (const entry of entries) {
          const label = forms.display(field, (entry.data || {})[field.id]);
          if (label) counts.set(label, (counts.get(label) || 0) + 1);
        }
        if (!counts.size) continue;
        lines.push({ name: section.name, text: [...counts].map(([label, count]) => `${label} (${plural(count, "day")})`).join(", ") });
      }
      if (lines.length) out.records.set(student.id, lines);
    }
  }
  return out;
}

async function schoolCurrency(db, organizationId) {
  const { normalizeCurrencyCode, getCurrencyForCountry, inferCountryCodeFromLocationParts } = require("./currencyLocalization");
  const { rows } = await safe(db.query(
    `SELECT organization_currency, organization_country FROM organizations WHERE organization_id = $1`,
    [organizationId]
  ), { rows: [] });
  const row = rows[0] || {};
  const override = normalizeCurrencyCode(row.organization_currency);
  if (override) return override;
  const country = String(row.organization_country || "").trim();
  const code = /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : inferCountryCodeFromLocationParts(country);
  return normalizeCurrencyCode(getCurrencyForCountry(code)) || "USD";
}

// What the family owes, as the student ledger counts it, for one-time bills; repeating bills
// (a lunch plan) are named without an amount, since theirs depends on the school's calendar.
async function paymentsFor(db, organizationId, studentIds, today) {
  const { rows } = await safe(db.query(
    `SELECT fa.student_id, b.title, b.recurrence, to_char(b.due_date, 'YYYY-MM-DD') AS due,
            GREATEST(COALESCE(fa.amount, 0) + COALESCE(fa.late_fee_applied, 0) - COALESCE(fa.amount_paid, 0), 0)::numeric AS owed
       FROM finance_bill_assignments fa
       JOIN finance_bills b ON b.bill_id = fa.bill_id AND b.organization_id = fa.organization_id
      WHERE fa.organization_id = $1 AND fa.student_id = ANY($2::int[]) AND b.status = 'active'
        AND (b.scheduled_send_at IS NULL OR b.scheduled_send_at <= NOW())
        AND (b.recurrence_end_date IS NULL OR b.recurrence_end_date >= $3::date)
      ORDER BY b.due_date NULLS LAST, b.title`,
    [organizationId, studentIds, today]
  ), { rows: [] });
  if (!rows.length) return new Map();
  const { formatCurrencyAmount } = require("./currencyLocalization");
  const currency = await schoolCurrency(db, organizationId);
  const repeating = (value) => Boolean(value) && !["none", "once", "one_time", "one-time"].includes(String(value).toLowerCase());
  const out = new Map();
  for (const row of rows) {
    const id = Number(row.student_id);
    const entry = out.get(id) || { bills: [], repeating: [] };
    if (repeating(row.recurrence)) {
      if (!entry.repeating.some((bill) => bill.title === row.title)) entry.repeating.push({ title: row.title, how: String(row.recurrence).toLowerCase() });
    } else if (Number(row.owed) > 0) {
      entry.bills.push({ title: row.title, owed: formatCurrencyAmount(Number(row.owed), currency), due: row.due, overdue: Boolean(row.due && row.due < today) });
    }
    out.set(id, entry);
  }
  for (const [id, entry] of out) if (!entry.bills.length && !entry.repeating.length) out.delete(id);
  return out;
}

// Everything the enabled sections need, for one school's students, in a few statements.
async function gatherWeek(db, organizationId, students, windows, need) {
  const ids = students.map((student) => student.id);
  const has = (key) => need.has(key);
  const [share, lunch, attendance, grades, tests, activities, events, bus, payments, parentExtras, studentExtras] = await Promise.all([
    sharingFor(db, organizationId, ids),
    has("lunch") ? lunchFor(db, organizationId, ids, windows.past) : new Map(),
    has("attendance") ? attendanceFor(db, organizationId, ids, windows.past) : new Map(),
    has("grades") ? gradesFor(db, organizationId, ids, windows.past, windows.timeZone) : new Map(),
    has("tests") ? testsFor(db, organizationId, students, windows.next) : new Map(),
    has("activities") ? activitiesFor(db, organizationId, students, windows.next) : new Map(),
    has("events") ? eventsFor(db, organizationId, windows.next) : [],
    has("bus") ? busFor(db, organizationId, ids, windows.past, windows.timeZone) : new Map(),
    has("payments") ? paymentsFor(db, organizationId, ids, windows.today) : new Map(),
    has("parents:forms") || has("parents:records") ? formsAndRecordsFor(db, organizationId, students, windows.past, "parents") : { forms: new Map(), records: new Map() },
    has("students:forms") || has("students:records") ? formsAndRecordsFor(db, organizationId, students, windows.past, "students") : { forms: new Map(), records: new Map() },
  ]);
  return { share, lunch, attendance, grades, tests, activities, events, bus, payments, extras: { parents: parentExtras, students: studentExtras } };
}

// ── The email ──────────────────────────────────────────────────────────────────────────────

const lines = (items, more = 0) => {
  const shown = items.slice(0, MAX_LINES).map((item) => escapeHtml(item));
  const extra = items.length - MAX_LINES + more;
  if (extra > 0) shown.push(`<span style="color:#64748b;">and ${extra} more in the portal</span>`);
  return shown.join("<br>");
};

// The rows of one student's block, in the order a family reads them.
function rowsFor(student, week, settings, audience, { withEvents = false } = {}) {
  // The school's briefing choices, and what the student's class shares with this audience.
  const shares = (week.share && week.share[audience] && week.share[audience].get(student.id)) || {};
  const shared = (key) => shares[key] !== false;
  const on = (key) => settings.sections[key] === true;
  const rows = [];
  const attendance = week.attendance.get(student.id);
  if (on("attendance") && shared("attendance") && attendance && attendance.days > 0) {
    const absent = (attendance.absent_days || []).map((day) => dayLabel(day));
    const allDays = attendance.days === 1 ? "Present the one day attendance was taken"
      : attendance.days === 2 ? "Present both days attendance was taken"
        : `Present all ${attendance.days} days`;
    const text = attendance.present === attendance.days
      ? allDays
      : `Present ${attendance.present} of ${plural(attendance.days, "day")}${absent.length ? ` · absent ${absent.join(", ")}` : ""}`;
    rows.push({ label: "Attendance", value: escapeHtml(text) });
  }
  const lunch = week.lunch.get(student.id);
  if (on("lunch") && shared("lunch") && lunch && lunch.days > 0) {
    const text = lunch.had === lunch.days
      ? (lunch.days === 1 ? "Had lunch the one day it was taken" : `Had lunch all ${lunch.days} days`)
      : `Had lunch ${lunch.had} of ${plural(lunch.days, "day")}`;
    rows.push({ label: "Lunch", value: escapeHtml(text) });
  }
  const grades = week.grades.get(student.id) || [];
  if (on("grades") && grades.length) {
    rows.push({ label: "New grades", value: lines(grades.map((grade) => `${grade.subject ? `${grade.subject} · ` : ""}${grade.title}: ${grade.grade}`)) });
  }
  const bus = week.bus.get(student.id);
  if (on("bus") && shared("transport") && bus) {
    const parts = [];
    const route = [bus.route, bus.stop ? `${bus.stop} stop` : ""].filter(Boolean).join(" · ");
    if (route) parts.push(route);
    if (bus.pickup) parts.push(`Pickup at ${bus.pickup}`);
    parts.push(bus.rides ? `Rode ${plural(bus.rides, "trip")} this week` : "No rides recorded this week");
    if (bus.notRiding.length) parts.push(`Not riding: ${bus.notRiding.map((day) => dayLabel(day)).join(", ")}`);
    if (audience === "parents" && bus.notes) parts.push(`The driver shared ${bus.notes === 1 ? "a note" : `${bus.notes} notes`}; read ${bus.notes === 1 ? "it" : "them"} in the parent portal`);
    rows.push({ label: "Bus", value: lines(parts) });
  }
  const extras = week.extras[audience];
  const records = extras.records.get(student.id) || [];
  if (on("records") && records.length) {
    for (const record of records) rows.push({ label: record.name, value: escapeHtml(record.text) });
  }
  const forms = extras.forms.get(student.id) || [];
  if (on("forms") && forms.length) {
    rows.push({ label: "Forms to fill in", value: lines(forms.map((form) => `${form.name}${form.due ? ` · due ${dayLabel(form.due, { month: "short", day: "numeric" })}` : form.required ? " · required" : ""}`)) });
  }
  const payments = audience === "parents" ? week.payments.get(student.id) : null;
  if (on("payments") && payments) {
    const parts = payments.bills.map((bill) => `${bill.title}: ${bill.owed} ${bill.overdue ? `was due ${dayLabel(bill.due, { month: "short", day: "numeric" })}` : bill.due ? `due ${dayLabel(bill.due, { month: "short", day: "numeric" })}` : "to pay"}`);
    for (const bill of payments.repeating) parts.push(`${bill.title} (repeats ${bill.how})`);
    rows.push({ label: "Payments", value: lines(parts) });
  }
  const tests = week.tests.get(student.id) || [];
  if (on("tests") && tests.length) {
    rows.push({ label: "Tests coming up", value: lines(tests.map((test) => `${test.subject ? `${test.subject} · ` : ""}${test.title} · opens ${dayLabel(test.opens)}`)) });
  }
  const activities = week.activities.get(student.id) || [];
  if (on("activities") && activities.length) {
    rows.push({ label: "Class activities", value: lines(activities.map((item) => `${item.title} · ${dayLabel(item.date)}${item.startTime ? `, ${timeLabel(item.startTime)}` : ""}`)) });
  }
  if (withEvents && on("events") && week.events.length) rows.push(eventsRow(week.events));
  return rows;
}

const eventsRow = (events) => ({
  label: "School events",
  value: lines(events.map((event) => `${event.name} · ${dayLabel(event.day)}${event.start_time && !event.all_day ? `, ${timeLabel(event.start_time)}` : ""}`)),
});

const firstName = (person) => String(person.firstName || "").trim();
const childNames = (children) => {
  const names = children.map((child) => firstName(child) || "your child");
  if (names.length === 1) return names[0];
  if (names.length === 2 && names[0] !== names[1] && !names.includes("your child")) return `${names[0]} and ${names[1]}`;
  return "your children";
};
const possessive = (name) => (name === "your children" ? "your children's" : `${name}${/s$/i.test(name) ? "'" : "'s"}`);

function studentHeading(student) {
  const name = escapeHtml(`${student.firstName} ${student.lastName}`.trim());
  const className = student.className ? `<span style="font-weight:400;color:#64748b;"> · ${escapeHtml(student.className)}</span>` : "";
  return `<p class="t-strong" style="margin:24px 0 8px;font-size:16px;line-height:1.4;font-weight:700;color:#0f172a;">${name}${className}</p>`;
}

// One family's email, or null when nothing in it is worth sending.
function parentEmail({ parent, children, week, all, windows, school, alerts = null }) {
  const blocks = [];
  let anyEvents = false;
  const kept = [];
  for (const child of children) {
    const settings = settingsForClass(all, child.classId).parents;
    if (!settings.on) continue;
    if (settings.sections.events) anyEvents = true;
    const rows = rowsFor(child, week, settings, "parents");
    if (!rows.length) continue;
    kept.push(child);
    blocks.push(`${studentHeading(child)}${detailsBlock(rows)}`);
  }
  const events = anyEvents && week.events.length ? `<p class="t-strong" style="margin:24px 0 8px;font-size:16px;line-height:1.4;font-weight:700;color:#0f172a;">Coming up at school</p>${detailsBlock([eventsRow(week.events)])}` : "";
  const alertRow = alerts ? require("./alertRules").digestRows(alerts) : null;
  if (alertRow) blocks.push(`<p class="t-strong" style="margin:24px 0 8px;font-size:16px;line-height:1.4;font-weight:700;color:#0f172a;">Alerts you asked for</p>${detailsBlock([{ label: "This week", value: alertRow.value }])}`);
  if (!blocks.length && !events) return null;
  const who = childNames(kept.length ? kept : children);
  const range = rangeLabel(windows.past.from, windows.past.to);
  const subject = `${possessive(who).replace(/^your/, "Your")} week · ${range}`;
  const html = renderModernEmail({
    title: `${possessive(who).replace(/^your/, "Your")} week`,
    preheader: `Your weekly briefing from ${school.name} for ${rangeLabel(windows.past.from, windows.past.to, true)}.`,
    greeting: firstName(parent) ? `Hi ${escapeHtml(firstName(parent))},` : "Hello,",
    paragraphs: [
      `Here is ${escapeHtml(possessive(who))} week at ${escapeHtml(school.name)}, ${escapeHtml(rangeLabel(windows.past.from, windows.past.to, true))}.`,
      ...blocks,
      events,
    ].filter(Boolean),
    cta: parent.hasPortal ? { text: "Open the parent portal", url: `${BASE_URL}/guardian/dashboard` } : null,
    schoolName: school.name,
    schoolWebsiteUrl: school.websiteUrl || "",
    schoolWebsiteHost: school.websiteHost || "",
  });
  return { subject, html };
}

function studentEmail({ student, week, settings, windows, school, alerts = null }) {
  const rows = rowsFor(student, week, settings, "students", { withEvents: true });
  const alertRow = alerts ? require("./alertRules").digestRows(alerts) : null;
  if (alertRow) rows.push(alertRow);
  if (!rows.length) return null;
  const range = rangeLabel(windows.past.from, windows.past.to);
  const html = renderModernEmail({
    title: "Your week",
    preheader: `Your weekly briefing from ${school.name} for ${rangeLabel(windows.past.from, windows.past.to, true)}.`,
    greeting: firstName(student) ? `Hi ${escapeHtml(firstName(student))},` : "Hello,",
    paragraphs: [
      `Here is your week at ${escapeHtml(school.name)}, ${escapeHtml(rangeLabel(windows.past.from, windows.past.to, true))}.`,
      detailsBlock(rows),
    ],
    cta: { text: "Open your student portal", url: `${BASE_URL}/student/dashboard` },
    schoolName: school.name,
    schoolWebsiteUrl: school.websiteUrl || "",
    schoolWebsiteHost: school.websiteHost || "",
  });
  return { subject: `Your week · ${range}`, html };
}

// ── Who gets it ────────────────────────────────────────────────────────────────────────────

async function currentStudents(db, organizationId, { classId = null, studentIds = null } = {}) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.first_name, s.last_name, s.class_id, c.class_name
       FROM students s
       LEFT JOIN classes c ON c.class_id = s.class_id AND c.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND ${activeStudentSql("s")}
        AND ($2::int IS NULL OR s.class_id = $2) AND ($3::int[] IS NULL OR s.student_id = ANY($3::int[]))
      ORDER BY LOWER(s.first_name), LOWER(s.last_name)`,
    [organizationId, classId, studentIds]
  );
  return rows.map((row) => ({
    id: Number(row.student_id),
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    classId: row.class_id ? Number(row.class_id) : null,
    className: row.class_name || "",
  }));
}

// Families of these students, by email: a parent account's name when there is one.
async function familiesOf(db, organizationId, studentIds) {
  const { rows } = await db.query(
    `SELECT LOWER(TRIM(src.email)) AS email, src.first_name, src.student_id, src.portal
       FROM (
         SELECT gp.email, gp.first_name, gs.student_id, TRUE AS portal
           FROM guardian_profiles gp JOIN guardian_students gs ON gs.guardian_id = gp.guardian_id
          WHERE gp.organization_id = $1 AND NULLIF(TRIM(gp.email), '') IS NOT NULL
         UNION ALL
         SELECT g.email, g.first_name, g.student_id, FALSE AS portal
           FROM guardians g
          WHERE g.organization_id = $1 AND NULLIF(TRIM(g.email), '') IS NOT NULL
       ) src
      WHERE src.student_id = ANY($2::int[])
      ORDER BY src.portal DESC`,
    [organizationId, studentIds]
  );
  const families = new Map();
  for (const row of rows) {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(row.email)) continue;
    const family = families.get(row.email) || { email: row.email, firstName: "", hasPortal: false, studentIds: new Set() };
    if (!family.firstName && row.first_name) family.firstName = String(row.first_name).trim();
    family.hasPortal = family.hasPortal || row.portal === true;
    family.studentIds.add(Number(row.student_id));
    families.set(row.email, family);
  }
  return [...families.values()];
}

// Students who can sign in to the student portal, with the address they sign in with.
async function studentLogins(db, organizationId, studentIds) {
  const { rows } = await safe(db.query(
    `SELECT sa.student_id, LOWER(TRIM(sa.login_email)) AS email
       FROM student_accounts sa
       JOIN organizations o ON o.organization_id = sa.organization_id AND o.student_portal_activated = TRUE
      WHERE sa.organization_id = $1 AND sa.student_id = ANY($2::int[]) AND NULLIF(TRIM(sa.login_email), '') IS NOT NULL`,
    [organizationId, studentIds]
  ), { rows: [] });
  return new Map(rows
    .filter((row) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(row.email))
    .map((row) => [Number(row.student_id), row.email]));
}

async function schoolInfo(db, organizationId) {
  const { rows } = await db.query(`SELECT organization_name FROM organizations WHERE organization_id = $1`, [organizationId]);
  const { getOrganizationWebsiteInfo } = require("./schoolWebsiteAccess");
  const website = await getOrganizationWebsiteInfo(db, organizationId).catch(() => ({}));
  return { name: rows[0]?.organization_name || "Your school", websiteUrl: website.websiteUrl || "", websiteHost: website.websiteHost || "" };
}

// The sections any class of this school sends, so nothing else is read.
function sectionsNeeded(all, students) {
  const need = new Set();
  const classIds = new Set(students.map((student) => student.classId));
  for (const classId of classIds) {
    const settings = settingsForClass(all, classId);
    for (const audience of AUDIENCES) {
      if (!settings[audience].on) continue;
      for (const [key, on] of Object.entries(settings[audience].sections)) {
        if (!on) continue;
        need.add(key);
        need.add(`${audience}:${key}`);
      }
    }
  }
  return need;
}

// ── Sending ────────────────────────────────────────────────────────────────────────────────

// Sending in batches: each batch is reserved in one statement (one per address per day, so
// nobody gets it twice) and recorded in two, however many emails it holds.
const BATCH = 50;

async function sendBatch(db, organizationId, kind, dayKey, items) {
  if (!items.length) return 0;
  const { rows } = await db.query(
    `INSERT INTO notification_dispatches (organization_id, event_type, event_key, recipient_email, recipient_kind, subject, payload, status)
     SELECT $1, $2, $3, t.email, $4, t.subject, '{}'::jsonb, 'queued' FROM unnest($5::text[], $6::text[]) AS t(email, subject)
     ON CONFLICT (organization_id, event_type, event_key, recipient_email) DO NOTHING
     RETURNING recipient_email, dispatch_id`,
    [organizationId, `weekly_briefing_${kind}`, dayKey, kind === "parent" ? "guardian" : "student", items.map((item) => item.to), items.map((item) => item.subject)]
  );
  const reserved = new Map(rows.map((row) => [row.recipient_email, row.dispatch_id]));
  const { sendEmailSafely } = require("./emailHelper");
  const sent = [];
  const failed = [];
  const alertsSent = [];
  for (const item of items) {
    const dispatchId = reserved.get(item.to);
    if (!dispatchId) continue;
    const ok = await sendEmailSafely({
      to: item.to, subject: item.subject, html: item.html,
      category: kind === "parent" ? "weekly_parent_digest" : "weekly_student_digest",
      optOutChecked: true, onBehalfOf: organizationId, sender: "reminders",
    }, kind === "parent" ? "Weekly briefing" : "Weekly briefing (student)");
    (ok ? sent : failed).push(dispatchId);
    if (ok && item.alertIds) alertsSent.push(...item.alertIds);
  }
  await require("./alertRules").markDigested(db, alertsSent);
  const record = (sql, ids) => (ids.length ? db.query(sql, [ids]).catch((error) => console.warn("[Weekly briefing] could not record sends:", error.message)) : null);
  await record(`UPDATE notification_dispatches SET status = 'sent', sent_at = NOW(), error_message = NULL WHERE dispatch_id = ANY($1::int[])`, sent);
  await record(`UPDATE notification_dispatches SET status = 'failed', error_message = 'Not delivered' WHERE dispatch_id = ANY($1::int[])`, failed);
  return sent.length;
}

// One school's briefings for this week. `force` skips the day and time (a manual run).
async function sendForOrganization(db, organizationId, { now = new Date(), force = false } = {}) {
  const { isOn } = require("./shards/features");
  if (!isOn("weekly_briefing", { organizationId })) return { sent: 0, skipped: "feature" };
  const all = await settingsFor(db, organizationId, { fresh: true });
  const { schedule } = all;
  const local = zoned(now, schedule.timeZone);
  if (!force && (local.weekday !== schedule.day || local.hour < schedule.hour)) return { sent: 0, skipped: "not due" };

  // Once a day's run finished, it's done; one cut short is picked up by the next hourly sweep,
  // and each family's reservation keeps anyone from getting it twice.
  const ran = await db.query(
    `SELECT 1 FROM notification_digest_runs WHERE organization_id = $1 AND digest_type = 'weekly_briefing' AND week_start_date = $2::date`,
    [organizationId, local.key]
  );
  if (ran.rows.length && !force) return { sent: 0, skipped: "already sent" };
  const finished = () => db.query(
    `INSERT INTO notification_digest_runs (organization_id, digest_type, week_start_date) VALUES ($1, 'weekly_briefing', $2::date)
     ON CONFLICT (organization_id, digest_type, week_start_date) DO NOTHING`,
    [organizationId, local.key]
  );

  const students = await currentStudents(db, organizationId);
  const need = sectionsNeeded(all, students);
  if (!students.length || !need.size) {
    await finished();
    return { sent: 0 };
  }

  const windows = windowsFor(now, schedule.timeZone);
  const [week, school, families, logins] = await Promise.all([
    gatherWeek(db, organizationId, students, windows, need),
    schoolInfo(db, organizationId),
    familiesOf(db, organizationId, students.map((student) => student.id)),
    studentLogins(db, organizationId, students.map((student) => student.id)),
  ]);
  const byId = new Map(students.map((student) => [student.id, student]));
  const digest = await require("./alertRules").digestFor(db, organizationId);
  const { filterEmailsByPreference } = require("./emailPreferences");
  let sent = 0;

  // Families, then students with a student-portal login, a batch at a time.
  let batch = [];
  const flush = async (kind) => {
    sent += await sendBatch(db, organizationId, kind, local.key, batch);
    batch = [];
  };
  const wanted = new Set(await filterEmailsByPreference(db, families.map((family) => family.email), "weekly_parent_digest"));
  for (const family of families) {
    if (!wanted.has(family.email)) continue;
    const children = [...family.studentIds].map((id) => byId.get(id)).filter(Boolean)
      .sort((a, b) => a.firstName.localeCompare(b.firstName));
    const alerts = digest.get(family.email) || null;
    const email = parentEmail({ parent: family, children, week, all, windows, school, alerts });
    if (!email) continue;
    batch.push({ to: family.email, ...email, alertIds: alerts ? alerts.map((a) => a.id) : null });
    if (batch.length >= BATCH) await flush("parent");
  }
  await flush("parent");

  const studentWanted = new Set(await filterEmailsByPreference(db, [...logins.values()], "weekly_student_digest"));
  for (const [studentId, address] of logins) {
    const student = byId.get(studentId);
    if (!student || !studentWanted.has(address)) continue;
    const settings = settingsForClass(all, student.classId).students;
    if (!settings.on) continue;
    const alerts = digest.get(address) || null;
    const email = studentEmail({ student, week, settings, windows, school, alerts });
    if (!email) continue;
    batch.push({ to: address, ...email, alertIds: alerts ? alerts.map((a) => a.id) : null });
    if (batch.length >= BATCH) await flush("student");
  }
  await flush("student");
  await finished();
  return { sent };
}

// A staff preview: the email a family (or the student) would get this week, built from the
// school's real records and the class's choices, never sent.
async function preview(db, organizationId, { studentId, audience = "parents", now = new Date() }) {
  const [student] = await currentStudents(db, organizationId, { studentIds: [Number(studentId)] });
  if (!student) return null;
  const all = await settingsFor(db, organizationId, { fresh: true });
  const windows = windowsFor(now, all.schedule.timeZone);
  const settings = settingsForClass(all, student.classId);
  const school = await schoolInfo(db, organizationId);
  const shown = { parents: { ...settings.parents, on: true }, students: { ...settings.students, on: true } };
  if (audience === "students") {
    const need = sectionsNeeded({ ...all, school: shown, classes: new Map() }, [student]);
    const week = await gatherWeek(db, organizationId, [student], windows, need);
    const email = studentEmail({ student, week, settings: { ...settings.students, on: true }, windows, school });
    return { ...(email || {}), audience, student, off: !settings.students.on, empty: !email };
  }
  // The family's whole email: every current child on the same address, as the real send builds it.
  const [first] = await familiesOf(db, organizationId, [student.id]);
  const everyone = first ? await currentStudents(db, organizationId) : [];
  const family = first ? (await familiesOf(db, organizationId, everyone.map((item) => item.id))).find((item) => item.email === first.email) : null;
  const parent = family || { email: "", firstName: "", hasPortal: true, studentIds: new Set([student.id]) };
  const children = await currentStudents(db, organizationId, { studentIds: [...parent.studentIds] });
  const previewAll = { ...all, classes: new Map(children.map((child) => {
    const own = settingsForClass(all, child.classId);
    return [child.classId, { ...own, parents: { ...own.parents, on: true } }];
  })) };
  const need = sectionsNeeded(previewAll, children);
  const week = await gatherWeek(db, organizationId, children, windows, need);
  const email = parentEmail({ parent, children, week, all: previewAll, windows, school });
  return { ...(email || {}), audience, student, parentEmail: parent.email, off: !settings.parents.on, empty: !email };
}

module.exports = {
  SECTIONS, SECTION_KEYS, AUDIENCES, DAYS, TIME_ZONES, DEFAULT_SCHEDULE,
  normalizeSettings, normalizeSchedule, settingsFromForm, settingsFor, settingsForClass, forget,
  saveSchoolSettings, saveClassSettings, windowsFor, rangeLabel, hourLabel, zoned, validZone,
  currentStudents, sendForOrganization, preview,
  // For tests.
  rowsFor, parentEmail, studentEmail,
};
