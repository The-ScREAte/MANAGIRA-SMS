// A school is shown as it is: what an integration switched off takes away, who counts as the
// owner, who leads a class, and PayGira's menu. No database: each test answers the few
// questions asked of it.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERMISSIONS,
  userHasPermission,
  integrationOf,
  sessionActor,
  isOrganizationOwnerUser,
} = require("../middleware/permissionMiddleware");
const integrationSwitches = require("../utils/integrationSwitches");
const { workspaceAccess, paygiraPlaceOf } = require("../utils/workspaceAccess");
const mainTeacher = require("../utils/mainTeacher");

// A database that answers by what the question looks like; anything else finds nothing.
const fakeDb = (answers = []) => ({
  asked: [],
  async query(text, params) {
    this.asked.push({ text: String(text), params });
    for (const [pattern, rows] of answers) {
      if (pattern.test(String(text))) return { rows: typeof rows === "function" ? rows(params, String(text)) : rows };
    }
    return { rows: [] };
  },
});
// Each test uses its own school, so nothing remembered by one reaches another.
let nextSchool = 910000;
const newSchool = () => { nextSchool += 1; return nextSchool; };
const SWITCHES = /SELECT transportation_activated, mira_activated FROM organizations/;

test("every Transportation and Driver permission belongs to transportation; nothing else does", () => {
  ["manage_transportation", "transport_buses", "transport_settings", "transport_class_reports", "driver_lead", "driver_student_details", "driver_report_builder"]
    .forEach((key) => assert.equal(integrationOf(key), "transportation", key));
  ["manage_students", "manage_employees", "mark_attendance", "paygira_bills", "reports_builder", "use_mira", "settings_integrations"]
    .forEach((key) => assert.equal(integrationOf(key), null, key));
});

test("a school's switches are read once and forgotten when one is flipped", async () => {
  const school = newSchool();
  let on = false;
  const db = fakeDb([[SWITCHES, () => [{ transportation_activated: on, mira_activated: true }]]]);
  assert.equal(await integrationSwitches.isOn(db, school, "transportation"), false);
  assert.equal(await integrationSwitches.isOn(db, school, "mira"), true);
  assert.equal(db.asked.filter((q) => SWITCHES.test(q.text)).length, 1, "the second question is answered from memory");
  on = true;
  assert.equal(await integrationSwitches.isOn(db, school, "transportation"), false, "still remembered");
  integrationSwitches.forget(school);
  assert.equal(await integrationSwitches.isOn(db, school, "transportation"), true, "asked again once forgotten");
});

test("switches that can't be read leave access alone", async () => {
  const school = newSchool();
  const db = { async query() { throw new Error("the database is busy"); } };
  assert.equal(await integrationSwitches.isOn(db, school, "transportation"), true);
  assert.equal(await integrationSwitches.switchesFor(db, null), null);
});

test("with transportation off nobody holds its permissions, the owner included; everything else stays", async () => {
  const school = newSchool();
  const db = fakeDb([[SWITCHES, [{ transportation_activated: false, mira_activated: false }]]]);
  const owner = { userId: school, userRole: "Manager", organizationId: school, accountType: "Organization", userEmail: "owner@school.example" };
  assert.equal(await userHasPermission(db, owner, PERMISSIONS.MANAGE_TRANSPORTATION), false);
  assert.equal(await userHasPermission(db, owner, "transport_buses"), false);
  assert.equal(await userHasPermission(db, owner, PERMISSIONS.MANAGE_STUDENTS), true);
  assert.equal(await userHasPermission(db, owner, PERMISSIONS.SETTINGS_INTEGRATIONS), true, "the owner can still reach Integrations to switch it on");
});

test("a driver holds nothing while transportation is off, and their own again once it is on", async () => {
  const off = newSchool();
  const on = newSchool();
  const saved = [/SELECT permission_key FROM user_permissions/, [{ permission_key: "driver_report_builder" }, { permission_key: "driver_student_details" }]];
  const dbOff = fakeDb([[SWITCHES, [{ transportation_activated: false, mira_activated: false }]], saved]);
  const dbOn = fakeDb([[SWITCHES, [{ transportation_activated: true, mira_activated: false }]], saved]);
  const driver = (school) => ({ userId: 5000 + school, userRole: "Driver", organizationId: school, accountType: "Driver", userEmail: "driver@school.example" });
  assert.equal(await userHasPermission(dbOff, driver(off), "driver_student_details"), false);
  assert.equal(await userHasPermission(dbOff, driver(off), PERMISSIONS.REPORTS_BUILDER), false, "the Report Builder a driver reaches through their own permission goes too");
  assert.equal(await userHasPermission(dbOn, driver(on), "driver_student_details"), true);
  assert.equal(await userHasPermission(dbOn, driver(on), PERMISSIONS.REPORTS_BUILDER), true);
});

test("the request's identity carries everything a permission check needs", () => {
  const asStaff = sessionActor({ session: { organizationId: 63, userRole: "Manager", accountType: "Manager", user: { user_id: 240, email: "owner@school.example", account_type: "Manager" } } });
  assert.deepEqual(asStaff, { userId: 240, userRole: "Manager", organizationId: 63, accountType: "Manager", userEmail: "owner@school.example" });
  // A school signed in as itself: its "user" id is the school's, and the account type says so.
  const asSchool = sessionActor({ session: { organizationId: 63, userRole: "Manager", accountType: "Organization", user: { user_id: 63, email: "owner@school.example", account_type: "Manager" } } }, { organizationId: 63 });
  assert.equal(asSchool.accountType, "Organization");
  assert.deepEqual(sessionActor({}), { userId: null, userRole: null, organizationId: null, accountType: null, userEmail: null });
  assert.equal(sessionActor({ session: { organizationId: 63 } }, { organizationId: 70 }).organizationId, 70);
});

test("the owner is recognised by who they are when a check was handed no email", async () => {
  const school = newSchool();
  const OWNER = /JOIN organizations o ON o\.organization_id = u\.organization_id/;
  const db = fakeDb([[OWNER, (params) => (params[0] === 77 && params[1] === school ? [{ "?column?": 1 }] : [])]]);
  assert.equal(await isOrganizationOwnerUser(db, school, 77), true);
  assert.equal(await isOrganizationOwnerUser(db, school, 78), false);
  assert.equal(await isOrganizationOwnerUser(db, school, "not a number"), false);
  // In a check: the owner, with neither the email nor the account type passed along.
  assert.equal(await userHasPermission(db, { userId: 77, userRole: "Manager", organizationId: school }, PERMISSIONS.MANAGE_EMPLOYEES), true);
  // Another manager, saved with nothing, is not the owner.
  assert.equal(await userHasPermission(db, { userId: 78, userRole: "Manager", organizationId: school }, PERMISSIONS.MANAGE_EMPLOYEES), false);
  // A teacher is never asked about: an email or id alone makes nobody the owner.
  const before = db.asked.filter((q) => OWNER.test(q.text)).length;
  assert.equal(await userHasPermission(db, { userId: 77, userRole: "Teacher", organizationId: school }, PERMISSIONS.MANAGE_BILLING), false);
  assert.equal(db.asked.filter((q) => OWNER.test(q.text)).length, before);
});

// ---------- the main teacher ----------
const classClient = (leadsBefore = []) => ({
  writes: [],
  async query(text, params) {
    const sql = String(text).replace(/\s+/g, " ").trim();
    if (/^SELECT class_id FROM user_classes WHERE user_id = \$1 AND main = TRUE/.test(sql)) return { rows: leadsBefore.map((class_id) => ({ class_id })) };
    this.writes.push({ sql, params });
    return { rows: [] };
  },
});
const inserted = (client) => client.writes.find((w) => /^INSERT INTO user_classes/.test(w.sql));
const steppedDown = (client) => client.writes.find((w) => /^UPDATE user_classes uc SET main = FALSE/.test(w.sql));

test("saving a person's classes sets the ones they lead, one main teacher per class", async () => {
  const client = classClient([]);
  const result = await mainTeacher.saveClasses(client, { organizationId: 63, userId: 9, classIds: [146, 147, "148"], mainClassIds: ["146", 999], shown: true });
  assert.deepEqual(result, { classes: [146, 147, 148], leads: [146] });
  assert.deepEqual(inserted(client).params, [9, [146, 147, 148], [146]], "only a class they are in can be led");
  assert.deepEqual(steppedDown(client).params, [[146], 9, 63], "whoever led it before steps down, within this school");
});

test("a save that didn't show the choice keeps what the person already leads", async () => {
  const client = classClient([146, 150]);
  const result = await mainTeacher.saveClasses(client, { organizationId: 63, userId: 9, classIds: [146, 147], mainClassIds: undefined, shown: false });
  assert.deepEqual(result.leads, [146], "still leading the class they kept; the one they left is given up");
});

test("unticking gives a class up, and a driver never leads one", async () => {
  const untick = classClient([146]);
  assert.deepEqual((await mainTeacher.saveClasses(untick, { organizationId: 63, userId: 9, classIds: [146], mainClassIds: [], shown: true })).leads, []);
  assert.equal(steppedDown(untick), undefined);
  const driver = classClient([146]);
  assert.deepEqual((await mainTeacher.saveClasses(driver, { organizationId: 63, userId: 9, classIds: [146], mainClassIds: [146], shown: true, canLead: false })).leads, []);
  const none = classClient([146]);
  assert.deepEqual(await mainTeacher.saveClasses(none, { organizationId: 63, userId: 9, classIds: [], mainClassIds: [146], shown: true }), { classes: [], leads: [] });
  assert.equal(inserted(none), undefined);
});

// ---------- PayGira's menu ----------
const paygiraFor = (...keys) => workspaceAccess({ permissions: ["paygira_workspace", ...keys], features: ["PayGira"], role: "Supervisor" }).paygira;

test("PayGira has six places; repeating bills and overdue balances are tabs of two of them", () => {
  const all = paygiraFor("paygira_overview", "paygira_bills", "paygira_org_bills", "paygira_subscriptions", "paygira_payments", "paygira_recovery", "paygira_payouts", "paygira_settings");
  assert.deepEqual(all.menu.map((place) => place.label), ["Overview", "Bills", "Student ledger", "Payments", "Pay staff & vendors", "Settings"]);
  assert.deepEqual(all.menu.find((place) => place.id === "bills").tabs.map((tab) => tab.label), ["All bills", "Repeating"]);
  assert.deepEqual(all.menu.find((place) => place.id === "students").tabs.map((tab) => tab.label), ["Balances", "Overdue"]);
  assert.equal(paygiraPlaceOf("subscriptions"), "bills");
  assert.equal(paygiraPlaceOf("arrears"), "students");
  assert.equal(paygiraPlaceOf("payments"), "payments");
  assert.equal(paygiraPlaceOf("nothing"), null);
});

test("a place shows for any page of it the person holds, and opens on that page", () => {
  const overdueOnly = paygiraFor("paygira_recovery");
  assert.deepEqual(overdueOnly.menu.map((place) => place.id), ["students"]);
  assert.equal(overdueOnly.menu[0].url, "/account/settings/finance/arrears");
  assert.deepEqual(overdueOnly.menu[0].tabs.map((tab) => tab.id), ["arrears"]);
  const billsOnly = paygiraFor("paygira_bills");
  assert.deepEqual(billsOnly.menu.map((place) => place.label), ["Bills"]);
  assert.equal(billsOnly.menu[0].tabs.length, 1, "no tabs to show with one page");
  assert.deepEqual(paygiraFor().menu, [], "PayGira with no page ticked lists nothing");
  // Without Main PayGira nothing is listed, whatever pages are ticked.
  assert.deepEqual(workspaceAccess({ permissions: ["paygira_bills"], features: ["PayGira"], role: "Supervisor" }).paygira.menu, []);
});
