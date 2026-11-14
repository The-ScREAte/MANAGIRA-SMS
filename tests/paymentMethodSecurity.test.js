const test = require("node:test");
const assert = require("node:assert/strict");

// Keep these checks independent of a real school database. The fake password hashes stand for
// different people's credentials, so a manager's password can never accidentally pass for staff.
const passwords = {
  "staff-hash": "staff-password",
  "school-hash": "school-password",
  "hub-hash": "hub-password",
};
const queries = [];
let answerQuery = async () => ({ rows: [] });

const dbPath = require.resolve("../config/db");
const hashingPath = require.resolve("../utils/passwordHashing");
const activityPath = require.resolve("../utils/activityLog");
const originals = new Map([
  [dbPath, require.cache[dbPath]],
  [hashingPath, require.cache[hashingPath]],
  [activityPath, require.cache[activityPath]],
]);

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      return answerQuery(String(sql), params);
    },
  },
};
require.cache[hashingPath] = {
  id: hashingPath,
  filename: hashingPath,
  loaded: true,
  exports: { compare: async (typed, hash) => typed === passwords[hash] },
};
require.cache[activityPath] = {
  id: activityPath,
  filename: activityPath,
  loaded: true,
  exports: { logOrganizationActivity: async () => {} },
};

const { confirmOwnPassword } = require("../utils/confirmOwnPassword");
const { PERMISSIONS, userHasPermission } = require("../middleware/permissionMiddleware");

test.after(() => {
  for (const [path, original] of originals) {
    if (original) require.cache[path] = original;
    else delete require.cache[path];
  }
});

const request = (session) => ({
  session,
  sessionID: `payment-security-${Math.random()}`,
  originalUrl: "/account/confirm-password/json",
  ip: "127.0.0.1",
});

test("a staff member confirms payment methods with their own password, never the manager's", async () => {
  answerQuery = async (sql) => ({ rows: sql.includes("FROM users") ? [{ password: "staff-hash" }] : [{ password: "school-hash" }] });
  const req = request({
    organizationId: 41,
    userId: 7,
    userRole: "Teacher",
    accountType: "Teacher",
    firstName: "Staff",
    lastName: "Member",
  });

  const confirmed = await confirmOwnPassword(req, "staff-password", { purpose: "manage billing and the plan" });
  assert.equal(confirmed.kind, "staff");
  assert.equal(confirmed.id, 7);
  await assert.rejects(
    confirmOwnPassword(req, "school-password", { purpose: "manage billing and the plan" }),
    (error) => error.status === 401 && error.message === "That password is not correct."
  );
  assert.ok(queries.some(({ sql, params }) => sql.includes("FROM users") && params[0] === 7 && params[1] === 41));
});

test("a school signed in as itself confirms with the school account password", async () => {
  answerQuery = async (sql) => ({ rows: sql.includes("FROM organizations") ? [{ password: "school-hash" }] : [] });
  const req = request({
    organizationId: 42,
    userId: 42,
    userRole: "Manager",
    accountType: "Organization",
    organizationName: "Example School",
  });

  const confirmed = await confirmOwnPassword(req, "school-password", { purpose: "manage billing and the plan" });
  assert.equal(confirmed.kind, "school");
  assert.equal(confirmed.id, 42);
  await assert.rejects(confirmOwnPassword(req, "staff-password", { purpose: "manage billing and the plan" }), { status: 401 });
});

test("a hub user managing a school confirms with their own hub password", async () => {
  answerQuery = async (sql) => ({ rows: sql.includes("FROM hub_users") ? [{ password: "hub-hash" }] : [] });
  const req = request({
    organizationId: 43,
    userId: 999,
    userRole: "Manager",
    accountType: "Manager",
    hubOrgSwitch: {
      by: "Hub Manager",
      saved: { hubUserId: 88, hubId: 5, firstName: "Hub", lastName: "Manager" },
    },
  });

  const confirmed = await confirmOwnPassword(req, "hub-password", { purpose: "manage billing and the plan" });
  assert.equal(confirmed.kind, "hubUser");
  assert.equal(confirmed.id, 88);
  await assert.rejects(confirmOwnPassword(req, "school-password", { purpose: "manage billing and the plan" }), { status: 401 });
});

test("Manage Billing is granted only to a person whose saved access includes it", async () => {
  const organizationId = 987654;
  const db = {
    query: async (sql, params) => {
      if (String(sql).includes("SELECT permission_key FROM user_permissions")) {
        const allowed = params[0] === 505 ? [PERMISSIONS.MANAGE_BILLING] : [];
        return { rows: [{ permission_key: "permissions_saved" }, ...allowed.map((permission_key) => ({ permission_key }))] };
      }
      return { rows: [] };
    },
  };
  const person = (userId) => ({
    userId,
    userRole: "Teacher",
    accountType: "Teacher",
    organizationId,
    userEmail: `teacher-${userId}@example.com`,
  });

  assert.equal(await userHasPermission(db, person(504), PERMISSIONS.MANAGE_BILLING), false);
  assert.equal(await userHasPermission(db, person(505), PERMISSIONS.MANAGE_BILLING), true);
});
