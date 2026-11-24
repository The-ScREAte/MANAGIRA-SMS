"use strict";
// The staff permissions screen: each role's basics (utils/permissionBasics.js), the live "Can / Cannot"
// line and what happens to extras when the role changes (public/js/permissionLogic.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const ejs = require("ejs");
const perms = require("../middleware/permissionMiddleware");
const basics = require("../utils/permissionBasics");
const logic = require("../public/js/permissionLogic");

const P = perms.PERMISSIONS;
const real = perms.PERMISSION_OPTIONS.filter((o) => !o.retired);
const byKey = new Map(real.map((o) => [o.key, o]));
const everyRole = () => [
  ...Object.entries(basics.BASICS).map(([name, role]) => ({ name, base: name, keys: role.keys })),
  ...Object.entries(basics.SUGGESTED_ROLES).map(([name, role]) => ({ name, base: role.base, keys: role.keys })),
];
const mainsOf = (keys) => keys.filter((k) => !byKey.get(k).parent);
const data = basics.clientData();

test("every basic is a real permission, and never without its main permission", () => {
  everyRole().forEach((role) => {
    role.keys.forEach((key) => {
      const option = byKey.get(key);
      assert.ok(option, `${role.name}: ${key} isn't a permission`);
      for (let o = option; o.parent; o = byKey.get(o.parent)) assert.ok(role.keys.includes(o.parent), `${role.name}: ${key} is without ${o.parent}`);
    });
    assert.equal(new Set(role.keys).size, role.keys.length, `${role.name} lists one twice`);
  });
});

test("no High Risk permission is a basic of any role but Manager", () => {
  everyRole().filter((role) => role.base !== "Manager").forEach((role) => {
    const risky = role.keys.filter((key) => byKey.get(key).highRisk);
    assert.deepEqual(risky, [], `${role.name} has high-risk basics`);
  });
  // The Manager's own are few and named: staff access is the one that's a main permission.
  const manager = basics.BASICS.Manager.keys.filter((key) => byKey.get(key).highRisk);
  assert.deepEqual(manager.sort(), [P.EMPLOYEES_EDIT, P.EMPLOYEES_REMOVE, P.MANAGE_EMPLOYEES].sort());
});

test("a role's basics stay small: about 3 to 8 main permissions (a Driver starts with the dashboard alone)", () => {
  everyRole().forEach((role) => {
    const mains = mainsOf(role.keys).length;
    if (role.name === "Driver") return assert.equal(mains, 0);
    assert.ok(mains >= 3 && mains <= 10, `${role.name} has ${mains} main basics`);
  });
  ["Teacher", "Supervisor"].forEach((name) => assert.ok(mainsOf(basics.BASICS[name].keys).length <= 8, name));
});

test("a teacher has their own classes only: no staff, finance, settings or website", () => {
  const keys = new Set(basics.BASICS.Teacher.keys);
  [P.MANAGE_EMPLOYEES, P.MANAGE_PAYGIRA, P.MANAGE_BILLING, P.MANAGE_SETTINGS, P.SETTINGS_WEBSITE, P.STUDENTS_DELETE, P.STUDENTS_EDIT, P.CLASS_SETTINGS_ALL, P.MAILROOM].forEach((key) => assert.ok(!keys.has(key), key));
  [P.MARK_ATTENDANCE, P.MANAGE_ASSESSMENTS, P.CLASS_SETTINGS, P.REPORTS_TERMINAL].forEach((key) => assert.ok(keys.has(key), key));
});

test("whoever handles money has no staff access or settings", () => {
  everyRole().filter((role) => role.keys.includes(P.MANAGE_PAYGIRA)).forEach((role) => {
    [P.MANAGE_EMPLOYEES, P.MANAGE_SETTINGS, P.MANAGE_BILLING, P.PAYGIRA_PAYOUTS, P.PAYGIRA_SETTINGS].forEach((key) => assert.ok(!role.keys.includes(key), `${role.name}: ${key}`));
  });
  assert.ok(basics.SUGGESTED_ROLES["Bursar / finance"].keys.includes(P.MANAGE_PAYGIRA));
});

test("Mira is an advanced permission for every role, with org-wide skill creation under it", () => {
  everyRole().forEach((role) => {
    assert.ok(!role.keys.includes(P.USE_MIRA), role.name);
    assert.ok(!role.keys.includes(P.MIRA_SCHOOL_SKILLS), role.name);
  });
  const skills = byKey.get(P.MIRA_SCHOOL_SKILLS);
  assert.equal(skills.parent, P.USE_MIRA);
  assert.equal(skills.label, "Org-wide skill creation");
  // Shown under Mira for every role, not hidden with the other high-risk ones.
  assert.ok(!data.highRisk.includes(P.MIRA_SCHOOL_SKILLS));
});

test("every main permission has a bundle, and there are 6 to 8 bundles", () => {
  assert.ok(basics.BUNDLES.length >= 6 && basics.BUNDLES.length <= 8);
  const ids = new Set(basics.BUNDLES.map((b) => b.id));
  real.filter((o) => !o.parent).forEach((o) => {
    assert.ok(ids.has(basics.BUNDLE_OF[o.key]), `${o.key} has no bundle`);
  });
  basics.BUNDLES.forEach((b) => assert.ok(b.label, b.id));
});

test("basics follow the school's plan: what isn't offered goes, with its follow-ups", () => {
  const available = new Set(real.map((o) => o.key).filter((k) => k !== P.MANAGE_STUDENTS));
  const teacher = basics.basicsFor("Teacher", { available });
  assert.ok(!teacher.includes(P.MANAGE_STUDENTS));
  const supervisor = basics.basicsFor("Supervisor", { available });
  assert.ok(!supervisor.includes(P.STUDENTS_ADD) && !supervisor.includes(P.STUDENTS_EDIT), "follow-ups leave with their main permission");
  assert.ok(basics.basicsFor("Teacher", { questions: true }).includes(P.SET_ASSESSMENT_QUESTIONS));
  assert.ok(!basics.basicsFor("Teacher").includes(P.SET_ASSESSMENT_QUESTIONS));
});

test("extras are counted once: a follow-up of an extra permission is part of it", () => {
  const held = [P.MARK_ATTENDANCE, P.MANAGE_PAYGIRA, P.PAYGIRA_CLASSROOM, P.PAYGIRA_WORKSPACE, P.PAYGIRA_BILLS, P.USE_MIRA];
  assert.deepEqual(logic.extraKeys(held, [P.MARK_ATTENDANCE], data.parentOf), [P.MANAGE_PAYGIRA, P.USE_MIRA]);
  // A follow-up beyond a basic main permission is an extra of its own.
  assert.deepEqual(logic.extraKeys([P.MANAGE_STUDENTS, P.STUDENTS_ADD], [P.MANAGE_STUDENTS], data.parentOf), [P.STUDENTS_ADD]);
  assert.deepEqual(logic.extraKeys([P.MARK_ATTENDANCE], [P.MARK_ATTENDANCE], data.parentOf), []);
});

test("changing the role: the new basics, and the extras someone was given are kept", () => {
  const teacher = basics.basicsFor("Teacher");
  const supervisor = basics.basicsFor("Supervisor");
  // A teacher who was also given fees and the mailroom.
  const held = [...teacher, P.MANAGE_PAYGIRA, P.PAYGIRA_CLASSROOM, P.MAILROOM];
  const result = logic.switchRole({ held, oldBasics: teacher, newBasics: supervisor, data });
  [P.MANAGE_PAYGIRA, P.PAYGIRA_CLASSROOM, P.MAILROOM].forEach((key) => assert.ok(result.next.includes(key), `${key} kept`));
  supervisor.forEach((key) => assert.ok(result.next.includes(key), `${key} basic`));
  // Only the old role's own basics that the new one doesn't have are turned off, and they're told.
  assert.deepEqual(result.turnedOff.sort(), teacher.filter((key) => !supervisor.includes(key)).sort());
  assert.ok(result.turnedOff.includes(P.CLASS_SETTINGS));
  assert.deepEqual(result.turnedOn.sort(), supervisor.filter((key) => !held.includes(key)).sort());
  // Switching and switching back leaves a teacher with their basics and their extras.
  const back = logic.switchRole({ held: result.next, oldBasics: supervisor, newBasics: teacher, data });
  [...teacher, P.MANAGE_PAYGIRA, P.PAYGIRA_CLASSROOM, P.MAILROOM].forEach((key) => assert.ok(back.next.includes(key), `${key} back`));
});

test("the first role chosen keeps anything already on and adds the basics", () => {
  const result = logic.switchRole({ held: [P.MAILROOM], oldBasics: null, newBasics: basics.basicsFor("Teacher"), data });
  assert.ok(result.next.includes(P.MAILROOM) && result.next.includes(P.MARK_ATTENDANCE));
  assert.deepEqual(result.turnedOff, []);
});

test("a follow-up never stays without its main permission", () => {
  const supervisor = basics.basicsFor("Supervisor");
  // The supervisor was given Edit students; a teacher has no Manage Students... it has the list only, so the follow-up stays.
  const teacher = basics.basicsFor("Teacher");
  const ok = logic.switchRole({ held: supervisor, oldBasics: supervisor, newBasics: teacher, data });
  assert.ok(ok.next.includes(P.MANAGE_STUDENTS) && !ok.next.includes(P.STUDENTS_EDIT));
  // Without Manage Students in the new basics, an extra follow-up has nothing to sit under: turned off, and said so.
  const noStudents = teacher.filter((key) => key !== P.MANAGE_STUDENTS);
  const orphan = logic.switchRole({ held: [P.MANAGE_STUDENTS, P.STUDENTS_ADD, P.MARK_ATTENDANCE], oldBasics: [P.MANAGE_STUDENTS, P.MARK_ATTENDANCE], newBasics: noStudents, data });
  assert.ok(!orphan.next.includes(P.STUDENTS_ADD));
  assert.ok(orphan.turnedOff.includes(P.STUDENTS_ADD));
});

test("a driver holds only driving and transportation, and Users / Employees only as a lead", () => {
  const held = [P.MARK_ATTENDANCE, P.MAILROOM, P.USE_MIRA];
  const toDriver = logic.switchRole({ held, oldBasics: [P.MARK_ATTENDANCE], newBasics: [], data, toDriver: true });
  assert.deepEqual(toDriver.next, [], "nothing a driver can't hold comes along");
  assert.deepEqual(toDriver.turnedOff.sort(), held.sort(), "and each one is told");
  const lead = logic.switchRole({ held: [P.DRIVER_LEAD, P.MANAGE_TRANSPORTATION, P.MANAGE_EMPLOYEES], oldBasics: [], newBasics: [], data, toDriver: true });
  assert.ok(lead.next.includes(P.MANAGE_EMPLOYEES));
  const notLead = logic.switchRole({ held: [P.MANAGE_TRANSPORTATION, P.MANAGE_EMPLOYEES], oldBasics: [], newBasics: [], data, toDriver: true });
  assert.ok(!notLead.next.includes(P.MANAGE_EMPLOYEES));
  // Back from a driver: the driver-only permissions go.
  const fromDriver = logic.switchRole({ held: [P.DRIVER_LEAD, P.DRIVER_ANY_ROUTE], oldBasics: [], newBasics: basics.basicsFor("Teacher"), data, toDriver: false });
  assert.ok(!fromDriver.next.includes(P.DRIVER_LEAD) && fromDriver.next.includes(P.MARK_ATTENDANCE));
});

test("high-risk permissions are the page's list, and the page data is safe to put in a script tag", () => {
  assert.ok(data.highRisk.includes(P.MANAGE_BILLING) && data.highRisk.includes(P.SETTINGS_INTEGRATIONS) && data.highRisk.includes(P.SETTINGS_SERVICE_ACCOUNTS) && data.highRisk.includes(P.MANAGE_SSO) && data.highRisk.includes(P.STUDENTS_DELETE) && data.highRisk.includes(P.EMPLOYEES_EDIT));
  const ui = basics.pageData({ options: perms.PERMISSION_OPTIONS, roleBasics: { Teacher: ["</script><b>"] } });
  assert.ok(!ui.json.includes("</script>"));
  assert.ok(ui.logic.includes("ManagiraPermissionLogic"));
});

test("the screen renders: nothing but 'Choose a role' until a role is chosen, switches still named permissions", async () => {
  const options = perms.permissionOptionsFor({});
  const roleBasics = basics.basicsMap({ available: new Set(options.map((o) => o.key)) });
  const html = await ejs.renderFile(path.join(__dirname, "..", "views", "partials", "permissionPicker.ejs"), {
    permissionOptions: options, selectedPermissions: [], classes: [], canAssignHighRisk: true,
    permissionUi: basics.pageData({ options, roleBasics, canHighRisk: true }),
  });
  assert.match(html, /Choose a role to see its permissions\./);
  assert.match(html, /id="permBody" hidden/);
  assert.match(html, /Advanced permissions/);
  assert.match(html, /High risk - Managers only/);
  assert.ok((html.match(/name=permissions/g) || []).length >= 70, "every permission still has its switch");
  assert.ok(!/Allow all permissions<\/span>/.test(html), "the old always-visible allow-all is gone");
  assert.ok(!/ALLOW ALL/.test(html), "allow-all needs no typed confirmation");
  assert.match(html, /id="permAllOpen">Allow all permissions</);
});
