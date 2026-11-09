// Emergency & pickup sharing (feature "family_sharing"): who else sees a parents &
// guardians section, the driver permission, and the migration being safe to repeat.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { FEATURES } = require("../utils/shards/features");
const { PERMISSIONS, PERMISSION_OPTIONS, driverPermissions } = require("../middleware/permissionMiddleware");
const contacts = require("../utils/contacts");

test("sharing is released to every school", () => {
  assert.equal(FEATURES.family_sharing.access, "everyone");
  assert.deepEqual(contacts.AUDIENCES, ["parents", "students", "teachers", "drivers"]);
});

test("drivers can hold Pickup & Emergency, and only drivers' permissions survive for a driver", () => {
  const option = PERMISSION_OPTIONS.find((o) => o.key === PERMISSIONS.DRIVER_FAMILY_DETAILS);
  assert.ok(option, "the permission is offered");
  assert.equal(option.group, "Driver");
  assert.ok(driverPermissions([PERMISSIONS.DRIVER_FAMILY_DETAILS, "settings_website"]).includes(PERMISSIONS.DRIVER_FAMILY_DETAILS));
  assert.ok(!driverPermissions([PERMISSIONS.DRIVER_FAMILY_DETAILS, "settings_website"]).includes("settings_website"));
});

test("the migration only adds, and can run again", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/2026-11-09_family_sharing.sql"), "utf8")
    .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS shared_with TEXT\[\]/);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE/i);
});

test("parents, students, teachers and drivers each get their own door", () => {
  const guardianRoutes = fs.readFileSync(path.join(__dirname, "../routes/guardianRoute.js"), "utf8");
  assert.match(guardianRoutes, /router\.get\("\/family-details", isGuardianAuthenticated/);
  assert.match(guardianRoutes, /router\.post\("\/family-details", isGuardianAuthenticated/);
  const studentRoutes = fs.readFileSync(path.join(__dirname, "../routes/studentRoute.js"), "utf8");
  assert.match(studentRoutes, /router\.get\("\/family-details", isStudentAuthenticated/);
  const driver = fs.readFileSync(path.join(__dirname, "../controllers/driverController.js"), "utf8");
  assert.match(driver, /held\.includes\("driver_family_details"\)/);
  assert.match(driver, /filter\(\(student\) => student\.hasAccess\)/, "drivers see only their own riders");
});
