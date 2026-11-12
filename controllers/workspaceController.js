// Calendar (school events, personal events, announcements, task due dates,
// connected Google/Outlook calendars, calendars shared by colleagues) and staff
// tasks with @mentions, replies and reactions.
// Pages: views/common/calendar.ejs and the "Activity & Announcements" card on
// views/common/orgDashboard.ejs.
const notifSvc = require("../utils/notificationService");
const { sendEmailSafely, renderCleanEmail, escapeHtml } = require("../utils/emailHelper");
const { broadcastEventAnnouncement } = require("../utils/notificationDigestService");
const {
  ensureWorkspaceSchema,
  REACTIONS,
  PRIORITIES,
  VISIBILITIES,
  PERSONAL,
  EVENT_COLORS,
  resolveActor,
  cleanText,
  parseDate,
  parseTime,
  parseIdList,
  filterStaffIds,
  baseUrl,
  isOrgMember,
} = require("../utils/workspace");
const { ensureFeedToken, buildIcs, normalizeIcsUrl, detectProvider, fetchIcs, importedEvents, lockSecret } = require("../utils/calendarSync");
const calConnect = require("../utils/calendarConnect");
const { lessonItems, tripItems } = require("../utils/lessonCalendar");
const features = require("../utils/shards/features");
const MANAGER_ROLES = new Set(["organization", "manager", "mini admin", "admin", "supervisor", "superviser"]);
const isManagerRole = (role) => MANAGER_ROLES.has(String(role || "").trim().toLowerCase());
const { listActivities } = require("../utils/classActivities");

const PLATFORM_ROLES = ["admin", "internal worker", "mini admin"];

const can = (res, key) => Array.isArray(res.locals.userPermissions) && res.locals.userPermissions.includes(key);
const fail = (res, status, error) => res.status(status).json({ success: false, error });
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || "A colleague";
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "");
const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const dateKey = (d) => {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

async function currentYearTerm(db, organizationId) {
  const r = await db.query(
    `SELECT sy.id AS school_year_id, t.term_id
       FROM school_years sy JOIN terms t ON t.school_year_id = sy.id
      WHERE sy.organization_id = $1 AND sy.current = TRUE AND t.current = TRUE
      LIMIT 1`,
    [organizationId]
  );
  return r.rows[0] || { school_year_id: null, term_id: null };
}

async function staffByIds(db, ids) {
  if (!ids.length) return [];
  const r = await db.query(`SELECT user_id, first_name, last_name, email FROM users WHERE user_id = ANY($1::int[])`, [ids]);
  return r.rows;
}

// Fire-and-forget email to staff; never blocks or fails the request.
function emailStaff(people, { subject, title, context, paragraphs, details, ctaUrl, ctaText }) {
  people.forEach((person) => {
    if (!person.email) return;
    const html = renderCleanEmail({
      title,
      greeting: `Hi ${escapeHtml(person.first_name || "there")},`,
      paragraphs,
      details: details || [],
      cta: ctaUrl ? { url: ctaUrl, text: ctaText || "Open Managira" } : null,
      noReply: true,
    });
    sendEmailSafely({ to: person.email, subject, html }, context || "Workspace").catch(() => {});
  });
}

// People who shared their calendar with this viewer.
async function sharedOwners(db, organizationId, viewerId) {
  if (!viewerId) return [];
  const r = await db.query(
    `SELECT s.owner_id, u.first_name, u.last_name
       FROM calendar_shares s JOIN users u ON u.user_id = s.owner_id
      WHERE s.organization_id = $1 AND s.viewer_id = $2
      ORDER BY u.first_name, u.last_name`,
    [organizationId, viewerId]
  );
  return r.rows.map((o) => ({ id: o.owner_id, name: fullName(o) }));
}

async function tagsFor(db, table, eventIds) {
  if (!eventIds.length) return new Map();
  const r = await db.query(
    `SELECT t.event_id, u.user_id, u.first_name, u.last_name
       FROM ${table} t JOIN users u ON u.user_id = t.user_id
      WHERE t.event_id = ANY($1::int[])
      ORDER BY u.first_name, u.last_name`,
    [eventIds]
  );
  const map = new Map();
  r.rows.forEach((row) => {
    if (!map.has(row.event_id)) map.set(row.event_id, []);
    map.get(row.event_id).push({ id: row.user_id, name: fullName(row) });
  });
  return map;
}

// Replace an event's tags and tell only the newly tagged people (in-app + email).
async function setTags(db, { req, table, organizationId, eventId, event, tagIds, actor }) {
  const staff = await filterStaffIds(db, organizationId, tagIds);
  const keep = staff.map((s) => s.user_id);
  const before = await db.query(`SELECT user_id FROM ${table} WHERE event_id = $1`, [eventId]);
  const had = new Set(before.rows.map((r) => r.user_id));
  await db.query(`DELETE FROM ${table} WHERE event_id = $1 AND NOT (user_id = ANY($2::int[]))`, [eventId, keep]);
  if (keep.length) {
    if (table === "school_event_tags") {
      await db.query(`INSERT INTO school_event_tags (event_id, user_id, organization_id) SELECT $1, unnest($2::int[]), $3 ON CONFLICT DO NOTHING`, [eventId, keep, organizationId]);
    } else {
      await db.query(`INSERT INTO personal_event_tags (event_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`, [eventId, keep]);
    }
  }
  const added = staff.filter((s) => !had.has(s.user_id) && s.user_id !== actor.id);
  if (!added.length) return;
  const when = [fmtDay(event.date), event.allDay ? "All day" : [fmtTime(event.startTime), fmtTime(event.endTime)].filter(Boolean).join(" – ")].filter(Boolean).join(" · ");
  const link = `/common/calendar?date=${event.date}`;
  notifSvc.createNotifications(db, added.map((s) => ({
    orgId: organizationId, recipientType: "staff", recipientId: s.user_id, type: "event_tagged",
    title: `${actor.name} added you to ${event.title}`, body: when, link, refId: eventId,
  })));
  emailStaff(added, {
    subject: `${actor.name} added you to "${event.title}" · ${fmtDay(event.date)}`,
    title: "You've been added to an event",
    context: "Calendar tag",
    paragraphs: [
      `${escapeHtml(actor.name)} added you to <strong>${escapeHtml(event.title)}</strong>.`,
      ...(event.details ? [escapeHtml(event.details).replace(/\n/g, "<br>")] : []),
    ],
    details: [
      { label: "When", value: escapeHtml(when) },
      ...(event.location ? [{ label: "Where", value: escapeHtml(event.location) }] : []),
    ],
    ctaUrl: baseUrl(req) + link,
    ctaText: "Open calendar",
  });
}

function readEventBody(body) {
  const date = parseDate(body.date);
  const allDay = body.allDay === true || body.allDay === "true" || body.allDay === "1" || body.allDay === "on";
  let endDate = parseDate(body.endDate) || date;
  if (date && endDate < date) endDate = date;
  const startTime = allDay ? null : parseTime(body.startTime);
  let endTime = allDay ? null : parseTime(body.endTime);
  if (!allDay && startTime && endTime && endDate === date && endTime <= startTime) endTime = null;
  const visibility = body.visibility === PERSONAL ? PERSONAL : (VISIBILITIES.includes(body.visibility) ? body.visibility : "org");
  return {
    title: cleanText(body.title, 200),
    details: cleanText(body.details, 5000),
    location: cleanText(body.location, 200),
    date,
    endDate,
    allDay: allDay || !startTime,
    startTime,
    endTime,
    visibility,
    color: EVENT_COLORS.includes(body.color) ? body.color : "teal",
    tagIds: parseIdList(body.tagIds),
    notifyByEmail: body.notifyByEmail === true || body.notifyByEmail === "true" || body.notifyByEmail === "1",
  };
}

function eventItem(row, { kind, tags, editable, layer, owner }) {
  const day = dateKey(row.event_date);
  const endDay = dateKey(row.end_date) || day;
  const timed = !row.all_day && row.start_time;
  return {
    id: `${kind}-${row.id}`,
    title: row.name || row.title,
    start: timed ? `${day}T${hhmm(row.start_time)}` : day,
    end: timed ? (row.end_time ? `${endDay}T${hhmm(row.end_time)}` : null) : addDays(endDay, 1),
    allDay: !timed,
    editable,
    classNames: ["cal-ev", `cal-ev--${row.color || "teal"}`, kind === "personal" ? "cal-ev--personal" : ""].filter(Boolean),
    extendedProps: {
      kind, layer, recordId: row.id, owner: owner || null,
      details: row.details || "", location: row.location || "",
      visibility: kind === "personal" ? PERSONAL : (row.visibility || "org"),
      color: row.color || "teal", date: day, endDate: endDay,
      startTime: hhmm(row.start_time), endTime: hhmm(row.end_time),
      tags: tags || [],
    },
  };
}

// All calendar items one person can see in a date range.
async function collectItems(db, { organizationId, actor, start, end, canPublish, seesAllClasses = canPublish, role = null }) {
  // Each query is a round trip to the database, so they all run at once. Only
  // personal events and tasks wait for the calendars shared with this person.
  const ownersP = sharedOwners(db, organizationId, actor.id);
  const afterOwners = (run) => ownersP.then((list) => run(list.map((o) => o.id)));
  const lessonsP = actor.id
    ? lessonItems(db, { organizationId, userId: actor.id, start, end }).catch((err) => {
      console.error("[Calendar] lessons failed:", err.message);
      return [];
    })
    : [];
  // Bus runs only while the school has transportation switched on.
  const tripsP = actor.id
    ? require("../utils/integrationSwitches").isOn(db, organizationId, "transportation")
      .then((on) => (on ? tripItems(db, { organizationId, userId: actor.id, start, end }) : []))
      .catch((err) => {
        console.error("[Calendar] trips failed:", err.message);
        return [];
      })
    : [];
  const eventsP = db.query(
    `SELECT id, name, event_date, end_date, start_time, end_time, all_day, location, color, details, visibility
       FROM school_events
      WHERE organization_id = $1 AND event_date IS NOT NULL
        AND event_date < $3::date AND COALESCE(end_date, event_date) >= $2::date
      ORDER BY event_date, start_time NULLS FIRST`,
    [organizationId, start, end]
  );
  const personalP = afterOwners((ownerIds) => db.query(
    `SELECT p.*, (p.owner_id = $4) AS mine,
            EXISTS (SELECT 1 FROM personal_event_tags t WHERE t.event_id = p.id AND t.user_id = $4) AS tagged
       FROM personal_events p
      WHERE p.organization_id = $1
        AND p.event_date < $3::date AND COALESCE(p.end_date, p.event_date) >= $2::date
        AND (p.owner_id = $4 OR p.owner_id = ANY($5::int[])
             OR EXISTS (SELECT 1 FROM personal_event_tags t WHERE t.event_id = p.id AND t.user_id = $4))`,
    [organizationId, start, end, actor.id, ownerIds]
  ));

  // Those who run the school see every class; a teacher sees their own classes and the
  // whole-school activities; anyone else sees the whole-school ones.
  const activitiesP = features.isOn("class_activities", { organizationId })
    ? (async () => {
      if (seesAllClasses || !actor.id) return listActivities(db, organizationId, { from: start, to: end });
      // Drivers are linked to classes for transport, not teaching.
      const mine = await db.query(
        `SELECT uc.class_id FROM user_classes uc JOIN users u ON u.user_id = uc.user_id WHERE uc.user_id = $1 AND u.account_type <> 'Driver'`,
        [actor.id]
      );
      return listActivities(db, organizationId, { classIds: mine.rows.map((row) => Number(row.class_id)), from: start, to: end });
    })()
    : [];
  // Birthdays: students in the person's classes (every class for those who run the school), and staff.
  const birthdaysP = actor.id
    ? require("../utils/birthdayCalendar").birthdayItems(db, { organizationId, userId: actor.id, role: role || (seesAllClasses ? "manager" : null), start, end }).catch((err) => {
      console.error("[Calendar] birthdays failed:", err.message);
      return [];
    })
    : [];
  // Announcements live on dashboards, not on the calendar.
  const [owners, events, personal, tasks, lessons, trips, eventTags, personalTags, activities, birthdays] = await Promise.all([
    ownersP,
    eventsP,
    personalP,
    afterOwners((ownerIds) => db.query(
      `SELECT t.task_id, t.title, t.details, t.due_date, t.due_time, t.priority, t.created_by, t.created_by_name, t.updated_at,
              me.status AS my_status,
              (SELECT COUNT(*)::int FROM org_task_assignees x WHERE x.task_id = t.task_id) AS assignees,
              (SELECT COUNT(*)::int FROM org_task_assignees x WHERE x.task_id = t.task_id AND x.status = 'done') AS done,
              (SELECT MIN(x.user_id) FROM org_task_assignees x WHERE x.task_id = t.task_id AND x.user_id = ANY($5::int[])) AS shared_owner
         FROM org_tasks t
         LEFT JOIN org_task_assignees me ON me.task_id = t.task_id AND me.user_id = $4
        WHERE t.organization_id = $1 AND t.due_date >= $2::date AND t.due_date < $3::date
          AND (t.created_by = $4 OR me.user_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM org_task_assignees x WHERE x.task_id = t.task_id AND x.user_id = ANY($5::int[])))`,
      [organizationId, start, end, actor.id, ownerIds]
    )),
    lessonsP,
    tripsP,
    // Tags load as soon as their events arrive.
    eventsP.then((r) => tagsFor(db, "school_event_tags", r.rows.map((e) => e.id))),
    personalP.then((r) => tagsFor(db, "personal_event_tags", r.rows.map((e) => e.id))),
    activitiesP,
    birthdaysP,
  ]);
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));

  const items = [];
  events.rows.forEach((e) => items.push(eventItem(e, { kind: "event", layer: "event", tags: eventTags.get(e.id), editable: canPublish })));
  activities.forEach((a) => items.push(eventItem({
    id: a.id, title: a.className ? `${a.title} (${a.className})` : a.title, event_date: a.date, end_date: a.endDate,
    start_time: a.startTime, end_time: a.endTime, all_day: !a.startTime, location: a.location, details: a.details, color: "green",
  }, { kind: "activity", layer: "event", tags: [], editable: false })));
  personal.rows.forEach((e) => {
    const shared = !e.mine && !e.tagged && ownerName.has(e.owner_id);
    items.push(eventItem(e, {
      kind: "personal",
      layer: e.mine ? "personal" : (shared ? `share-${e.owner_id}` : "personal"),
      owner: e.mine ? null : (e.owner_name || ownerName.get(e.owner_id) || null),
      tags: personalTags.get(e.id),
      editable: !!e.mine,
    }));
  });
  tasks.rows.forEach((t) => {
    const day = dateKey(t.due_date);
    const done = t.assignees > 0 && t.done === t.assignees;
    const mine = t.created_by === actor.id || !!t.my_status;
    items.push({
      id: `task-${t.task_id}`,
      title: t.title,
      start: t.due_time ? `${day}T${hhmm(t.due_time)}` : day,
      allDay: !t.due_time,
      editable: false,
      classNames: ["cal-ev", "cal-ev--task", done ? "is-done" : "", t.priority === "high" ? "is-high" : ""].filter(Boolean),
      extendedProps: {
        kind: "task", layer: mine ? "task" : `share-${t.shared_owner}`, recordId: t.task_id,
        owner: mine ? null : ownerName.get(t.shared_owner) || null,
        details: t.details || "", priority: t.priority, from: t.created_by_name || "",
        progress: `${t.done}/${t.assignees} done`, mine, myStatus: t.my_status || null,
        date: day, startTime: hhmm(t.due_time), updatedAt: t.updated_at,
      },
    });
  });

  // The viewer's lessons from the class timetables, and a driver's weekly bus runs.
  items.push(...lessons, ...trips, ...birthdays);
  return { items, owners };
}

// Google, Outlook and subscribed calendars come from outside services, so they load on their
// own: the calendar never waits for them, and one slow service can't hold up the others.
async function collectOutsideItems(db, { organizationId, actor, start, end, timeZone }) {
  if (!actor.id) return { items: [], errors: [] };
  await calConnect.ensureConnectSchema(db);
  // Connected Google and Outlook calendars only receive Managira's calendar: nothing is read
  // from them. Calendars subscribed by link earlier still show here.
  const imports = await db.query(`SELECT import_id, label, provider, url FROM calendar_imports WHERE organization_id = $1 AND user_id = $2`, [organizationId, actor.id]);
  const errors = [];
  const subscribed = imports.rows.map(async (imp) => {
    try {
      const ext = await importedEvents(imp, start, end, timeZone);
      ext.forEach((x) => { x.extendedProps.layer = `ext-${imp.import_id}`; });
      db.query(`UPDATE calendar_imports SET last_synced_at = NOW(), last_error = NULL WHERE import_id = $1`, [imp.import_id]).catch(() => {});
      return ext;
    } catch (err) {
      errors.push({ id: imp.import_id, label: imp.label, error: err.message });
      db.query(`UPDATE calendar_imports SET last_error = $2 WHERE import_id = $1`, [imp.import_id, String(err.message).slice(0, 300)]).catch(() => {});
      return [];
    }
  });
  const lists = await Promise.all(subscribed);
  return { items: lists.flat(), errors };
}

async function canEditPersonal(db, organizationId, id, actorId) {
  const r = await db.query(`SELECT owner_id FROM personal_events WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
  if (!r.rowCount) return null;
  return r.rows[0].owner_id === actorId;
}

// ---------- Google / Outlook push ----------
const PROVIDER_LABEL = { google: "Google Calendar", outlook: "Outlook" };

// Who a connection belongs to, and what their own calendar page shows them: a member of staff,
// or the school signed in as itself (its connection's person is the school's own id).
async function syncActor(db, conn) {
  const staffRow = (await db.query(
    `SELECT u.first_name, u.last_name, u.email, u.account_type::text AS account_type, o.organization_name
       FROM users u JOIN organizations o ON o.organization_id = u.organization_id
      WHERE u.user_id = $1 AND u.organization_id = $2 AND u.removed_at IS NULL AND NOT COALESCE(u.on_hold, FALSE)`,
    [conn.user_id, conn.organization_id]
  )).rows[0];
  const { userHasPermission, isManagerRole } = require("../middleware/permissionMiddleware");
  if (staffRow) {
    const who = { userId: conn.user_id, userRole: staffRow.account_type, accountType: staffRow.account_type, organizationId: conn.organization_id, userEmail: staffRow.email };
    const canPublish = await userHasPermission(db, who, "publish_events_announcements").catch(() => false);
    return {
      actor: { id: conn.user_id, name: fullName(staffRow) },
      orgName: staffRow.organization_name,
      canPublish,
      seesAllClasses: canPublish || isManagerRole(staffRow.account_type),
      role: staffRow.account_type,
    };
  }
  if (Number(conn.user_id) !== Number(conn.organization_id)) return null;
  const school = (await db.query("SELECT organization_name, first_name, last_name FROM organizations WHERE organization_id = $1", [conn.organization_id])).rows[0];
  if (!school) return null;
  return { actor: { id: conn.user_id, name: fullName(school) || school.organization_name }, orgName: school.organization_name, canPublish: true, seesAllClasses: true, role: "Organization" };
}

// Everything on the person's Managira calendar goes to their Managira calendar over there:
// school events and activities, their personal events and tasks, and their classes, bus runs
// and birthdays for the coming weeks. Calendars shared with them stay in Managira.
const SYNC_BACK_DAYS = 120;
const SYNC_AHEAD_DAYS = 365;
const ROUTINE_BACK_DAYS = 7; // classes and bus runs repeat every week: just the weeks around now
const ROUTINE_AHEAD_DAYS = 56;
function itemsToSend(items, site) {
  const today = Date.now();
  const routineFrom = dateKey(new Date(today - ROUTINE_BACK_DAYS * 864e5));
  const routineTo = dateKey(new Date(today + ROUTINE_AHEAD_DAYS * 864e5));
  return items
    .filter((it) => !String((it.extendedProps || {}).layer || "").startsWith("share-"))
    .map((it) => {
      const p = it.extendedProps || {};
      const timed = !it.allDay;
      // Birthdays the person sees (students in their classes, and staff), for the coming weeks:
      // the name and class or role, never the age.
      if (p.kind === "birthday") {
        if (p.date < routineFrom || p.date > routineTo) return null;
        const about = String(p.details || "").replace(/\s*·\s*Turns \d+\s*$/, "");
        return { uid: `birthday-${p.recordId}-${String(p.date).slice(0, 4)}`, title: it.title, details: about, location: "", date: p.date, endDate: p.date, startTime: null, endTime: null, allDay: true, url: `${site}/common/calendar?date=${p.date}` };
      }
      if (p.kind === "lesson" || p.kind === "trip") {
        if (p.date < routineFrom || p.date > routineTo) return null;
        return {
          uid: `${p.kind}-${p.recordId}`, title: it.title, details: p.details, location: p.location,
          date: p.date, endDate: p.date, startTime: p.startTime, endTime: p.endTime, allDay: !p.startTime,
          url: p.kind === "lesson" ? `${site}/common/classDashboard/${p.classId}` : `${site}/driver/dashboard`,
        };
      }
      if (!["event", "activity", "personal", "task"].includes(p.kind)) return null;
      return {
        uid: `${p.kind}-${p.recordId}`,
        title: p.kind === "task" ? `Task: ${it.title}` : it.title,
        details: p.details, location: p.location,
        date: p.date, endDate: p.kind === "task" ? p.date : p.endDate,
        startTime: timed ? p.startTime : null, endTime: timed ? p.endTime : null, allDay: !timed,
        url: p.kind === "task" ? `${site}/common/orgDashboard#task-${p.recordId}` : `${site}/common/calendar?date=${p.date}`,
      };
    })
    .filter((item) => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")));
}

// One sync per calendar at a time (on every server): two at once would both add the same items.
// The second waits its turn and starts from what the first saved, so it never makes a second
// Managira calendar or a duplicate event.
async function syncConnection(db, conn, siteUrl) {
  const { waitForAdvisoryLock } = require("../utils/dbLock");
  try {
    await waitForAdvisoryLock(`calendar-sync:${conn.connection_id}`, () => syncConnectionNow(db, conn.connection_id, siteUrl), { database: db, timeoutMs: 180000, pollMs: 750 });
  } catch (err) {
    console.error(`[Calendar] sync for connection ${conn.connection_id} didn't run:`, err.message);
  }
}

async function syncConnectionNow(db, connectionId, siteUrl) {
  const conn = (await db.query(`SELECT * FROM calendar_connections WHERE connection_id = $1`, [connectionId])).rows[0];
  if (!conn) return;
  const who = await syncActor(db, conn);
  if (!who) return;
  const start = dateKey(new Date(Date.now() - SYNC_BACK_DAYS * 864e5));
  const end = dateKey(new Date(Date.now() + SYNC_AHEAD_DAYS * 864e5));
  const { items } = await collectItems(db, { organizationId: conn.organization_id, actor: who.actor, start, end, canPublish: who.canPublish, seesAllClasses: who.seesAllClasses, role: who.role });
  const site = siteUrl || process.env.BASE_URL_PRODUCTION || "https://managira.com";
  const push = itemsToSend(items, site);
  try {
    await calConnect.pushItems(db, conn, push, who.orgName);
    await db.query(`UPDATE calendar_connections SET last_synced_at = NOW(), last_error = NULL WHERE connection_id = $1`, [conn.connection_id]);
  } catch (err) {
    const msg = calConnect.friendlyError(err);
    console.error(`[Calendar] ${conn.provider} sync failed for user ${conn.user_id}:`, msg);
    await db.query(`UPDATE calendar_connections SET last_error = $2 WHERE connection_id = $1`, [conn.connection_id, msg]).catch(() => {});
  }
}

// Mira: something on the person's own calendar (a meeting, an appointment, a reminder). It's a
// personal event, the same as one made on the calendar page, and it goes to their Google
// Calendar or Outlook too.
async function addPersonalEvent(db, { organizationId, actor, body, siteUrl = null }) {
  await ensureWorkspaceSchema(db);
  const e = readEventBody({ ...(body || {}), visibility: PERSONAL });
  if (!e.title) { const err = new Error("Say what to put on the calendar."); err.status = 400; throw err; }
  if (!e.date) { const err = new Error("Give the date as YYYY-MM-DD."); err.status = 400; throw err; }
  const r = await db.query(
    `INSERT INTO personal_events (organization_id, owner_id, owner_name, title, details, event_date, end_date, start_time, end_time, all_day, location, color)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [organizationId, actor.id, actor.name, e.title, e.details, e.date, e.endDate, e.startTime, e.endTime, e.allDay, e.location || null, e.color]
  );
  scheduleOrgSync(db, organizationId, siteUrl);
  return { id: r.rows[0].id, title: e.title, date: e.date, endDate: e.endDate !== e.date ? e.endDate : null, startTime: e.startTime, endTime: e.endTime, allDay: e.allDay, location: e.location || null };
}

// Mira: the free times on the person's own calendar, day by day, within working hours. Anything
// with a time blocks it (events, classes, bus runs, their personal events and timed tasks);
// all-day items are listed for the day so nobody books over a holiday without seeing it.
const toMinutes = (hhmmText) => { const [h, m] = String(hhmmText || "").split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
const toClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
// The free times in a list of calendar items, day by day within working hours.
function freeSlots(items, { start, days = 5, dayStart = "08:00", dayEnd = "17:00", minutes = 30 }) {
  const from = toMinutes(dayStart);
  const to = toMinutes(dayEnd);
  if (from === null || to === null || to <= from) { const err = new Error("Give working hours like 08:00 to 17:00."); err.status = 400; throw err; }
  const span = Math.min(Math.max(Number(days) || 1, 1), 14);
  const need = Math.min(Math.max(Number(minutes) || 30, 5), 600);
  const out = [];
  for (let i = 0; i < span; i += 1) {
    const day = addDays(start, i);
    const busy = [];
    const allDay = [];
    items.forEach((it) => {
      const p = it.extendedProps || {};
      const first = p.date || String(it.start || "").slice(0, 10);
      const last = p.endDate || first;
      if (day < first || day > last || String(p.layer || "").startsWith("share-")) return;
      if (it.allDay || !p.startTime) {
        if (p.kind !== "birthday") allDay.push(it.title);
        return;
      }
      const begins = first === day ? toMinutes(p.startTime) : 0;
      if (begins === null) return;
      const finishes = last === day ? (toMinutes(p.endTime) ?? begins + (p.kind === "task" ? 30 : 60)) : 24 * 60;
      busy.push([begins, Math.max(finishes, begins + 15), it.title]);
    });
    busy.sort((a, b) => a[0] - b[0]);
    const free = [];
    let cursor = from;
    busy.forEach(([b, f]) => {
      if (b > cursor && Math.min(b, to) - cursor >= need) free.push({ from: toClock(cursor), to: toClock(Math.min(b, to)) });
      cursor = Math.max(cursor, f);
    });
    if (to - cursor >= need) free.push({ from: toClock(cursor), to: toClock(to) });
    const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    out.push({ date: day, weekday, free, busy: busy.map(([b, f, title]) => ({ from: toClock(b), to: toClock(Math.min(f, 24 * 60 - 1)), title })), allDay });
  }
  return { from: start, to: addDays(start, span - 1), workingHours: `${toClock(from)}-${toClock(to)}`, minutesNeeded: need, days: out };
}

async function freeTime(db, { organizationId, actor, role, seesAllClasses, start, days = 5, dayStart = "08:00", dayEnd = "17:00", minutes = 30 }) {
  const span = Math.min(Math.max(Number(days) || 1, 1), 14);
  const { items } = await collectItems(db, { organizationId, actor, start, end: addDays(start, span), canPublish: false, seesAllClasses, role });
  return freeSlots(items, { start, days: span, dayStart, dayEnd, minutes });
}

// Re-sync everyone connected in an organization a few seconds after a change.
const pendingOrgSync = new Map();
let lastSiteUrl = null;
function scheduleOrgSync(db, organizationId, siteUrl) {
  if (siteUrl) lastSiteUrl = siteUrl;
  clearTimeout(pendingOrgSync.get(organizationId));
  pendingOrgSync.set(organizationId, setTimeout(async () => {
    pendingOrgSync.delete(organizationId);
    try {
      await calConnect.ensureConnectSchema(db);
      const conns = await db.query(`SELECT * FROM calendar_connections WHERE organization_id = $1`, [organizationId]);
      for (const conn of conns.rows) await syncConnection(db, conn, lastSiteUrl);
    } catch (err) { console.error("[Calendar] org sync failed:", err.message); }
  }, 4000));
}

// Every 10 minutes (jobs/scheduler.js, one server at a time): each connected calendar gets what
// changed, wherever the change was made, including after a restart. Unchanged items cost nothing;
// an account whose access ended waits until its owner connects it again.
async function runCalendarSyncSweep(db, { limit = 300 } = {}) {
  await calConnect.ensureConnectSchema(db);
  const { rows } = await db.query(
    `SELECT * FROM calendar_connections
      WHERE last_error IS DISTINCT FROM 'reconnect'
      ORDER BY last_synced_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  for (const conn of rows) await syncConnection(db, conn).catch(() => {});
  return rows.length;
}


module.exports = {
  // GET /common/calendar
  calendarPage: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const features = Array.isArray(res.locals.allowedFeatures) ? res.locals.allowedFeatures : [];
      res.render("common/calendar", {
        title: "Calendar",
        // "Connected" (or what went wrong) after coming back from Google or Microsoft.
        messages: req.flash(),
        canPublish: can(res, "publish_events_announcements") && await isOrgMember(db, req),
        hasWebsite: features.includes("School Website") || features.includes("SchoolWebsite"),
        initialDate: parseDate(req.query.date) || "",
        initialCompose: ["event", "announcement", "task"].includes(req.query.new) ? req.query.new : "",
        openSync: req.query.sync === "1",
        isMember: await isOrgMember(db, req),
        actor: resolveActor(req),
      });
    } catch (err) {
      console.error("[Calendar] page failed:", err.message);
      req.flash("error", "The calendar could not load. Please try again.");
      res.redirect("/common/orgDashboard");
    }
  },

  // GET /common/calendar/feed?start=&end=
  calendarFeed: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const start = parseDate(String(req.query.start || "").slice(0, 10)) || dateKey(new Date(Date.now() - 45 * 864e5));
      const end = parseDate(String(req.query.end || "").slice(0, 10)) || dateKey(new Date(Date.now() + 45 * 864e5));
      const { items } = await collectItems(db, {
        organizationId: Number(req.session.organizationId),
        actor: resolveActor(req),
        start, end,
        canPublish: can(res, "publish_events_announcements"),
        seesAllClasses: can(res, "publish_events_announcements") || isManagerRole(req.session.userRole || req.session.accountType),
        role: req.session.accountType === "Organization" ? "Organization" : (req.session.userRole || req.session.accountType),
      });
      res.json(items);
    } catch (err) {
      console.error("[Calendar] feed failed:", err.message);
      fail(res, 500, "Could not load the calendar.");
    }
  },

  // GET /common/calendar/feed/outside?start=&end=&tz= (Google, Outlook, subscribed calendars)
  calendarOutsideFeed: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const start = parseDate(String(req.query.start || "").slice(0, 10)) || dateKey(new Date(Date.now() - 45 * 864e5));
      const end = parseDate(String(req.query.end || "").slice(0, 10)) || dateKey(new Date(Date.now() + 45 * 864e5));
      const { items, errors } = await collectOutsideItems(db, {
        organizationId: Number(req.session.organizationId),
        actor: resolveActor(req),
        start, end,
        timeZone: String(req.query.tz || "").slice(0, 64) || "UTC",
      });
      res.json({ success: true, items, errors });
    } catch (err) {
      console.error("[Calendar] outside feed failed:", err.message);
      res.json({ success: false, items: [], errors: [] });
    }
  },

  // POST /common/calendar/sync/reset: the old private link stops working at once.
  resetFeedLink: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const actor = resolveActor(req);
      if (!actor.id) return fail(res, 400, "Calendar sync needs a staff account.");
      const token = await ensureFeedToken(db, Number(req.session.organizationId), actor.id, { reset: true });
      const feedUrl = `${baseUrl(req)}/calendar/ics/${token}.ics`;
      res.json({ success: true, feedUrl, webcalUrl: feedUrl.replace(/^https?:\/\//, "webcal://") });
    } catch (err) {
      console.error("[Calendar] reset link failed:", err.message);
      fail(res, 500, "Could not make a new link.");
    }
  },

  // POST /common/calendar/events  and  /common/calendar/events/:id   (school events)
  // POST /common/calendar/personal and /common/calendar/personal/:id (personal events)
  saveEvent: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const organizationId = Number(req.session.organizationId);
      const actor = resolveActor(req);
      const isPersonalRoute = req.path.includes("/personal");
      const id = req.params.id ? Number(req.params.id) : null;
      const e = readEventBody(req.body || {});
      const personal = isPersonalRoute || (!id && e.visibility === PERSONAL);
      if (!personal && !can(res, "publish_events_announcements")) return fail(res, 403, "You can add personal events. School events need the Events & Announcements permission.");
      if (personal && id) {
        const owner = await canEditPersonal(db, organizationId, id, actor.id);
        if (owner === null) return fail(res, 404, "Event not found.");
        if (!owner) return fail(res, 403, "Only the person who created this event can change it.");
      }

      // Drag/resize on the calendar sends only the new dates/times.
      if (id && req.body.moveOnly) {
        const table = personal ? "personal_events" : "school_events";
        const r = await db.query(
          `UPDATE ${table} SET event_date = $3, end_date = $4, start_time = $5, end_time = $6, all_day = $7${personal ? ", updated_at = NOW()" : ""}
            WHERE id = $1 AND organization_id = $2 RETURNING id`,
          [id, organizationId, e.date, e.endDate, e.startTime, e.endTime, e.allDay]
        );
        if (!r.rowCount) return fail(res, 404, "Event not found.");
        scheduleOrgSync(db, organizationId, baseUrl(req));
        return res.json({ success: true, id });
      }

      if (!e.title) return fail(res, 400, "Give the event a title.");
      if (!e.date) return fail(res, 400, "Pick a date for the event.");

      let eventId = id;
      if (personal) {
        if (id) {
          await db.query(
            `UPDATE personal_events SET title = $3, details = $4, event_date = $5, end_date = $6, start_time = $7, end_time = $8,
                    all_day = $9, location = $10, color = $11, updated_at = NOW()
              WHERE id = $1 AND organization_id = $2`,
            [id, organizationId, e.title, e.details, e.date, e.endDate, e.startTime, e.endTime, e.allDay, e.location || null, e.color]
          );
        } else {
          const r = await db.query(
            `INSERT INTO personal_events (organization_id, owner_id, owner_name, title, details, event_date, end_date, start_time, end_time, all_day, location, color)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [organizationId, actor.id, actor.name, e.title, e.details, e.date, e.endDate, e.startTime, e.endTime, e.allDay, e.location || null, e.color]
          );
          eventId = r.rows[0].id;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "tagIds")) {
          await setTags(db, { req, table: "personal_event_tags", organizationId, eventId, event: e, tagIds: e.tagIds, actor });
        }
      scheduleOrgSync(db, Number(req.session.organizationId), baseUrl(req));
        return res.json({ success: true, id: eventId, kind: "personal" });
      }

      if (id) {
        const r = await db.query(
          `UPDATE school_events
              SET name = $3, details = $4, event_date = $5, end_date = $6, start_time = $7, end_time = $8,
                  all_day = $9, location = $10, color = $11, visibility = $12
            WHERE id = $1 AND organization_id = $2 RETURNING id`,
          [id, organizationId, e.title, e.details, e.date, e.endDate, e.startTime, e.endTime, e.allDay, e.location || null, e.color, e.visibility]
        );
        if (!r.rowCount) return fail(res, 404, "Event not found.");
      } else {
        const { school_year_id, term_id } = await currentYearTerm(db, organizationId);
        const r = await db.query(
          `INSERT INTO school_events
             (name, details, event_date, end_date, start_time, end_time, all_day, location, color, visibility,
              organization_id, school_year_id, term_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [e.title, e.details, e.date, e.endDate, e.startTime, e.endTime, e.allDay, e.location || null, e.color, e.visibility,
            organizationId, school_year_id, term_id, actor.id || null]
        );
        eventId = r.rows[0].id;
        // Same broadcasts as the existing Events & Announcements page (staff aren't told of website-only items).
        if (e.visibility !== "public") notifSvc.createNotification(db, {
          orgId: organizationId, recipientType: "broadcast", recipientId: 0, type: "event_created",
          title: e.title, body: e.details || "", link: `/common/calendar?date=${e.date}`,
        }).catch(() => {});
        if (e.notifyByEmail) {
          broadcastEventAnnouncement(db, {
            organizationId, contentType: "event", visibility: e.visibility, title: e.title,
            body: e.details, eventDate: e.date, contentId: eventId,
          }).catch((err) => console.error("[Calendar] event email broadcast failed:", err.message));
        }
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "tagIds")) {
        await setTags(db, { req, table: "school_event_tags", organizationId, eventId, event: e, tagIds: e.tagIds, actor });
      }
      scheduleOrgSync(db, Number(req.session.organizationId), baseUrl(req));
      res.json({ success: true, id: eventId, kind: "event" });
    } catch (err) {
      console.error("[Calendar] save event failed:", err.message);
      fail(res, 500, "Could not save the event.");
    }
  },

  // POST /common/calendar/events/:id/delete  and  /common/calendar/personal/:id/delete
  deleteEvent: async (req, res, db) => {
    try {
      const organizationId = Number(req.session.organizationId);
      const id = Number(req.params.id);
      if (req.path.includes("/personal")) {
        const owner = await canEditPersonal(db, organizationId, id, resolveActor(req).id);
        if (owner === null) return fail(res, 404, "Event not found.");
        if (!owner) return fail(res, 403, "Only the person who created this event can delete it.");
        await db.query(`DELETE FROM personal_events WHERE id = $1`, [id]);
        scheduleOrgSync(db, organizationId, baseUrl(req));
        return res.json({ success: true });
      }
      if (!can(res, "publish_events_announcements")) return fail(res, 403, "You don't have permission to manage events.");
      const r = await db.query(`DELETE FROM school_events WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
      if (!r.rowCount) return fail(res, 404, "Event not found.");
      scheduleOrgSync(db, organizationId, baseUrl(req));
      res.json({ success: true });
    } catch (err) {
      console.error("[Calendar] delete event failed:", err.message);
      fail(res, 500, "Could not delete the event.");
    }
  },

  // POST /common/calendar/announcements
  createAnnouncement: async (req, res, db) => {
    if (!can(res, "publish_events_announcements")) return fail(res, 403, "You don't have permission to post announcements.");
    try {
      const organizationId = Number(req.session.organizationId);
      const message = cleanText(req.body.message, 5000);
      if (!message) return fail(res, 400, "Write the announcement first.");
      const visibility = VISIBILITIES.includes(req.body.visibility) ? req.body.visibility : "org";
      const notifyByEmail = req.body.notifyByEmail === true || req.body.notifyByEmail === "true";
      const { school_year_id, term_id } = await currentYearTerm(db, organizationId);
      const r = await db.query(
        `INSERT INTO announcements (message, visibility, organization_id, school_year_id, term_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING announcement_id`,
        [message, visibility, organizationId, school_year_id, term_id]
      );
      if (visibility !== "public") notifSvc.createNotification(db, {
        orgId: organizationId, recipientType: "broadcast", recipientId: 0, type: "announcement_created",
        title: message.slice(0, 80), body: "", link: "/common/orgDashboard",
      }).catch(() => {});
      if (notifyByEmail) {
        broadcastEventAnnouncement(db, {
          organizationId, contentType: "announcement", visibility, title: message.slice(0, 80), body: message,
          contentId: r.rows[0].announcement_id,
        }).catch((err) => console.error("[Calendar] announcement email broadcast failed:", err.message));
      }
      res.json({ success: true, id: r.rows[0].announcement_id });
    } catch (err) {
      console.error("[Calendar] create announcement failed:", err.message);
      fail(res, 500, "Could not post the announcement.");
    }
  },

  // GET /common/calendar/sync — feed link, connected calendars, sharing.
  syncSettings: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const organizationId = Number(req.session.organizationId);
      const actor = resolveActor(req);
      if (!actor.id) return fail(res, 400, "Calendar sync needs a staff account.");
      const token = await ensureFeedToken(db, organizationId, actor.id);
      const [imports, shares, owners] = await Promise.all([
        db.query(`SELECT import_id, label, provider, last_error, last_synced_at FROM calendar_imports WHERE organization_id = $1 AND user_id = $2 ORDER BY created_at`, [organizationId, actor.id]),
        db.query(`SELECT viewer_id FROM calendar_shares WHERE organization_id = $1 AND owner_id = $2`, [organizationId, actor.id]),
        sharedOwners(db, organizationId, actor.id),
      ]);
      await calConnect.ensureConnectSchema(db);
      const connections = await db.query(
        `SELECT c.connection_id, c.provider, c.account_email, c.last_synced_at, c.last_error,
                (SELECT COUNT(*)::int FROM calendar_push_map m WHERE m.connection_id = c.connection_id) AS items
           FROM calendar_connections c
          WHERE c.organization_id = $1 AND c.user_id = $2
          ORDER BY c.provider, c.created_at`,
        [organizationId, actor.id]
      );
      // Nothing syncs because this page opened: changes go out in the background as they happen.
      const feedUrl = `${baseUrl(req)}/calendar/ics/${token}.ics`;
      res.json({
        success: true,
        feedUrl,
        webcalUrl: feedUrl.replace(/^https?:\/\//, "webcal://"),
        imports: imports.rows,
        sharedWith: shares.rows.map((r) => r.viewer_id),
        sharedWithMe: owners,
        connections: connections.rows,
        providers: calConnect.providersConfigured(),
      });
    } catch (err) {
      console.error("[Calendar] sync settings failed:", err.message);
      fail(res, 500, "Could not load sync settings.");
    }
  },

  // POST /common/calendar/imports { url, label }
  addImport: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const organizationId = Number(req.session.organizationId);
      const actor = resolveActor(req);
      if (!actor.id) return fail(res, 400, "Calendar sync needs a staff account.");
      const url = normalizeIcsUrl(req.body.url);
      if (!url) return fail(res, 400, "Paste the secret iCal address (it starts with https:// or webcal://).");
      const count = await db.query(`SELECT COUNT(*)::int AS n FROM calendar_imports WHERE organization_id = $1 AND user_id = $2`, [organizationId, actor.id]);
      if (count.rows[0].n >= 5) return fail(res, 400, "You can connect up to 5 calendars.");
      try { await fetchIcs(url); } catch (err) {
        const why = String(err.message || "").replace(/^Request failed with status code/, "the server answered").replace(/\.+$/, "");
        return fail(res, 400, `We couldn't read that calendar (${why}). Check the link and that the calendar is shared as iCal.`);
      }
      const provider = detectProvider(url);
      const label = cleanText(req.body.label, 80) || ({ google: "Google Calendar", outlook: "Outlook", apple: "Apple Calendar" }[provider] || "My calendar");
      const r = await db.query(
        `INSERT INTO calendar_imports (organization_id, user_id, label, provider, url, last_synced_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING import_id`,
        [organizationId, actor.id, label, provider, lockSecret(url)]
      );
      res.json({ success: true, id: r.rows[0].import_id });
    } catch (err) {
      console.error("[Calendar] add import failed:", err.message);
      fail(res, 500, "Could not connect that calendar.");
    }
  },

  // POST /common/calendar/imports/:id/delete
  removeImport: async (req, res, db) => {
    try {
      await db.query(`DELETE FROM calendar_imports WHERE import_id = $1 AND organization_id = $2 AND user_id = $3`, [Number(req.params.id), Number(req.session.organizationId), resolveActor(req).id]);
      res.json({ success: true });
    } catch (err) {
      fail(res, 500, "Could not disconnect that calendar.");
    }
  },

  // POST /common/calendar/shares { viewerIds }
  saveShares: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const organizationId = Number(req.session.organizationId);
      const actor = resolveActor(req);
      if (!actor.id) return fail(res, 400, "Calendar sharing needs a staff account.");
      const viewers = (await filterStaffIds(db, organizationId, parseIdList(req.body.viewerIds))).filter((v) => v.user_id !== actor.id);
      const ids = viewers.map((v) => v.user_id);
      const before = await db.query(`SELECT viewer_id FROM calendar_shares WHERE owner_id = $1`, [actor.id]);
      const had = new Set(before.rows.map((r) => r.viewer_id));
      await db.query(`DELETE FROM calendar_shares WHERE owner_id = $1 AND NOT (viewer_id = ANY($2::int[]))`, [actor.id, ids]);
      if (ids.length) {
        await db.query(`INSERT INTO calendar_shares (organization_id, owner_id, viewer_id) SELECT $1, $2, unnest($3::int[]) ON CONFLICT DO NOTHING`, [organizationId, actor.id, ids]);
      }
      const added = viewers.filter((v) => !had.has(v.user_id));
      if (added.length) {
        const link = "/common/calendar";
        notifSvc.createNotifications(db, added.map((v) => ({
          orgId: organizationId, recipientType: "staff", recipientId: v.user_id, type: "calendar_shared",
          title: `${actor.name} shared their calendar with you`, body: "Open the calendar to see it.", link,
        })));
        emailStaff(added, {
          subject: `${actor.name} shared their calendar with you`,
          title: "A calendar was shared with you",
          context: "Calendar share",
          paragraphs: [`${escapeHtml(actor.name)} shared their Managira calendar with you. You'll now see their personal events and tasks in your calendar.`],
          ctaUrl: baseUrl(req) + link,
          ctaText: "Open calendar",
        });
      }
      res.json({ success: true, sharedWith: ids });
    } catch (err) {
      console.error("[Calendar] save shares failed:", err.message);
      fail(res, 500, "Could not update sharing.");
    }
  },

  // GET /calendar/ics/:token.ics — private subscription feed for Google/Outlook/Apple (no login).
  icsFeed: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const token = String(req.params.token || "");
      if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).send("Not found");
      const t = await db.query(
        `SELECT f.organization_id, f.user_id, u.first_name, u.last_name, o.organization_name
           FROM calendar_feed_tokens f
           JOIN users u ON u.user_id = f.user_id AND u.organization_id = f.organization_id
           JOIN organizations o ON o.organization_id = f.organization_id
          WHERE f.token = $1 AND NOT COALESCE(u.on_hold, FALSE)`,
        [token]
      );
      if (!t.rowCount) return res.status(404).send("Not found");
      const row = t.rows[0];
      const actor = { id: row.user_id, name: fullName(row) };
      const start = dateKey(new Date(Date.now() - 60 * 864e5));
      const end = dateKey(new Date(Date.now() + 365 * 864e5));
      const { items } = await collectItems(db, { organizationId: row.organization_id, actor, start, end, canPublish: false });
      const site = baseUrl(req);
      const ics = buildIcs(
        items
          .filter((it) => ["event", "personal", "task", "lesson", "trip", "activity"].includes(it.extendedProps.kind) && !String(it.extendedProps.layer || "").startsWith("share-"))
          .map((it) => {
            const p = it.extendedProps;
            const timed = !it.allDay;
            if (p.kind === "lesson" || p.kind === "trip") {
              return {
                uid: `${p.kind}-${p.recordId}`, title: it.title, details: p.details, location: p.location,
                date: p.date, endDate: p.date, startTime: p.startTime, endTime: p.endTime, allDay: false,
                url: p.kind === "lesson" ? `${site}/common/classDashboard/${p.classId}` : `${site}/driver/dashboard`,
              };
            }
            return {
              uid: `${p.kind}-${p.recordId}`,
              title: p.kind === "task" ? `Task: ${it.title}` : it.title,
              details: p.details,
              location: p.location,
              date: p.date,
              endDate: p.kind === "task" ? p.date : p.endDate,
              startTime: timed ? p.startTime : null,
              endTime: timed ? p.endTime : null,
              allDay: !timed,
              url: p.kind === "task" ? `${site}/common/orgDashboard#task-${p.recordId}` : `${site}/common/calendar?date=${p.date}`,
              updatedAt: p.updatedAt || null,
            };
          }),
        { name: `${row.organization_name || "Managira"} · ${actor.name}`, host: req.get("host") || "managira" }
      );
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Cache-Control", "private, max-age=900");
      res.set("Content-Disposition", 'inline; filename="managira.ics"');
      res.send(ics);
    } catch (err) {
      console.error("[Calendar] ics feed failed:", err.message);
      res.status(500).send("Calendar unavailable");
    }
  },

  // GET /common/workspace/staff — people you can tag, assign or share with.
  staffDirectory: async (req, res, db) => {
    try {
      const r = await db.query(
        `SELECT user_id, first_name, last_name, account_type::text AS role,
                COALESCE(NULLIF(profile_image_url, ''), NULLIF(image_url, '')) AS image
           FROM users
          WHERE organization_id = $1
            AND NOT COALESCE(on_hold, FALSE)
            AND LOWER(COALESCE(account_type::text, '')) <> ALL($2::text[])
          ORDER BY first_name, last_name
          LIMIT 500`,
        [Number(req.session.organizationId), PLATFORM_ROLES]
      );
      const actor = resolveActor(req);
      res.json(r.rows.map((u) => ({
        id: u.user_id,
        name: fullName(u),
        first: u.first_name || "",
        role: u.role || "",
        image: u.image && !/placeholder/i.test(u.image) ? u.image : null,
        me: u.user_id === actor.id,
      })));
    } catch (err) {
      console.error("[Workspace] staff directory failed:", err.message);
      fail(res, 500, "Could not load staff.");
    }
  },

  // POST /common/tasks
  createTask: async (req, res, db) => {
    try {
      await ensureWorkspaceSchema(db);
      const organizationId = Number(req.session.organizationId);
      const actor = resolveActor(req);
      const body = req.body || {};
      const details = cleanText(body.details, 5000);
      const title = cleanText(body.title, 200) || cleanText(details.split("\n")[0], 120);
      if (!title) return fail(res, 400, "Describe the task first.");
      const assignees = await filterStaffIds(db, organizationId, parseIdList(body.assigneeIds));
      if (!assignees.length) return fail(res, 400, "Tag at least one person with @ to assign the task.");
      const dueDate = parseDate(body.dueDate);
      const dueTime = dueDate ? parseTime(body.dueTime) : null;
      const priority = PRIORITIES.includes(body.priority) ? body.priority : "normal";

      const r = await db.query(
        `INSERT INTO org_tasks (organization_id, title, details, due_date, due_time, priority, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING task_id`,
        [organizationId, title, details || null, dueDate, dueTime, priority, actor.id, actor.name]
      );
      const taskId = r.rows[0].task_id;
      await db.query(`INSERT INTO org_task_assignees (task_id, user_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`, [taskId, assignees.map((a) => a.user_id)]);

      const others = assignees.filter((a) => a.user_id !== actor.id);
      const due = [fmtDay(dueDate), fmtTime(dueTime)].filter(Boolean).join(" · ");
      const link = `/common/orgDashboard#task-${taskId}`;
      notifSvc.createNotifications(db, others.map((a) => ({
        orgId: organizationId, recipientType: "staff", recipientId: a.user_id, type: "task_assigned",
        title: `${actor.name} assigned you: ${title}`, body: due ? `Due ${due}` : (details || "").slice(0, 140), link, refId: taskId,
      })));
      emailStaff(others, {
        subject: `${actor.name} assigned you a task: ${title}`,
        title: "You have a new task",
        context: "Task assigned",
        paragraphs: [
          `${escapeHtml(actor.name)} assigned you a task:`,
          `<strong>${escapeHtml(title)}</strong>`,
          ...(details && details !== title ? [escapeHtml(details).replace(/\n/g, "<br>")] : []),
        ],
        details: [
          ...(due ? [{ label: "Due", value: escapeHtml(due) }] : []),
          ...(priority === "high" ? [{ label: "Priority", value: "High" }] : []),
          ...(assignees.length > 1 ? [{ label: "Also assigned", value: escapeHtml(assignees.filter((a) => a.user_id !== actor.id).map(fullName).join(", ")) }] : []),
        ],
        ctaUrl: baseUrl(req) + link,
        ctaText: "Open the task",
      });
      scheduleOrgSync(db, Number(req.session.organizationId), baseUrl(req));
      res.json({ success: true, id: taskId });
    } catch (err) {
      console.error("[Tasks] create failed:", err.message);
      fail(res, 500, "Could not create the task.");
    }
  },

  // POST /common/tasks/:id/status  { done: true|false }
  taskStatus: async (req, res, db) => {
    try {
      const organizationId = Number(req.session.organizationId);
      const actor = resolveActor(req);
      const taskId = Number(req.params.id);
      const done = req.body.done === true || req.body.done === "true";
      const t = await db.query(`SELECT task_id, title, created_by FROM org_tasks WHERE task_id = $1 AND organization_id = $2`, [taskId, organizationId]);
      if (!t.rowCount) return fail(res, 404, "Task not found.");
      const task = t.rows[0];
      const mine = await db.query(
        `UPDATE org_task_assignees SET status = $3::varchar, done_at = CASE WHEN $3::varchar = 'done' THEN NOW() ELSE NULL END
          WHERE task_id = $1 AND user_id = $2 RETURNING user_id`,
        [taskId, actor.id, done ? "done" : "open"]
      );
      if (!mine.rowCount) {
        if (task.created_by !== actor.id) return fail(res, 403, "Only people on this task can update it.");
        await db.query(
          `UPDATE org_task_assignees SET status = $2::varchar, done_at = CASE WHEN $2::varchar = 'done' THEN NOW() ELSE NULL END WHERE task_id = $1`,
          [taskId, done ? "done" : "open"]
        );
      }
      await db.query(`UPDATE org_tasks SET updated_at = NOW() WHERE task_id = $1`, [taskId]);
      if (done && mine.rowCount && task.created_by && task.created_by !== actor.id) {
        const link = `/common/orgDashboard#task-${taskId}`;
        notifSvc.createNotification(db, {
          orgId: organizationId, recipientType: "staff", recipientId: task.created_by, type: "task_done",
          title: `${actor.name} completed: ${task.title}`, body: "", link, refId: taskId,
        }).catch(() => {});
        emailStaff(await staffByIds(db, [task.created_by]), {
          subject: `${actor.name} completed: ${task.title}`,
          title: "A task was completed",
          context: "Task done",
          paragraphs: [`${escapeHtml(actor.name)} marked <strong>${escapeHtml(task.title)}</strong> as done.`],
          ctaUrl: baseUrl(req) + link,
          ctaText: "View the task",
        });
      }
      scheduleOrgSync(db, Number(req.session.organizationId), baseUrl(req));
      res.json({ success: true, done });
    } catch (err) {
      console.error("[Tasks] status failed:", err.message);
      fail(res, 500, "Could not update the task.");
    }
  },

  // GET /common/tasks/:id/comments
  taskComments: async (req, res, db) => {
    try {
      const organizationId = Number(req.session.organizationId);
      const taskId = Number(req.params.id);
      const ok = await db.query(`SELECT 1 FROM org_tasks WHERE task_id = $1 AND organization_id = $2`, [taskId, organizationId]);
      if (!ok.rowCount) return fail(res, 404, "Task not found.");
      const r = await db.query(`SELECT comment_id, author_id, author_name, body, created_at FROM org_task_comments WHERE task_id = $1 ORDER BY created_at, comment_id`, [taskId]);
      res.json({ success: true, comments: r.rows });
    } catch (err) {
      fail(res, 500, "Could not load replies.");
    }
  },

  // POST /common/tasks/:id/comments  { body }
  addTaskComment: async (req, res, db) => {
    try {
      const organizationId = Number(req.session.organizationId);
      const actor = resolveActor(req);
      const taskId = Number(req.params.id);
      const body = cleanText(req.body.body, 2000);
      if (!body) return fail(res, 400, "Write a reply first.");
      const t = await db.query(
        `SELECT t.task_id, t.title, t.created_by, ARRAY(SELECT user_id FROM org_task_assignees WHERE task_id = t.task_id) AS assignees
           FROM org_tasks t WHERE t.task_id = $1 AND t.organization_id = $2`,
        [taskId, organizationId]
      );
      if (!t.rowCount) return fail(res, 404, "Task not found.");
      const task = t.rows[0];
      const participants = new Set([task.created_by, ...task.assignees].filter((id) => id));
      if (!participants.has(actor.id)) return fail(res, 403, "Only people on this task can reply.");
      const r = await db.query(
        `INSERT INTO org_task_comments (task_id, author_id, author_name, body) VALUES ($1,$2,$3,$4)
         RETURNING comment_id, author_id, author_name, body, created_at`,
        [taskId, actor.id, actor.name, body]
      );
      await db.query(`UPDATE org_tasks SET updated_at = NOW() WHERE task_id = $1`, [taskId]);
      participants.delete(actor.id);
      const link = `/common/orgDashboard#task-${taskId}`;
      notifSvc.createNotifications(db, [...participants].map((userId) => ({
        orgId: organizationId, recipientType: "staff", recipientId: userId, type: "task_reply",
        title: `${actor.name} replied on: ${task.title}`, body: body.slice(0, 140), link, refId: taskId,
      })));
      emailStaff(await staffByIds(db, [...participants]), {
        subject: `${actor.name} replied: ${task.title}`,
        title: "New reply on a task",
        context: "Task reply",
        paragraphs: [
          `${escapeHtml(actor.name)} replied on <strong>${escapeHtml(task.title)}</strong>:`,
          `<em>${escapeHtml(body).replace(/\n/g, "<br>")}</em>`,
        ],
        ctaUrl: baseUrl(req) + link,
        ctaText: "Reply in Managira",
      });
      res.json({ success: true, comment: r.rows[0] });
    } catch (err) {
      console.error("[Tasks] reply failed:", err.message);
      fail(res, 500, "Could not post the reply.");
    }
  },

  // GET /common/calendar/connect/:provider — redirect to Google / Microsoft sign-in.
  connectStart: async (req, res, db) => {
    const provider = req.params.provider;
    try {
      await calConnect.ensureConnectSchema(db);
      const configured = calConnect.providersConfigured();
      if (!configured[provider]) {
        req.flash("error", `${PROVIDER_LABEL[provider] || "That calendar"} isn't set up on this server yet.`);
        return res.redirect("/common/calendar");
      }
      return res.redirect(calConnect.startUrl(req, provider));
    } catch (err) {
      console.error("[Calendar] connect start failed:", err.message);
      req.flash("error", "Could not start the connection. Please try again.");
      return res.redirect("/common/calendar");
    }
  },

  // OAuth callback (Google uses the shared Google redirect; Outlook has its own).
  connectCallback: async (req, res, db, provider) => {
    try {
      await calConnect.ensureConnectSchema(db);
      const { email, connectionId } = await calConnect.finishOauth(db, req, provider);
      const conn = (await db.query(`SELECT * FROM calendar_connections WHERE connection_id = $1`, [connectionId])).rows[0];
      // The Managira calendar is made and filled in the background; nobody waits for it.
      if (conn) syncConnection(db, conn, baseUrl(req)).catch(() => {});
      req.flash("success", `${PROVIDER_LABEL[provider]} connected${email ? ` (${email})` : ""}.`);
    } catch (err) {
      console.error("[Calendar] connect callback failed:", err.message);
      // Our own words say what happened (cancelled, access not allowed, took too long); anything else stays general.
      const ours = /^(The sign-in expired|Google sign-in was cancelled|Microsoft sign-in was cancelled|Calendar access wasn't granted|No authorization code)/.test(String(err.message || ""));
      req.flash("error", ours ? err.message : `${PROVIDER_LABEL[provider]} didn't connect. Please try again.`);
    }
    return res.redirect("/common/calendar?sync=1");
  },

  // POST /common/calendar/connect/:provider/disconnect
  connectRemove: async (req, res, db) => {
    try {
      await calConnect.ensureConnectSchema(db);
      const conn = (await db.query(`SELECT * FROM calendar_connections WHERE connection_id = $1 AND user_id = $2`, [Number(req.params.id), resolveActor(req).id])).rows[0];
      if (conn) await calConnect.disconnect(db, conn);
      res.json({ success: true });
    } catch (err) {
      fail(res, 500, "Could not disconnect that calendar.");
    }
  },

  // POST /common/calendar/connect/:provider/sync — sync now.
  connectSyncNow: async (req, res, db) => {
    try {
      await calConnect.ensureConnectSchema(db);
      const conn = (await db.query(`SELECT * FROM calendar_connections WHERE connection_id = $1 AND user_id = $2`, [Number(req.params.id), resolveActor(req).id])).rows[0];
      if (!conn) return fail(res, 404, "That calendar isn't connected.");
      await syncConnection(db, conn, baseUrl(req));
      const fresh = (await db.query(`SELECT last_synced_at, last_error FROM calendar_connections WHERE connection_id = $1`, [conn.connection_id])).rows[0];
      if (fresh.last_error) {
        const name = PROVIDER_LABEL[conn.provider] || "This calendar";
        const plain = fresh.last_error === "setup"
          ? `${name} isn't available for Managira yet. Your events will appear on their own as soon as it is.`
          : (fresh.last_error === "reconnect" ? `${name} stopped letting Managira in. Connect again to keep syncing.` : "Couldn't sync just now. It tries again in a few minutes.");
        return fail(res, 502, plain);
      }
      res.json({ success: true, lastSyncedAt: fresh.last_synced_at });
    } catch (err) {
      fail(res, 500, "Could not sync right now.");
    }
  },

  // POST /common/calendar/connect/:provider/visibility { show }
  connectVisibility: async (req, res, db) => {
    try {
      const id = Number(req.params.id);
      const actorId = resolveActor(req).id;
      if (Object.prototype.hasOwnProperty.call(req.body, "show")) {
        await db.query(`UPDATE calendar_connections SET show_in_managira = $3 WHERE connection_id = $1 AND user_id = $2`, [id, actorId, req.body.show !== false]);
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "push")) {
        await db.query(`UPDATE calendar_connections SET push_enabled = $3 WHERE connection_id = $1 AND user_id = $2`, [id, actorId, req.body.push !== false]);
        const conn = (await db.query(`SELECT * FROM calendar_connections WHERE connection_id = $1 AND user_id = $2`, [id, actorId])).rows[0];
        if (conn && conn.push_enabled) syncConnection(db, conn, baseUrl(req)).catch(() => {});
      }
      res.json({ success: true });
    } catch (err) { fail(res, 500, "Could not update."); }
  },

  // POST /common/tasks/:id/react  { emoji }  (toggles)
  reactTask: async (req, res, db) => {
    try {
      const organizationId = Number(req.session.organizationId);
      const actor = resolveActor(req);
      const taskId = Number(req.params.id);
      const emoji = String(req.body.emoji || "");
      if (!REACTIONS.includes(emoji)) return fail(res, 400, "Unknown reaction.");
      const ok = await db.query(`SELECT 1 FROM org_tasks WHERE task_id = $1 AND organization_id = $2`, [taskId, organizationId]);
      if (!ok.rowCount) return fail(res, 404, "Task not found.");
      const removed = await db.query(`DELETE FROM org_task_reactions WHERE task_id = $1 AND actor_id = $2 AND emoji = $3`, [taskId, actor.id, emoji]);
      if (!removed.rowCount) {
        await db.query(`INSERT INTO org_task_reactions (task_id, actor_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [taskId, actor.id, emoji]);
      }
      const summary = await db.query(
        `SELECT emoji, COUNT(*)::int AS n, BOOL_OR(actor_id = $2) AS mine FROM org_task_reactions WHERE task_id = $1 GROUP BY emoji`,
        [taskId, actor.id]
      );
      res.json({ success: true, reactions: summary.rows });
    } catch (err) {
      console.error("[Tasks] react failed:", err.message);
      fail(res, 500, "Could not save the reaction.");
    }
  },
};
module.exports.collectItems = collectItems;
module.exports.scheduleOrgSync = scheduleOrgSync;
module.exports.runCalendarSyncSweep = runCalendarSyncSweep;
module.exports.itemsToSend = itemsToSend;
module.exports.addPersonalEvent = addPersonalEvent;
module.exports.freeTime = freeTime;
module.exports.freeSlots = freeSlots;
