"use strict";

// A school chooses whether it takes attendance and lunch in Managira (utils/schoolServices.js).
const test = require("node:test");
const assert = require("node:assert");
const tenant = require("../utils/tenantSettings");
const schoolServices = require("../utils/schoolServices");
const classSettings = require("../utils/classSettings");

// classRows: { classId: stored class settings } for the class_settings table; students: { studentId: classId }.
const fakeDb = (row, { missing = false, classRows = {}, students = {} } = {}) => ({
  query: async (sql) => {
    if (/^SELECT \* FROM tenant_settings/.test(sql)) {
      if (missing) throw Object.assign(new Error("no table"), { code: "42P01" });
      return { rows: row ? [row] : [] };
    }
    if (/FROM class_settings/.test(sql)) return { rows: Object.entries(classRows).map(([class_id, settings]) => ({ class_id, settings })) };
    if (/FROM students/.test(sql)) return { rows: Object.entries(students).map(([student_id, class_id]) => ({ student_id, class_id })) };
    return { rows: [] };
  },
});
let next = 7000;
const org = () => (next += 1); // each test its own school: the settings are cached per school

test("the name follows what the school uses", () => {
  assert.strictEqual(schoolServices.nameFor(true, true), "Attendance & lunch");
  assert.strictEqual(schoolServices.nameFor(false, true), "Lunch");
  assert.strictEqual(schoolServices.nameFor(true, false), "Attendance");
  assert.strictEqual(schoolServices.nameFor(false, false), "");
});

test("a school with no settings row uses both", async () => {
  const svc = await schoolServices.services(fakeDb(null), org());
  assert.deepStrictEqual(svc, { attendance: true, lunch: true, name: "Attendance & lunch", icons: ["attendance", "lunch"] });
});

test("a database without the columns yet answers both on", async () => {
  const svc = await schoolServices.services(fakeDb({ session_hours: 24 }), org());
  assert.strictEqual(svc.attendance, true);
  assert.strictEqual(svc.lunch, true);
  const noTable = await schoolServices.services(fakeDb(null, { missing: true }), org());
  assert.strictEqual(noTable.name, "Attendance & lunch");
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
  assert.strictEqual((await schoolServices.services(broken, org())).name, "Attendance & lunch");
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

// ── Per-class switches: Take attendance and Take lunch (utils/classSettings.js) ──
// Class settings is a released feature (shards/features): these tests have it on for every school, then put it back.
const features = require("../utils/shards/features");
const realIsOn = features.isOn;
test.before(() => { features.isOn = (key, opts) => (key === "class_settings" ? true : realIsOn(key, opts)); });
test.after(() => { features.isOn = realIsOn; });

test("the names and icons: both, one, or neither", () => {
  assert.deepStrictEqual(schoolServices.build(true, true), { attendance: true, lunch: true, name: "Attendance & lunch", icons: ["attendance", "lunch"] });
  assert.deepStrictEqual(schoolServices.build(true, false), { attendance: true, lunch: false, name: "Attendance", icons: ["attendance"] });
  assert.deepStrictEqual(schoolServices.build(false, true), { attendance: false, lunch: true, name: "Lunch", icons: ["lunch"] });
  assert.deepStrictEqual(schoolServices.build(false, false), { attendance: false, lunch: false, name: "", icons: [] });
});

test("Take attendance is a lockable class switch, first in the list, on by default", () => {
  const keys = classSettings.SWITCHES.filter((s) => s.group === "class").map((s) => s.key);
  assert.deepStrictEqual(keys, ["attendance", "lunch", "portal"]);
  assert.strictEqual(classSettings.SWITCHES[0].label, "Take attendance");
  assert.strictEqual(classSettings.DEFAULTS.attendance, true);
  assert.strictEqual(classSettings.withDefaults(null).attendance, true);
  assert.strictEqual(classSettings.withDefaults({ attendance: false }).attendance, false);
  const locked = classSettings.applyChanges(null, { attendance: false, "lock:attendance": true });
  assert.strictEqual(locked.attendance, false);
  assert.strictEqual(classSettings.isLocked(locked, "attendance"), true);
  assert.strictEqual(classSettings.isLocked(classSettings.applyChanges(locked, { "lock:attendance": false }), "attendance"), false);
});

test("a class takes what the school AND the class switch on", async () => {
  const both = fakeDb({ use_attendance: true, use_lunch: true }, { classRows: { 1: {}, 2: { attendance: false }, 3: { lunch: false }, 4: { attendance: false, lunch: false } } });
  const id = org();
  assert.strictEqual((await schoolServices.classServices(both, id, 1)).name, "Attendance & lunch");
  const noAtt = await schoolServices.classServices(both, id, 2);
  assert.deepStrictEqual([noAtt.attendance, noAtt.lunch, noAtt.name, noAtt.icons], [false, true, "Lunch", ["lunch"]]);
  const noLunch = await schoolServices.classServices(both, id, 3);
  assert.deepStrictEqual([noLunch.attendance, noLunch.lunch, noLunch.name, noLunch.icons], [true, false, "Attendance", ["attendance"]]);
  const neither = await schoolServices.classServices(both, id, 4);
  assert.deepStrictEqual([neither.attendance, neither.lunch, neither.name, neither.icons], [false, false, "", []]);
  // A class with no row, and no class at all, take what the school takes.
  assert.strictEqual((await schoolServices.classServices(both, id, 99)).name, "Attendance & lunch");
  assert.strictEqual((await schoolServices.classServices(both, id, null)).name, "Attendance & lunch");
  const many = await schoolServices.classServicesFor(both, id, [1, 2, 3, 4]);
  assert.deepStrictEqual([...many].map(([k, v]) => [k, v.name]), [[1, "Attendance & lunch"], [2, "Lunch"], [3, "Attendance"], [4, ""]]);
});

test("the school's switch overrides a class that has it on", async () => {
  const id = org();
  const db = fakeDb({ use_attendance: false, use_lunch: true }, { classRows: { 1: { attendance: true, lunch: true } } });
  const svc = await schoolServices.classServices(db, id, 1);
  assert.deepStrictEqual([svc.attendance, svc.lunch, svc.name], [false, true, "Lunch"]);
  // The class's own switch, as saved, is still on for the settings page.
  assert.strictEqual((await classSettings.settingsFor(db, id, 1, { raw: true })).attendance, true);
});

test("a class that doesn't take attendance shares none of it and sends no notices", async () => {
  const id = org();
  const db = fakeDb({ use_attendance: true, use_lunch: true }, { classRows: { 2: { attendance: false } }, students: { 20: 2, 21: 1 } });
  const shown = await classSettings.settingsFor(db, id, 2);
  assert.strictEqual(shown.attendance, false);
  assert.strictEqual(shown.lunch, true);
  assert.strictEqual(shown.parents.attendance, false);
  assert.strictEqual(shown.students.attendance, false);
  assert.strictEqual(shown.notices.absent.on, false);
  assert.strictEqual(shown.parents.lunch, true);
  const byStudent = await classSettings.sharedFor(db, id, [20, 21], "parents");
  assert.strictEqual(byStudent.get(20).attendance, false);
  assert.strictEqual(byStudent.get(21).attendance, true);
  const svcBy = await schoolServices.studentServicesFor(db, id, [20, 21]);
  assert.strictEqual(svcBy.get(20).name, "Lunch");
  assert.strictEqual(svcBy.get(21).name, "Attendance & lunch");
});

test("a class that doesn't take lunch shares none of it", async () => {
  const id = org();
  const db = fakeDb({ use_attendance: true, use_lunch: true }, { classRows: { 3: { lunch: false } } });
  const shown = await classSettings.settingsFor(db, id, 3);
  assert.deepStrictEqual([shown.lunch, shown.parents.lunch, shown.students.lunch, shown.parents.attendance], [false, false, false, true]);
});

test("the route guard asks the class named in the request", async () => {
  const id = org();
  const db = fakeDb({ use_attendance: true, use_lunch: true }, { classRows: { 2: { attendance: false }, 4: { attendance: false, lunch: false } } });
  const run = async (needs, query) => {
    let out = null;
    const res = { status(code) { out = { code }; return this; }, json(body) { out.body = body; return this; }, send(body) { out.html = body; return this; } };
    let passed = false;
    await schoolServices.requireService(db, needs)({ session: { organizationId: id }, method: "POST", query, body: {}, get: () => "application/json", xhr: true }, res, () => { passed = true; });
    return { passed, out };
  };
  assert.strictEqual((await run("attendance", { classId: "1" })).passed, true);
  assert.strictEqual((await run("attendance", { classId: "2" })).passed, false);
  assert.strictEqual((await run("lunch", { classId: "2" })).passed, true);
  assert.strictEqual((await run("either", { classId: "2" })).passed, true);
  assert.strictEqual((await run("either", { classId: "4" })).passed, false);
  assert.strictEqual((await run("attendance", {})).passed, true); // no class named: the school's answer
});
