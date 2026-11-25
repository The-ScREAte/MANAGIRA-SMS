"use strict";

// A school chooses whether it takes attendance and lunch in Managira (utils/schoolServices.js).
const test = require("node:test");
const assert = require("node:assert");
const tenant = require("../utils/tenantSettings");
const schoolServices = require("../utils/schoolServices");
const classSettings = require("../utils/classSettings");

const fakeDb = (row, { missing = false } = {}) => ({
  query: async (sql) => {
    if (/^SELECT \* FROM tenant_settings/.test(sql)) {
      if (missing) throw Object.assign(new Error("no table"), { code: "42P01" });
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  },
});
let next = 7000;
const org = () => (next += 1); // each test its own school: the settings are cached per school

test("the name follows what the school uses", () => {
  assert.strictEqual(schoolServices.nameFor(true, true), "Attendance and lunch");
  assert.strictEqual(schoolServices.nameFor(false, true), "Lunch");
  assert.strictEqual(schoolServices.nameFor(true, false), "Attendance");
  assert.strictEqual(schoolServices.nameFor(false, false), "");
});

test("a school with no settings row uses both", async () => {
  const svc = await schoolServices.services(fakeDb(null), org());
  assert.deepStrictEqual(svc, { attendance: true, lunch: true, name: "Attendance and lunch" });
});

test("a database without the columns yet answers both on", async () => {
  const svc = await schoolServices.services(fakeDb({ session_hours: 24 }), org());
  assert.strictEqual(svc.attendance, true);
  assert.strictEqual(svc.lunch, true);
  const noTable = await schoolServices.services(fakeDb(null, { missing: true }), org());
  assert.strictEqual(noTable.name, "Attendance and lunch");
});

test("a school can turn either one off", async () => {
  assert.strictEqual((await schoolServices.services(fakeDb({ use_attendance: false, use_lunch: true }), org())).name, "Lunch");
  assert.strictEqual((await schoolServices.services(fakeDb({ use_attendance: true, use_lunch: false }), org())).name, "Attendance");
  const none = await schoolServices.services(fakeDb({ use_attendance: false, use_lunch: false }), org());
  assert.strictEqual(none.name, "");
  assert.strictEqual(none.attendance, false);
});

test("a failed read never hides a page", async () => {
  const broken = { query: async () => { throw new Error("db down"); } };
  assert.strictEqual((await schoolServices.services(broken, org())).name, "Attendance and lunch");
});

test("saving the switches drops the cached answer and writes both columns", async () => {
  const id = org();
  const calls = [];
  const db = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (/^SELECT \* FROM tenant_settings/.test(sql)) return { rows: [{ use_attendance: calls.some((c) => /^INSERT/.test(c.sql)) ? false : true, use_lunch: true }] };
      return { rows: [] };
    },
  };
  assert.strictEqual((await schoolServices.services(db, id)).attendance, true);
  await tenant.saveServices(db, id, { use_attendance: false });
  const insert = calls.find((c) => /^INSERT INTO tenant_settings/.test(c.sql));
  assert.deepStrictEqual(insert.args, [id, false, true]);
  assert.strictEqual((await schoolServices.services(db, id)).attendance, false);
});

test("without the columns, saving says so and does not crash", async () => {
  const db = {
    query: async (sql) => {
      if (/^INSERT/.test(sql)) throw Object.assign(new Error("column missing"), { code: "42703" });
      return { rows: [] };
    },
  };
  await assert.rejects(() => tenant.saveServices(db, org(), { use_lunch: false }), tenant.TenantSettingsError);
});

test("what the school turned off is never shared, whatever a class says", async () => {
  const id = org();
  const db = fakeDb({ use_attendance: false, use_lunch: false });
  const own = await classSettings.settingsFor(db, id, 1, { raw: true });
  assert.strictEqual(own.lunch, true); // the class's own switch is left as saved
  const shown = await classSettings.settingsFor(db, id, 1);
  assert.strictEqual(shown.lunch, false);
  assert.strictEqual(shown.parents.attendance, false);
  assert.strictEqual(shown.students.lunch, false);
  assert.strictEqual(shown.notices.absent.on, false);
  const sharedMap = await classSettings.sharedFor(db, id, [1], "parents");
  assert.strictEqual(sharedMap.get(1).attendance, false);
  assert.strictEqual(sharedMap.get(1).lunch, false);
  assert.strictEqual(sharedMap.get(1).reportCards, true); // everything else is untouched
});

test("a school that uses both keeps every class's own choices", async () => {
  const id = org();
  const db = fakeDb({ use_attendance: true, use_lunch: true });
  const shown = await classSettings.settingsFor(db, id, 1);
  assert.strictEqual(shown.lunch, true);
  assert.strictEqual(shown.parents.attendance, true);
});

test("the route guard answers politely when a service is off", async () => {
  const id = org();
  const db = fakeDb({ use_attendance: false, use_lunch: true });
  const run = async (needs, method, accept) => {
    let out = null;
    const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; }, send(body) { out.html = body; return this; } };
    let passed = false;
    await schoolServices.requireService(db, needs)({ session: { organizationId: id }, method, get: () => accept, xhr: false }, res, () => { passed = true; });
    return { passed, out };
  };
  assert.strictEqual((await run("lunch", "POST", "")).passed, true);
  const blocked = await run("attendance", "POST", "application/json");
  assert.strictEqual(blocked.passed, false);
  assert.strictEqual(blocked.out.code, 403);
  assert.match(blocked.out.body.message, /isn't used in Managira/);
  const page = await run("attendance", "GET", "text/html");
  assert.strictEqual(page.out.code, 403);
  assert.match(page.out.html, /isn't used/);
  assert.strictEqual((await run("either", "GET", "text/html")).passed, true);
});
