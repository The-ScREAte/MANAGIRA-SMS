"use strict";
// Class settings (feature class_settings, utils/classSettings.js): the pages around it.
//   Classroom: Class Tools › Class settings (/common/classDashboard/:classId/settings), for a
//     class the person may manage (canManage): Take lunch, what is shared with parents and with
//     students, and a summary of the school's attendance calendar.
//   Management › Class settings (/common/class-settings, inside the hub only), with Every Class:
//     every class in one table, with an "All classes" row, and the same calendar summary.
//   The calendar itself is edited in Settings › Customize School › School rules (Settings ›
//     Profile): both pages link there for people who can open it.
//   POST /common/class-settings/save: one switch for one class, or for every listed class.
const features = require("../utils/shards/features");
const classSettings = require("../utils/classSettings");
const attendanceCalendar = require("../utils/attendanceCalendar");
const { COUNTRY_NAME_LOOKUP } = require("../utils/countries");
const { todayKeyFor } = require("../utils/localDate");
const { isEmbeddedRequest } = require("../utils/embeddedMode");
const { logOrganizationActivity } = require("../utils/activityLog");
const permissions = require("../middleware/permissionMiddleware");

const PAGE = "/common/class-settings";
const LABEL = "Class settings";
// The Management panel, opened from another page (links carry data-no-spa).
const hubUrl = (page = PAGE) => `/common/management?panel=class-settings&page=${encodeURIComponent(page)}&label=${encodeURIComponent(LABEL)}`;
// Settings › Customize School, at its School calendar card (views/account/settings.ejs).
const CALENDAR_SETTINGS_URL = "/account/settings?section=customize#school-calendar";

const orgOf = (req) => Number(req.session && req.session.organizationId);
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const lunchOn = (organizationId) => features.isOn("class_lunch", { organizationId: Number(organizationId) });
const actorName = (req) => [req.session.firstName, req.session.lastName].filter(Boolean).join(" ")
  || (req.session.user && req.session.user.email) || req.session.organizationName || "Someone";

const gpaOn = (organizationId) => features.isOn("gpa", { organizationId }) && features.isOn("family_gpa", { organizationId });
// What a school's pages offer: lunch (taking it, and sharing it) only where the school has lunch
// (feature class_lunch), and sharing GPA only where it has GPA (feature gpa).
// Student files and the portfolio only where the school has them (student_documents, student_portfolio).
const filesOn = (organizationId) => features.isOn("student_documents", { organizationId: Number(organizationId) });
const portfolioOn = (organizationId) => features.isOn("student_portfolio", { organizationId: Number(organizationId) });
// A teacher's email, phone and About me only where the school has the Teachers page (teacher_cards).
const teacherCardsOn = (organizationId) => features.isOn("teacher_cards", { organizationId: Number(organizationId) });
const offered = (organizationId, key) => (key !== "lunch" || lunchOn(organizationId)) && (key !== "gpa" || gpaOn(organizationId))
  && (key !== "files" || filesOn(organizationId)) && (key !== "portfolio" || portfolioOn(organizationId))
  && (!String(key).startsWith("teacher") || teacherCardsOn(organizationId));
const switchesFor = (organizationId) => classSettings.SWITCHES.filter((s) => offered(organizationId, s.item || s.key));
const shareItemsFor = (organizationId) => classSettings.SHARE_ITEMS.filter((item) => offered(organizationId, item.key));
// A switch's value in a settings object ("lunch", "parents.attendance", "students.lunch").
const valueAt = (settings, key) => {
  const [first, second] = String(key).split(".");
  const value = second ? (settings[first] || {})[second] : settings[first];
  return value !== false;
};
const audienceLabel = (key) => (classSettings.AUDIENCES.find((a) => a.key === key) || { label: key }).label;
const itemLabel = (key) => (classSettings.SHARE_ITEMS.find((i) => i.key === key) || { label: key }).label;

// A DATE column comes back as local midnight: read its own day, never through UTC.
const dayKey = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};
const asUtc = (key) => new Date(`${key}T00:00:00Z`);
const dayLabel = (key, options) => asUtc(key).toLocaleDateString("en-US", { timeZone: "UTC", ...options });
const addDays = (key, days) => { const d = asUtc(key); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const listWords = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

// Country names for the public holidays (the calendar's own list where ours has no name).
let holidayCountries = null;
const countryName = (code) => {
  const key = String(code || "").trim().toUpperCase();
  if (!key) return "";
  if (COUNTRY_NAME_LOOKUP[key]) return COUNTRY_NAME_LOOKUP[key];
  holidayCountries = holidayCountries || attendanceCalendar.getHolidayCountryOptions();
  return (holidayCountries.find((country) => country.code === key) || {}).name || key;
};

// The school's current term.
async function currentTermOf(db, organizationId) {
  const { rows } = await db.query(
    `SELECT t.term_id, t.term_name, t.start_date, t.end_date, t.school_year_id
       FROM terms t JOIN school_years sy ON sy.id = t.school_year_id
      WHERE t.organization_id = $1 AND t.current = TRUE AND sy.current = TRUE
      LIMIT 1`,
    [organizationId]
  );
  return rows[0] || null;
}

// A read-only summary of the school's attendance calendar for one term: weekends, public
// holidays (and their country) and the days off still to come. Never writes anything.
async function calendarSummary(db, organizationId, term, todayKey) {
  const today = todayKey || new Date().toISOString().slice(0, 10);
  const start = dayKey(term && term.start_date);
  const end = dayKey(term && term.end_date);
  const summary = {
    set: false,
    term: term ? { name: term.term_name, dates: start && end ? `${dayLabel(start, { month: "short", day: "numeric" })} – ${dayLabel(end, { month: "short", day: "numeric", year: "numeric" })}` : "" } : null,
    weekends: "Saturday and Sunday",
    publicHolidays: false,
    country: "",
    upcoming: [],
    more: 0,
  };
  let profile = null;
  try {
    profile = await attendanceCalendar.getAttendanceCalendarProfile(db, organizationId, term ? term.term_id : null);
  } catch (error) {
    if (!error || error.code !== "42P01") throw error; // before the calendar's tables exist: nothing set
  }
  if (!profile) return summary;
  summary.set = true;
  // In the week's order from Monday, so a usual weekend reads "Saturday and Sunday".
  const weekendDays = attendanceCalendar.normalizeWeekendDaysInput(profile.weekend_days || []).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  summary.weekends = weekendDays.length
    ? listWords(weekendDays.map((day) => attendanceCalendar.WEEKDAY_OPTIONS[day].label))
    : "None";
  summary.publicHolidays = attendanceCalendar.parseBoolean(profile.include_public_holidays);
  summary.country = countryName(profile.country_code);

  // From today to the end of the term (no term: the next four months).
  const from = start && start > today ? start : today;
  const to = end || addDays(today, 120);
  if (to < from) return summary;
  const days = await attendanceCalendar.getAttendanceCalendarDays(db, profile.calendar_id, from, to);
  const off = days
    .map((day) => ({ ...day, key: dayKey(day.calendar_date) }))
    .filter((day) => day.key && day.key >= from && day.key <= to && !day.counts_for_attendance)
    .filter((day) => day.source === "manual" || (day.source === "public_holiday" && summary.publicHolidays))
    .map((day) => ({
      date: day.key,
      day: dayLabel(day.key, { month: "short", day: "numeric" }),
      weekday: dayLabel(day.key, { weekday: "short" }),
      label: String(day.label || "").trim() || (day.source === "manual" ? "No school" : "Public holiday"),
      kind: day.source === "manual" ? "School day off" : "Public holiday",
    }));
  summary.upcoming = off.slice(0, 8);
  summary.more = Math.max(0, off.length - summary.upcoming.length);
  return summary;
}

// The calendar summary with its "Change in Settings" link, offered only to someone who can open
// that part of Settings (Settings › Profile, as the calendar's own routes require).
async function calendarCard(db, req, term) {
  const organizationId = orgOf(req);
  const who = permissions.sessionActor(req);
  const [summary, canChange] = await Promise.all([
    calendarSummary(db, organizationId, term || (await currentTermOf(db, organizationId)), todayKeyFor(req))
      .catch((error) => { console.error("[Class settings] calendar summary:", error.message); return null; }),
    Promise.all([
      permissions.userHasPermission(db, who, permissions.PERMISSIONS.MANAGE_SETTINGS),
      permissions.userHasPermission(db, who, permissions.PERMISSIONS.SETTINGS_PROFILE),
    ]).then(([settings, profile]) => settings && profile).catch(() => false),
  ]);
  return { summary, settingsUrl: canChange ? CALENDAR_SETTINGS_URL : null };
}

// What the classroom's Class settings panel needs, or null when it isn't offered (the feature is
// off for the school, or the person can't manage this class).
async function classroomPanel(db, req, { classId, term } = {}) {
  const organizationId = orgOf(req);
  if (!organizationId || !classSettings.isOn(organizationId)) return null;
  const granted = await classSettings.access(db, req);
  if (!classSettings.canManage(granted, classId)) return null;
  const ready = await classSettings.ready(db);
  const settings = ready ? await classSettings.settingsFor(db, organizationId, classId) : classSettings.withDefaults(null);
  const classSwitches = switchesFor(organizationId).filter((s) => s.group === "class")
    .map((s) => ({ key: s.key, label: s.label, help: s.help, on: valueAt(settings, s.key) }));
  const share = shareItemsFor(organizationId).map((item) => ({
    key: item.key,
    label: item.label,
    help: item.help,
    boxes: classSettings.AUDIENCES.map((audience) => ({ key: `${audience.key}.${item.key}`, audience: audience.key, label: audience.label, on: valueAt(settings, `${audience.key}.${item.key}`) })),
  }));
  return {
    ready,
    classSwitches,
    share,
    calendar: await calendarCard(db, req, term),
    saveUrl: `${PAGE}/save`,
  };
}

// Every class the Management page lists (and "All classes" sets): the school's classes that
// aren't retired, in the school's own order, as Classes & subjects lists them.
async function classesOf(db, organizationId) {
  const query = (sql) => db.query(sql, [organizationId]).then((result) => result.rows);
  let rows;
  try {
    rows = await query(
      `SELECT c.class_id, c.class_name, g.name AS cohort
         FROM classes c LEFT JOIN graduation_year_groups g ON g.id = c.graduation_year_group_id
        WHERE c.organization_id = $1 AND c.obsolete_at IS NULL
        ORDER BY COALESCE(c.dashboard_sort_order, 2147483647), c.class_name, c.class_id`
    );
  } catch (error) {
    if (!error || error.code !== "42703") throw error; // an older database: no retired classes or order yet
    rows = await query("SELECT c.class_id, c.class_name, NULL AS cohort FROM classes c WHERE c.organization_id = $1 ORDER BY c.class_name, c.class_id");
  }
  return rows.map((row) => ({ id: Number(row.class_id), name: row.class_name, cohort: row.cohort || "" }));
}

// GET /common/class-settings: Management › Class settings (Every Class), inside the hub.
async function managementPage(req, res, db) {
  const organizationId = orgOf(req);
  try {
    if (!classSettings.isOn(organizationId)) {
      req.flash("error", "Class settings aren't available for this school yet.");
      return res.redirect("/common/orgDashboard");
    }
    const granted = await classSettings.access(db, req);
    if (!granted.all) {
      req.flash("error", "Class settings for every class need the Class Settings permission with Every Class.");
      return res.redirect("/common/orgDashboard");
    }
    const isEmbedded = isEmbeddedRequest(req, "classSettings");
    // It has no page of its own: it opens inside Management Tools.
    if (!isEmbedded && String(req.get("Sec-Fetch-Dest") || "") !== "iframe") return res.redirect(hubUrl(req.originalUrl));

    const ready = await classSettings.ready(db);
    const [classes, calendar] = await Promise.all([classesOf(db, organizationId), calendarCard(db, req, null)]);
    const [byClass, leads] = await Promise.all([
      ready ? classSettings.settingsForClasses(db, organizationId, classes.map((c) => c.id)) : new Map(),
      require("../utils/mainTeacher").mainTeachersByClass(db, organizationId).catch(() => new Map()),
    ]);
    const switches = switchesFor(organizationId);
    const rows = classes.map((c) => {
      const settings = byClass.get(c.id) || classSettings.withDefaults(null);
      const lead = leads.get(c.id);
      return { ...c, lead: lead ? lead.name : "", on: Object.fromEntries(switches.map((s) => [s.key, valueAt(settings, s.key)])) };
    });
    return res.render("common/classSettings", {
      title: LABEL,
      isEmbedded,
      hideGlobalHeader: isEmbedded,
      hideGlobalFooter: isEmbedded,
      hideGlobalChatbot: true,
      ready,
      classSwitches: switches.filter((s) => s.group === "class").map((s) => ({ key: s.key, label: s.label, help: s.help })),
      shareItems: shareItemsFor(organizationId).map((item) => ({ key: item.key, label: item.label, help: item.help })),
      audiences: classSettings.AUDIENCES,
      rows,
      calendar,
      saveUrl: `${PAGE}/save`,
    });
  } catch (error) {
    console.error("[Class settings] page:", error.message);
    return res.status(500).send("Class settings could not load. Try again.");
  }
}

// What a change did, in words: "turned off Take lunch", "stopped sharing attendance with parents".
function changeWords(s, on) {
  if (s.group !== "share") return `turned ${on ? "on" : "off"} ${s.label}`;
  return `${on ? "started sharing" : "stopped sharing"} ${itemLabel(s.item).toLowerCase()} with ${audienceLabel(s.audience).toLowerCase()}`;
}
const fieldName = (s) => (s.group === "share" ? `${itemLabel(s.item)} · ${audienceLabel(s.audience)}` : s.label);

// In the background: one line in the activity log for each change (who, which class or every
// class, which switch, on or off).
function logChange(db, req, { s, on, classes, all, fromClassroom = false }) {
  const who = actorName(req);
  const where = all ? `every class (${classes.length} changed)` : classes.map((c) => c.name).join(", ");
  logOrganizationActivity({
    organizationId: orgOf(req),
    userId: req.session.userId || (req.session.user && req.session.user.user_id) || null,
    userName: who,
    userRole: req.session.userRole || null,
    actionType: "Updated",
    moduleName: LABEL,
    pagePath: !all && fromClassroom ? `/common/classDashboard/${classes[0].id}/settings` : PAGE,
    recordType: "Class",
    recordId: all || classes.length !== 1 ? null : String(classes[0].id),
    recordLabel: all ? "All classes" : where,
    description: `${who} ${changeWords(s, on)} for ${where}.`,
    changedFields: classes.slice(0, 200).map((c) => ({ field: `${c.name}: ${fieldName(s)}`, oldValue: on ? "Off" : "On", newValue: on ? "On" : "Off" })),
    ipAddress: req.ip,
  }, db).catch((error) => console.error("[Class settings] activity log:", error.message));
}

// POST /common/class-settings/save { classId | all: true, key, on }: JSON only.
async function save(req, res, db) {
  const organizationId = orgOf(req);
  try {
    if (!organizationId || !classSettings.isOn(organizationId)) return fail(res, 404, "Class settings aren't available for this school.");
    const body = req.body || {};
    const key = String(body.key || "");
    const s = switchesFor(organizationId).find((item) => item.key === key);
    if (!s) return fail(res, 400, "That setting isn't available.");
    if (typeof body.on !== "boolean") return fail(res, 400, "Choose on or off.");
    const on = body.on;
    const all = body.all === true;
    const granted = await classSettings.access(db, req);
    let classIds;
    if (all) {
      if (!granted.all) return fail(res, 403, "Changing every class needs the Class Settings permission with Every Class.");
      classIds = (await classesOf(db, organizationId)).map((c) => c.id);
      if (!classIds.length) return fail(res, 404, "Your school has no classes yet.");
    } else {
      const classId = toId(body.classId);
      if (!classId) return fail(res, 400, "Choose a class.");
      if (!classSettings.canManage(granted, classId)) return fail(res, 403, "You can only change the settings of classes you lead.");
      classIds = [classId];
    }
    if (!(await classSettings.ready(db))) return fail(res, 503, "Class settings are still being set up for your school. Try again in a few minutes.");

    const before = await classSettings.settingsForClasses(db, organizationId, classIds);
    const saved = await classSettings.save(db, organizationId, classIds, { [key]: on }, { userId: req.session.userId || (req.session.user && req.session.user.user_id) || null });
    if (!saved.length) return fail(res, 404, "That class wasn't found in your school.");
    const changed = saved.filter((id) => valueAt(before.get(id) || classSettings.withDefaults(null), key) !== on);
    if (changed.length) {
      const { rows } = await db.query("SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND class_id = ANY($2::int[]) ORDER BY class_name", [organizationId, changed]);
      logChange(db, req, { s, on, all, fromClassroom: body.from === "classroom", classes: rows.map((row) => ({ id: Number(row.class_id), name: row.class_name })) });
    }
    return res.json({ success: true, key, on, classIds: saved, changed: changed.length });
  } catch (error) {
    console.error("[Class settings] save:", error.message);
    return fail(res, 500, "That didn't save. Try again.");
  }
}

module.exports = {
  PAGE, CALENDAR_SETTINGS_URL, hubUrl, classroomPanel, calendarSummary, managementPage, save,
  valueAt, dayKey, switchesFor, shareItemsFor,
};
