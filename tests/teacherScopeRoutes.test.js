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
