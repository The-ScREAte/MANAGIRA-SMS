"use strict";
// Nobody gives more than they could give (utils/staffChangeGuard.js): staff pages let someone who
// isn't a manager add or change only staff at or below their own role, with permissions they hold.
const test = require("node:test");
const assert = require("node:assert/strict");
const perms = require("../middleware/permissionMiddleware");
const guard = require("../utils/staffChangeGuard");

const asRole = (role, userId = 7) => ({ session: { userRole: role, userId, organizationId: 63 } });

test("a role at or below your own: a lead driver adds drivers, a teacher teachers and drivers", () => {
  const roles = ["Manager", "Supervisor", "Teacher", "Driver"];
  const canGive = (who) => roles.filter((type) => guard.canGiveRole(asRole(who), type));
  assert.deepEqual(canGive("Driver"), ["Driver"]);
  assert.deepEqual(canGive("Teacher"), ["Teacher", "Driver"]);
  assert.deepEqual(canGive("Supervisor"), ["Supervisor", "Teacher", "Driver"]);
  assert.deepEqual(canGive("Manager"), roles);
  assert.deepEqual(canGive("Organization"), roles, "the school signed in as itself");
  assert.equal(guard.canGiveRole(asRole("Driver"), "Principal"), false, "a role that isn't built in is never given by a non-manager");
});

test("Managira's own roles are never given to a school account, by anyone, a manager included", async () => {
  for (const platform of ["Admin", "Mini Admin", "Internal Worker", "admin", "Organization", "", null]) {
    assert.equal(guard.isSchoolRole(platform), false, String(platform));
    for (const who of ["Manager", "Organization", "Supervisor", "Driver"]) {
      assert.equal(guard.canGiveRole(asRole(who), platform), false, `${who} gives ${platform}`);
    }
  }
  const saved = perms.getUserPermissions;
  perms.getUserPermissions = async () => [];
  try {
    const manager = await guard.grantLimits({}, asRole("Manager"));
    assert.equal(manager.role("Admin"), false, "the staff form refuses Admin even from a manager");
    assert.equal(manager.role("Supervisor"), true);
  } finally {
    perms.getUserPermissions = saved;
  }
});

test("a non-manager gives only the permissions they hold", async () => {
  const saved = perms.getUserPermissions;
  perms.getUserPermissions = async () => ["permissions_saved", "manage_employees", "employees_add", "manage_transportation", "driver_lead"];
  try {
    const driver = await guard.grantLimits({}, asRole("Driver"));
    assert.equal(driver.manager, false);
    assert.equal(driver.holds("manage_transportation"), true);
    assert.equal(driver.holds("manage_students"), false, "student records aren't the lead driver's to give");
    assert.equal(driver.role("Supervisor"), false);
    const manager = await guard.grantLimits({}, asRole("Manager"));
    assert.equal(manager.manager, true);
    assert.equal(manager.holds("manage_students"), true);
  } finally {
    perms.getUserPermissions = saved;
  }
});

test("staff above your own role can't be changed, held or removed through the staff pages", async () => {
  const savedPrimary = perms.getPrimaryManagerUserId;
  const db = (accountType) => ({ query: async (sql) => (/FROM users/.test(sql) ? { rows: [{ account_type: accountType }] } : { rows: [] }) });
  try {
    // getPrimaryManagerUserId is read when the guard loads; stand in through the database it asks.
    assert.match(await guard.staffChangeRefusal(db("Supervisor"), asRole("Driver"), 99), /at or below your own/);
    assert.match(await guard.staffChangeRefusal(db("Teacher"), asRole("Driver"), 99), /at or below your own/);
    assert.equal(await guard.staffChangeRefusal(db("Driver"), asRole("Driver"), 99), null, "a lead driver works on drivers");
    assert.equal(await guard.staffChangeRefusal(db("Teacher"), asRole("Supervisor"), 99), null);
    assert.match(await guard.staffChangeRefusal(db("Manager"), asRole("Supervisor"), 99), /Only a manager/);
    assert.equal(await guard.staffChangeRefusal(db("Supervisor"), asRole("Manager"), 99), null, "a manager changes anyone");
    assert.match(await guard.staffChangeRefusal(db("Driver"), asRole("Driver", 99), 99), /your own account/);
  } finally {
    perms.getPrimaryManagerUserId = savedPrimary;
  }
});
