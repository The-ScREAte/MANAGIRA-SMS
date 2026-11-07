"use strict";

// What Mira can tell people about, and do, among the newest parts of Managira. Each answer
// follows what the person could do on the page themselves, and what's on for their school.
const db = require("../config/db");
const features = require("../utils/shards/features");
const activities = require("../utils/classActivities");
const transportBoarding = require("../utils/transportBoarding");
const parentResources = require("../utils/parentResources");
const ssoConnections = require("../utils/sso/connections");
const { userHasPermission, PERMISSIONS } = require("../middleware/permissionMiddleware");

const MANAGERS = new Set(["organization", "manager", "supervisor", "superviser"]);
const refuse = (message, status = 403) => Object.assign(new Error(message), { status });
const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// Identity comes from Mira's checked session, added to every call by mira/internalApiClient.js.
function who(source) {
  const organizationId = toId(source.organizationId);
  if (!organizationId) throw refuse("organizationId is required.", 400);
  return {
    organizationId,
    userId: toId(source.userId),
    userRole: source.userRole || null,
    accountType: source.accountType || null,
    userEmail: source.userEmail || null,
  };
}
const can = (person, permission) => userHasPermission(db, person, permission);
const isManager = (person) => MANAGERS.has(String(person.userRole || person.accountType || "").trim().toLowerCase());

async function myClassIds(person) {
  if (!person.userId) return [];
  const { rows } = await db.query(
    `SELECT uc.class_id FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id
      WHERE uc.user_id = $1 AND c.organization_id = $2 AND c.obsolete_at IS NULL`,
    [person.userId, person.organizationId]
  );
  return rows.map((row) => Number(row.class_id));
}

async function classByName(organizationId, name) {
  const { rows } = await db.query(
    `SELECT class_id, class_name FROM classes WHERE organization_id = $1 AND obsolete_at IS NULL AND LOWER(class_name) = LOWER($2)`,
    [organizationId, String(name || "").trim()]
  );
  return rows[0] || null;
}

const reply = (handler) => async (req, res) => {
  try {
    return res.json(await handler(req));
  } catch (error) {
    if (error instanceof activities.ActivityError || error.status) return res.status(error.status || 400).json({ error: error.message });
    console.error("[internalDiscover]", error.message);
    return res.status(500).json({ error: "That couldn't be done just now." });
  }
};

// Described only when the school has it.
const NEW_THINGS = [
  { feature: "class_activities", title: "Class activities", what: "Teachers add field trips, clubs and other activities to a class, or for the whole school. Parents and students see them and get a notification.", where: "A class's Activities tab, or Management Tools, Activities (/common/activities)", who: "Teachers for their own classes; anyone with Publish Events & Announcements for the whole school" },
  { feature: "class_activities", title: "A calendar for everyone", what: "Parents see all their children's activities, classes, school events and work closing. Students see their own. Drivers see their bus runs. Anyone can add it to their own Google, Outlook or Apple calendar.", where: "Calendar in the menu (/guardian/calendar, /student/calendar, /common/calendar). Add to my calendar, or Sync & share for staff", who: "Everyone" },
  { feature: "parent_student_hub", title: "Parent student tiles", what: "Tapping a child opens tiles: academic info, schedule, calendar, activities, homework, testing room, assessment documents, transportation and messages.", where: "Parent portal, then the child's View button", who: "Parents" },
  { feature: "parent_student_hub", title: "Homework help for parents", what: "When setting up questions, a teacher can show them on the parent portal and attach notes and files, so parents can help. Parents only see what their child can already see.", where: "Assessment question setup, Show on parent portal", who: "Teachers" },
  { feature: "bus_boarding", title: "Bus boarding", what: "At each stop the driver sees All boarded or Except. If they do nothing, driving off counts everyone as boarded. Parents get a notification.", where: "Driver's trip screen", who: "Drivers; parents are told" },
  { feature: "bus_boarding", title: "Not coming today", what: "A parent can mark a child as not coming, and a teacher can mark a student from the class's Transportation tab. The driver's list updates. A parent can also ask to stop using the bus; that goes to the transport leads.", where: "Parent portal child card; class Transportation tab", who: "Parents and teachers" },
  { feature: "sso", title: "Single sign-on", what: "A school can have people sign in through its own provider, using SAML or OpenID Connect: Google Workspace, Microsoft Entra ID, Okta, OneLogin, ClassLink, Clever, JumpCloud, Ping, Auth0, AD FS, Shibboleth or any other. People choose Log in with SSO and enter their email. A manager sets it up and tests it before it can be turned on. It works for Mira too.", where: "Settings, Single sign-on (/account/settings)", who: "Managers with the Single Sign-On permission" },
  { feature: "smart_login", title: "One login page", what: "A parent, student or hub user who signs in on the main login page is taken to their own portal, once their password is confirmed.", where: "The main login page", who: "Parents, students and hub users" },
  { title: "Live bus tracking", what: "Parents, students and teachers see the bus moving on the map, with its real route through the stops and an arrival time. If the driver's phone goes quiet, the map says the position is estimated.", where: "Track bus on the parent or student page; a class's Transportation tab", who: "Parents, students and staff" },
  { title: "Driver reports", what: "Drivers report problems from their page. Leads decide who sees each report, and only reports about a student can be shared with that student's parents or teachers.", where: "Report on the driver's page; Transportation, Reports", who: "Drivers and transport leads" },
  { title: "Transportation in Report Builder", what: "Reports on trips, riders and drivers.", where: "Reports, Report Builder", who: "Anyone with Report Builder and transportation access" },
];

module.exports = {
  whatsNew: reply(async (req) => {
    const person = who(req.query);
    return {
      items: NEW_THINGS
        .filter((item) => !item.feature || features.isOn(item.feature, { organizationId: person.organizationId }))
        .map(({ title, what, where, who: forWhom }) => ({ title, what, where, who: forWhom })),
      note: "Only what this school has. Anything not listed isn't available to them yet.",
    };
  }),

  // ---------- activities ----------
  listActivities: reply(async (req) => {
    const person = who(req.query);
    if (!features.isOn("class_activities", { organizationId: person.organizationId })) return { available: false, activities: [] };
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? req.query.from : today();
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? req.query.to : addDays(from, 60);
    const seesAll = isManager(person) || await can(person, PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS);
    const named = req.query.className ? await classByName(person.organizationId, req.query.className) : null;
    if (req.query.className && !named) throw refuse(`There's no class named "${req.query.className}" in Managira.`, 404);
    const mine = seesAll ? null : await myClassIds(person);
    if (named && mine && !mine.includes(Number(named.class_id))) throw refuse("That's not one of your classes.");
    const list = await activities.listActivities(db, person.organizationId, { classIds: named ? [Number(named.class_id)] : mine, from, to });
    return {
      available: true,
      from, to,
      total: list.length,
      activities: list.slice(0, 100).map((row) => ({ title: row.title, class: row.className || "Whole school", date: row.date, endDate: row.endDate, startTime: row.startTime, endTime: row.endTime, location: row.location, details: row.details })),
    };
  }),

  createActivity: reply(async (req) => {
    const person = who(req.body);
    if (!features.isOn("class_activities", { organizationId: person.organizationId })) throw refuse("Activities aren't available for this school yet.");
    const named = req.body.className ? await classByName(person.organizationId, req.body.className) : null;
    if (req.body.className && !named) throw refuse(`There's no class named "${req.body.className}" in Managira.`, 404);
    const seesAll = isManager(person) || await can(person, PERMISSIONS.PUBLISH_EVENTS_ANNOUNCEMENTS);
    if (!seesAll) {
      if (!named) throw refuse("Only someone who publishes events can add a whole-school activity.");
      if (!(await myClassIds(person)).includes(Number(named.class_id))) throw refuse("You can only add activities for your own classes.");
    }
    const activity = activities.readActivity(req.body);
    const name = String(req.body.userName || "").trim() || "Mira";
    const id = await activities.saveActivity(db, person.organizationId, { userId: person.userId, name }, null, named ? Number(named.class_id) : null, activity);
    return { status: "created", id, title: activity.title, class: named ? named.class_name : "Whole school", date: activity.date };
  }),

  // ---------- who's riding ----------
  ridingToday: reply(async (req) => {
    const person = who(req.query);
    if (!features.isOn("bus_boarding", { organizationId: person.organizationId })) return { available: false };
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? req.query.date : today();
    const allBuses = isManager(person) || await can(person, PERMISSIONS.MANAGE_TRANSPORTATION);
    const reading = await transportBoarding.schoolDay(db, person.organizationId, day);
    let allowed = null;
    if (!allBuses) {
      const classes = await myClassIds(person);
      const { rows } = await db.query("SELECT student_id FROM students WHERE organization_id = $1 AND class_id = ANY($2::int[])", [person.organizationId, classes]);
      allowed = new Set(rows.map((row) => Number(row.student_id)));
    }
    const visible = (row) => !allowed || allowed.has(row.studentId);
    const notRiding = reading.notRiding.filter(visible);
    const ids = [...new Set(notRiding.map((row) => row.studentId))];
    const names = ids.length
      ? new Map((await db.query("SELECT student_id, first_name, last_name FROM students WHERE organization_id = $1 AND student_id = ANY($2::int[])", [person.organizationId, ids])).rows.map((row) => [Number(row.student_id), [row.first_name, row.last_name].filter(Boolean).join(" ")]))
      : new Map();
    const events = reading.events.filter(visible);
    return {
      available: true,
      date: day,
      notComing: notRiding.map((row) => ({ student: names.get(row.studentId) || "A student", markedBy: row.by === "parent" ? "Parent" : "Staff" })),
      boarded: events.filter((row) => row.boarded).length,
      didNotBoard: events.filter((row) => !row.boarded).map((row) => ({ student: row.name, stop: row.stop })),
    };
  }),

  // ---------- homework help ----------
  showWorkToParents: reply(async (req) => {
    const person = who(req.body);
    if (!features.isOn("parent_student_hub", { organizationId: person.organizationId })) throw refuse("This isn't available for this school yet.");
    const allowed = isManager(person) || await can(person, PERMISSIONS.SET_ASSESSMENT_QUESTIONS);
    if (!allowed) throw refuse("You need Set Assessment Questions to change this.");
    const id = toId(req.body.questionSetId);
    if (!id) throw refuse("Which question set? Use list_question_sets to find it.", 400);
    const current = await parentResources.readSettings(db, person.organizationId, id);
    if (!current) throw refuse("That question set isn't in Managira.", 404);
    const notes = req.body.notes === undefined ? current.notes : req.body.notes;
    await parentResources.saveSettings(db, person.organizationId, id, { show: req.body.show === true, notes });
    return { status: "saved", showOnParentPortal: req.body.show === true, notes: notes || "", files: current.files.length, attachFilesOn: "The question set's setup page, under Show on parent portal" };
  }),

  // ---------- single sign-on: read only, and never a secret ----------
  ssoStatus: reply(async (req) => {
    const person = who(req.query);
    if (!features.isOn("sso", { organizationId: person.organizationId })) return { available: false };
    if (!(await can(person, PERMISSIONS.MANAGE_SSO))) throw refuse("You need the Single Sign-On permission to see this.");
    const row = await ssoConnections.connectionFor(db, person.organizationId);
    const howTo = "A manager sets this up in Settings, Single sign-on. Mira can explain it, but only a manager can change it, there.";
    if (!row) return { available: true, setUp: false, howTo, settingsPage: "/account/settings" };
    const { rows } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE outcome = 'ok' AND kind = 'login')::int AS sign_ins, COUNT(*) FILTER (WHERE outcome = 'refused')::int AS refused
         FROM sso_events WHERE organization_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [person.organizationId]
    );
    return {
      available: true,
      setUp: true,
      provider: row.display_name,
      type: row.protocol === "saml" ? "SAML 2.0" : "OpenID Connect",
      status: row.status === "active" ? "On" : row.status === "tested" ? "Tested, not turned on yet" : "Off, needs a test",
      lastTested: row.tested_at,
      studentsToo: row.allow_students,
      singleSignOnOnly: row.require_sso,
      lastSevenDays: { signIns: rows[0].sign_ins, refused: rows[0].refused },
      howTo,
      settingsPage: "/account/settings",
    };
  }),
};
