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

test("Google pull shows the person's own events but not the ones Managira put there", async () => {
  const g = fakeGoogle();
  calConnect.__setDeps({ googleApi: () => g.api });
  const conn = { connection_id: 9, user_id: 1, provider: "google", account_email: "me@gmail.com" };
  const out = await calConnect.pullEvents({}, conn, "2026-10-01", "2026-10-31");
  assert.deepStrictEqual(out.map((e) => e.title), ["Work", "Holiday"]);
  assert.strictEqual(out[0].allDay, false);
  assert.strictEqual(out[1].allDay, true);
  assert.strictEqual(out[1].start, "2026-10-13");
  assert.strictEqual(out[0].extendedProps.layer, "conn-9");
  assert.strictEqual(out[0].extendedProps.source, "me@gmail.com");
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
  const orig = console.error;
  console.error = () => {};
  assert.strictEqual(calConnect.friendlyError({ code: 403, message: "Google Calendar API has not been used in project 1 before or it is disabled." }), "setup");
  console.error = orig;
});
