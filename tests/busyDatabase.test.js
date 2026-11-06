const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../config/db");
const { isAuthenticated } = require("../middleware/middleware");
const { isDatabaseUnavailable } = require("../middleware/errorMiddleware");

test("too many people waiting for the database counts as busy, not as a bad session", () => {
  assert.equal(isDatabaseUnavailable(new Error("timeout exceeded when trying to connect")), true);
  assert.equal(isDatabaseUnavailable(new Error("connect ECONNREFUSED 127.0.0.1:5432")), true);
  assert.equal(isDatabaseUnavailable(new Error("column x does not exist")), false);
});

test("a busy database never signs anyone out", async () => {
  const realQuery = db.query;
  db.query = async () => { throw new Error("timeout exceeded when trying to connect"); };
  let destroyed = false;
  let passedOn = null;
  const req = {
    session: { organizationId: 777001, userId: 5, userRole: "Teacher", destroy: (done) => { destroyed = true; done(); } },
    headers: {},
    get: () => undefined,
    flash: () => {},
    originalUrl: "/common/orgDashboard",
  };
  const res = { status() { return this; }, json() { return this; }, redirect() { throw new Error("should not redirect to sign-in"); }, clearCookie() {} };
  try {
    await isAuthenticated(req, res, (error) => { passedOn = error; });
  } finally {
    db.query = realQuery;
  }
  assert.equal(destroyed, false, "the session is kept");
  assert.ok(passedOn, "the busy page handles it");
  assert.equal(isDatabaseUnavailable(passedOn), true);
});
