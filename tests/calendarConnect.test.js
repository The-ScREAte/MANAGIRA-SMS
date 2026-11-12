const test = require("node:test");
const assert = require("node:assert");
const calConnect = require("../utils/calendarConnect");

// Minimal in-memory stand-in for the two tables pushItems touches.
function fakeDb() {
  const map = new Map(); // `${connectionId}:${uid}` -> { item_uid, remote_id, hash }
  const conns = new Map();
  return {
    map,
    conns,
    async query(sql, params = []) {
      if (/SELECT item_uid, remote_id, hash FROM calendar_push_map/.test(sql)) {
        return { rows: [...map.entries()].filter(([k]) => k.startsWith(`${params[0]}:`)).map(([, v]) => v) };
      }
      if (/INSERT INTO calendar_push_map/.test(sql)) {
        map.set(`${params[0]}:${params[1]}`, { item_uid: params[1], remote_id: params[2], hash: params[3] });
        return { rows: [] };
      }
      if (/DELETE FROM calendar_push_map WHERE connection_id = \$1$/.test(sql.trim())) {
        for (const key of [...map.keys()]) if (key.startsWith(`${params[0]}:`)) map.delete(key);
        return { rows: [] };
      }
      if (/DELETE FROM calendar_push_map WHERE connection_id = \$1 AND item_uid = \$2/.test(sql)) {
        map.delete(`${params[0]}:${params[1]}`);
        return { rows: [] };
      }
      if (/UPDATE calendar_connections SET managira_calendar_id/.test(sql)) {
        conns.set(params[0], params[1]);
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

function fakeGoogle() {
  const calls = [];
  const remote = new Map();
  let n = 0;
  const api = {
    calendars: {
      insert: async ({ requestBody }) => { calls.push(["calendars.insert", requestBody.summary]); return { data: { id: "cal-managira" } }; },
    },
    events: {
      insert: async ({ calendarId, requestBody }) => {
        const id = `g${++n}`;
        remote.set(id, requestBody);
        calls.push(["insert", calendarId, requestBody.summary]);
        return { data: { id } };
      },
      patch: async ({ eventId, requestBody }) => {
        if (!remote.has(eventId)) { const err = new Error("Not Found"); err.code = 404; throw err; }
        remote.set(eventId, requestBody);
        calls.push(["patch", eventId, requestBody.summary]);
        return { data: {} };
      },
      delete: async ({ eventId }) => { remote.delete(eventId); calls.push(["delete", eventId]); return { data: {} }; },
      list: async () => ({
        data: {
          items: [
            { id: "x1", summary: "Work", start: { dateTime: "2026-10-12T16:00:00-06:00" }, end: { dateTime: "2026-10-12T17:00:00-06:00" }, htmlLink: "https://g/x1" },
            { id: "x2", summary: "Holiday", start: { date: "2026-10-13" }, end: { date: "2026-10-14" } },
            { id: "x3", summary: "Staff Briefing", start: { date: "2026-10-14" }, end: { date: "2026-10-15" }, extendedProperties: { private: { managiraUid: "event-1" } } },
            { id: "x4", summary: "Gone", status: "cancelled", start: { date: "2026-10-15" }, end: { date: "2026-10-16" } },
          ],
        },
      }),
    },
  };
  return { api, calls, remote };
}

const items = () => [
  { uid: "event-1", title: "Staff Briefing", details: "Weekly", location: "Staff Room", date: "2026-10-14", endDate: "2026-10-14", startTime: "09:00", endTime: "10:00", allDay: false, url: "https://x/cal" },
  { uid: "event-2", title: "Mid-Term Week", details: "", location: "", date: "2026-10-19", endDate: "2026-10-23", startTime: null, endTime: null, allDay: true, url: "https://x/cal" },
];

test("Google push creates the Managira calendar and adds events with correct dates", async () => {
  const db = fakeDb();
  const g = fakeGoogle();
  calConnect.__setDeps({ googleApi: () => g.api });
  const conn = { connection_id: 7, user_id: 1, provider: "google", time_zone: "America/Denver", managira_calendar_id: null };
  await calConnect.pushItems(db, conn, items(), "Managira Int. School");
  assert.deepStrictEqual(g.calls[0], ["calendars.insert", "Managira · Managira Int. School"]);
  assert.strictEqual(db.conns.get(7), "cal-managira");
  const [timed, allDay] = [...g.remote.values()];
  assert.deepStrictEqual(timed.start, { dateTime: "2026-10-14T09:00:00", timeZone: "America/Denver" });
  assert.deepStrictEqual(timed.end, { dateTime: "2026-10-14T10:00:00", timeZone: "America/Denver" });
  assert.deepStrictEqual(allDay.start, { date: "2026-10-19" });
  assert.deepStrictEqual(allDay.end, { date: "2026-10-24" }); // Google's end date is exclusive
  assert.strictEqual(timed.extendedProperties.private.managiraUid, "event-1");
  assert.strictEqual(db.map.size, 2);
});

test("Google push only sends changes, removes deleted items and re-adds events deleted in Google", async () => {
  const db = fakeDb();
  const g = fakeGoogle();
  calConnect.__setDeps({ googleApi: () => g.api });
  const conn = { connection_id: 8, user_id: 1, provider: "google", time_zone: "UTC", managira_calendar_id: "cal-managira" };
  await calConnect.pushItems(db, conn, items(), "School");
  g.calls.length = 0;

  await calConnect.pushItems(db, conn, items(), "School");
  assert.deepStrictEqual(g.calls, [], "nothing changed, nothing sent");

  const changed = items();
  changed[0].title = "Staff Briefing (moved)";
  changed.pop();
  await calConnect.pushItems(db, conn, changed, "School");
  assert.deepStrictEqual(g.calls.map((c) => c[0]).sort(), ["delete", "patch"]);
  assert.strictEqual(db.map.size, 1);

  // Someone deleted the event inside Google: the next change re-creates it.
  g.remote.clear();
  g.calls.length = 0;
  changed[0].title = "Staff Briefing (again)";
  await calConnect.pushItems(db, conn, changed, "School");
  assert.deepStrictEqual(g.calls.map((c) => c[0]), ["insert"]);
});

test("Google is asked only for the calendar Managira makes, never for the person's other calendars", () => {
  assert.ok(calConnect.GOOGLE_SCOPES.includes("https://www.googleapis.com/auth/calendar.app.created"));
  assert.ok(!calConnect.GOOGLE_SCOPES.some((scope) => /calendar\.events|calendar\.readonly|\/calendar$/.test(scope)), calConnect.GOOGLE_SCOPES.join(" "));
});

test("a Managira calendar deleted in Google is made again, with everything in it", async () => {
  const db = fakeDb();
  const g = fakeGoogle();
  let calendars = 0;
  const deleted = new Set();
  g.api.calendars.insert = async () => { calendars += 1; return { data: { id: `cal-${calendars}` } }; };
  const realInsert = g.api.events.insert;
  g.api.events.insert = async (args) => {
    if (deleted.has(args.calendarId)) { const err = new Error("Not Found"); err.code = 404; throw err; }
    return realInsert(args);
  };
  calConnect.__setDeps({ googleApi: () => g.api });
  const conn = { connection_id: 11, user_id: 1, provider: "google", time_zone: "UTC", managira_calendar_id: null };
  await calConnect.pushItems(db, conn, items(), "School");
  assert.strictEqual(conn.managira_calendar_id, "cal-1");
  // Someone deleted the whole Managira calendar in Google, then a new event is added in Managira.
  deleted.add("cal-1");
  g.remote.clear();
  const more = items().concat([{ uid: "event-3", title: "Open Day", details: "", location: "", date: "2026-10-30", endDate: "2026-10-30", startTime: null, endTime: null, allDay: true, url: "https://x/cal" }]);
  await calConnect.pushItems(db, conn, more, "School");
  assert.strictEqual(conn.managira_calendar_id, "cal-2", "a new Managira calendar was made");
  assert.strictEqual(g.remote.size, 3, "and everything was sent to it again");
  assert.strictEqual(db.map.size, 3);
});

test("Outlook push creates a calendar and sends events through Microsoft Graph", async () => {
  const db = fakeDb();
  const calls = [];
  let n = 0;
  calConnect.__setDeps({
    graph: async (_db, _conn, method, path, data) => {
      calls.push([method, path, data && (data.name || data.subject)]);
      if (method === "post" && path === "/me/calendars") return { id: "ms-cal" };
      if (method === "post") return { id: `m${++n}` };
      return {};
    },
  });
  const conn = { connection_id: 10, user_id: 1, provider: "outlook", time_zone: "Africa/Accra", managira_calendar_id: null };
  await calConnect.pushItems(db, conn, items(), "School");
  assert.deepStrictEqual(calls.map((c) => c[0] + " " + c[1]), ["post /me/calendars", "post /me/calendars/ms-cal/events", "post /me/calendars/ms-cal/events"]);
  assert.strictEqual(db.map.size, 2);
});

test("errors are turned into plain codes for the screen", () => {
  assert.strictEqual(calConnect.friendlyError({ code: 401, message: "Invalid Credentials" }), "reconnect");
  assert.strictEqual(calConnect.friendlyError({ response: { status: 400, data: { error_description: "invalid_grant" } }, message: "x" }), "reconnect");
  // Google's own shape when a sign-in has ended: the code, with "Bad Request" as the words.
  assert.strictEqual(calConnect.friendlyError({ code: 400, message: "invalid_grant", response: { status: 400, data: { error: "invalid_grant", error_description: "Bad Request" } } }), "reconnect");
  const orig = console.error;
  console.error = () => {};
  assert.strictEqual(calConnect.friendlyError({ code: 403, message: "Google Calendar API has not been used in project 1 before or it is disabled." }), "setup");
  console.error = orig;
});

test("everything on the person's Managira calendar is sent: events, activities, classes and bus runs (not announcements or birthdays)", () => {
  const { itemsToSend } = require("../controllers/workspaceController");
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const items = [
    { title: "Science Fair", allDay: false, extendedProps: { kind: "event", layer: "event", recordId: 1, date: day(3), endDate: day(3), startTime: "10:00", endTime: "12:00" } },
    { title: "Projects due (6th)", allDay: true, extendedProps: { kind: "activity", layer: "event", recordId: 2, date: day(4), endDate: day(4) } },
    { title: "Checking the sync", start: day(1), allDay: true, extendedProps: { kind: "announcement", layer: "announcement", recordId: 3, details: "Checking the sync\nmore" } },
    { title: "Math (6th)", allDay: false, extendedProps: { kind: "lesson", layer: "lesson", recordId: `4-${day(2)}`, date: day(2), startTime: "08:00", endTime: "08:45", classId: 9 } },
    { title: "Math (6th)", allDay: false, extendedProps: { kind: "lesson", layer: "lesson", recordId: `4-${day(90)}`, date: day(90), startTime: "08:00", endTime: "08:45", classId: 9 } },
    { title: "Morning run", allDay: false, extendedProps: { kind: "trip", layer: "trip", recordId: `5-${day(1)}`, date: day(1), startTime: "07:00", endTime: "08:00" } },
    { title: "Plan lessons", allDay: true, extendedProps: { kind: "task", layer: "task", recordId: 6, date: day(5) } },
    { title: "A colleague's dentist", allDay: true, extendedProps: { kind: "personal", layer: "share-12", recordId: 7, date: day(5), endDate: day(5) } },
  ];
  const sent = itemsToSend(items, "https://managira.com");
  assert.deepStrictEqual(sent.map((item) => item.uid), ["event-1", "activity-2", `lesson-4-${day(2)}`, `trip-5-${day(1)}`, "task-6"]);
  assert.strictEqual(sent.find((item) => item.uid.startsWith("lesson")).url, "https://managira.com/common/classDashboard/9");
});

test("Mira finds free time around what's already on the person's calendar", () => {
  const { freeSlots } = require("../controllers/workspaceController");
  const items = [
    { title: "Math (6th)", allDay: false, extendedProps: { kind: "lesson", layer: "lesson", date: "2026-11-16", startTime: "08:00", endTime: "09:30" } },
    { title: "Staff meeting", allDay: false, extendedProps: { kind: "event", layer: "event", date: "2026-11-16", startTime: "12:00", endTime: "13:00" } },
    { title: "Call parent", allDay: false, extendedProps: { kind: "task", layer: "task", date: "2026-11-16", startTime: "15:45" } },
    { title: "A colleague's dentist", allDay: false, extendedProps: { kind: "personal", layer: "share-9", date: "2026-11-16", startTime: "10:00", endTime: "11:00" } },
    { title: "🎂 Ama Mensah", allDay: true, extendedProps: { kind: "birthday", layer: "birthday", date: "2026-11-16" } },
    { title: "Thanksgiving Break · No School", allDay: true, extendedProps: { kind: "event", layer: "event", date: "2026-11-17", endDate: "2026-11-17" } },
  ];
  const result = freeSlots(items, { start: "2026-11-16", days: 2, dayStart: "08:00", dayEnd: "17:00", minutes: 30 });
  const [monday, tuesday] = result.days;
  assert.strictEqual(monday.weekday, "Monday");
  assert.deepStrictEqual(monday.free, [{ from: "09:30", to: "12:00" }, { from: "13:00", to: "15:45" }, { from: "16:15", to: "17:00" }], "a colleague's shared event doesn't block the person");
  assert.deepStrictEqual(monday.allDay, [], "birthdays don't count as busy");
  assert.deepStrictEqual(tuesday.free, [{ from: "08:00", to: "17:00" }]);
  assert.deepStrictEqual(tuesday.allDay, ["Thanksgiving Break · No School"], "an all-day holiday is listed so nobody books over it unawares");
  assert.throws(() => freeSlots(items, { start: "2026-11-16", dayStart: "17:00", dayEnd: "08:00" }), /working hours/);
});
