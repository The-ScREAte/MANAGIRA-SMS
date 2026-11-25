const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { requireClassScope, requireGroupScope } = require("../utils/classScope");

// Teacher 5 teaches class 1 only. Group 10 is an assessment group of class 1, group 20 of class 3.
const db = {
  query: async (sql, params) => {
    if (/FROM user_classes/.test(sql)) return { rows: params[0] === 5 ? [{ class_id: 1, main: false }] : [] };
    if (/FROM user_subjects/.test(sql)) return { rows: [] };
    if (/FROM assessments/.test(sql)) return { rows: ({ 10: [{ class_id: 1, subject_id: null }], 20: [{ class_id: 3, subject_id: null }] })[params[0]] || [] };
    if (/main/.test(sql)) return { rows: [] };
    throw new Error("unexpected query: " + sql.slice(0, 60));
  },
};

const run = async (middleware, { role = "Teacher", query = {}, body = {} } = {}) => {
  const req = { session: { userRole: role, userId: 5, organizationId: 9 }, query, body, get: () => "application/json" };
  let status = null;
  let nextCalled = false;
  const res = { status(code) { status = code; return this; }, json() { return this; }, redirect() { status = 302; return this; } };
  await middleware(req, res, () => { nextCalled = true; });
  return { status, nextCalled };
};

test("the class schedule opens only for a class the teacher teaches", async () => {
  const guard = requireClassScope(db);
  assert.equal((await run(guard, { query: { classId: "1" } })).nextCalled, true);
  assert.equal((await run(guard, { query: { classId: "3" } })).nextCalled, false);
  assert.equal((await run(guard, { query: { classId: "3" } })).status, 403);
  // Supervisors and managers are not limited here; their permissions decide.
  assert.equal((await run(guard, { role: "Supervisor", query: { classId: "3" } })).nextCalled, true);
});

test("an assessment's settings open only for a group of the teacher's own classes", async () => {
  const guard = requireGroupScope(db);
  assert.equal((await run(guard, { query: { groupId: "10" } })).nextCalled, true);
  assert.equal((await run(guard, { query: { groupId: "20" } })).nextCalled, false);
  assert.equal((await run(guard, { query: {} })).nextCalled, false);
});

test("the class schedule and the assessment settings pages are guarded by class scope in the route file", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "commonRoute.js"), "utf8");
  const line = (needle) => source.split("\n").find((l) => l.includes(needle)) || "";
  assert.match(line('router.get("/classSchedule"'), /requireClassScope\(db\)/);
  assert.match(line('router.get("/modifyAssessment"'), /requireGroupScope\(db\)/);
  assert.match(line('router.post("/modifyAssessment"'), /requireGroupScope\(db\)/);
});

// A supervisor sees every class only with a permission that gives them the classes; otherwise
// their own classes (user_classes), like a teacher.
const { requireClassDashboardAccess, supervisorReach } = require("../utils/classScope");
const supervisorDb = { query: async (sql, params) => ({ rows: /FROM user_classes/.test(sql) && params[0] === 5 ? [{ class_id: 1 }] : [] }) };
const holding = (...keys) => async (key) => keys.includes(key);
const runDashboard = async (holds, { role = "Supervisor", params = {}, query = {}, method = "GET" } = {}) => {
  const req = { session: { userRole: role, userId: 5, organizationId: 9 }, params, query, body: {}, method, get: () => "text/html" };
  let status = null; let nextCalled = false; let redirected = null; let json = null;
  const res = { status(code) { status = code; return this; }, json(v) { json = v; return this; }, redirect(to) { status = 302; redirected = to; return this; } };
  await requireClassDashboardAccess(supervisorDb, holds)(req, res, () => { nextCalled = true; });
  return { status, nextCalled, redirected, json };
};

test("a supervisor with no class permission opens only their own classes", async () => {
  const none = holding();
  assert.equal((await runDashboard(none, { params: { classId: "1" } })).nextCalled, true);
  const other = await runDashboard(none, { params: { classId: "3" } });
  assert.equal(other.nextCalled, false);
  assert.equal(other.status, 302);
  assert.equal(other.redirected, "/common/orgDashboard");
  assert.equal((await runDashboard(none, { query: { classId: "3" } })).nextCalled, false);
  assert.equal((await runDashboard(none, { params: { classId: "3abc" } })).nextCalled, false);
  // The data routes behind the tabs answer 403 JSON, not a page.
  const post = await runDashboard(none, { query: { classId: "3" }, method: "POST" });
  assert.equal(post.status, 403);
  assert.equal(post.json.success, false);
});

test("a supervisor holding a class permission opens every class", async () => {
  for (const key of ["manage_students", "manage_classes_subjects", "manage_assessments", "mark_attendance", "class_settings_all"]) {
    assert.equal((await runDashboard(holding(key), { params: { classId: "3" } })).nextCalled, true, key);
  }
  // A permission that has nothing to do with classes doesn't open them.
  assert.equal((await runDashboard(holding("mailroom", "manage_reports"), { params: { classId: "3" } })).nextCalled, false);
});

test("managers and teachers are not decided by the supervisor rule", async () => {
  assert.equal(await supervisorReach(supervisorDb, { session: { userRole: "Manager", userId: 5 } }, holding()), null);
  assert.equal(await supervisorReach(supervisorDb, { session: { userRole: "Teacher", userId: 5 } }, holding()), null);
  assert.equal((await runDashboard(holding(), { role: "Manager", params: { classId: "3" } })).nextCalled, true);
});

test("the class dashboard, its data routes and the class list use the supervisor rule", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "commonRoute.js"), "utf8");
  const block = (needle) => { const i = routes.indexOf(needle); return routes.slice(i, i + 260); };
  for (const needle of ['"/classDashboard",', '"/classDashboard/:classId/:panel?/:itemId?",', '"/classDashboardStudentTransport",', '"/studentTeacherRemarkOptions",', '"/saveStudentTeacherRemark",', 'router.get("/classSchedule"']) {
    assert.match(block(needle), /requireClassDashboardAccess\(db\)/, needle);
  }
  const controller = fs.readFileSync(path.join(__dirname, "..", "controllers", "commonController.js"), "utf8");
  assert.match(controller, /supervisorReach\(db, req\)/);
});
