// Mira's safety rules: each person's own permissions, staff only, no
// invented figures, no delete tools unless asked, and a long chat's memory.
const test = require("node:test");
const assert = require("node:assert/strict");

const { checkTool, describeAccess, accessSummary, TOOL_ACCESS } = require("../services/access");
const { unsupportedFigures } = require("../services/grounding");
const { isDestructiveTool, destructiveAllowed, blockedIntents, selectToolSchemas } = require("../services/toolSelector");
const { buildDigest } = require("../services/orchestrator");
const { REGISTRY, runTool } = require("../tools");

const permissions = [
  { key: "manage_students", label: "Manage Students", parent: null, group: "People", description: "See the student list" },
  { key: "mark_attendance", label: "Mark Attendance", parent: null, group: "Academics", description: "Mark attendance" },
  { key: "mailroom", label: "Mailroom", parent: null, group: "Communication", description: "Send SMS, WhatsApp and email to guardians" },
  { key: "manage_reports", label: "Manage Reports/Printing", parent: null, group: "Reports", description: "" },
  { key: "reports_builder", label: "Manage Reports/Printing: Report Builder", parent: "manage_reports", group: null, description: "" },
  { key: "manage_paygira", label: "PayGira", parent: null, group: "Finance", description: "Fees and payments" },
  { key: "paygira_org_bills", label: "PayGira: Main PayGira: Org-Wide Bills", parent: "manage_paygira", group: null, description: "" },
  { key: "paygira_payments", label: "PayGira: Main PayGira: Payment Tracking", parent: "manage_paygira", group: null, description: "" },
  { key: "driver_any_route", label: "Any Route", parent: null, group: "Driver", description: "Drive any route" },
];
const access = (held, extra = {}) => ({
  ok: true,
  held: new Set(held),
  notInPlan: new Set(extra.notInPlan || []),
  labels: new Map(permissions.map((p) => [p.key, p.label])),
  permissions,
  classes: extra.classes === undefined ? null : extra.classes,
  features: { mira_outreach: true, ...(extra.features || {}) },
});
const teacher = { viewerType: "staff", userRole: "Teacher", accountType: "Teacher", displayName: "Sam Lee" };
const manager = { viewerType: "staff", userRole: "Manager", accountType: "Manager", displayName: "Sarah Mitchell" };

test("every tool rule names a tool that exists", () => {
  Object.keys(TOOL_ACCESS).forEach((name) => assert.ok(REGISTRY[name], `${name} has a rule but no tool`));
});

test("a tool needs the person's own permission", () => {
  const teacherAccess = access(["manage_students", "mark_attendance"]);
  assert.equal(checkTool("find_student", teacher, teacherAccess).allowed, true);
  const refused = checkTool("send_message", teacher, teacherAccess);
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /You don't have the \*\*Mailroom\*\* permission/);
});

test("any one of several permissions is enough, and all of an allOf are needed", () => {
  assert.equal(checkTool("get_fees", manager, access(["paygira_payments"])).allowed, true);
  const missing = checkTool("find_low_attendance", manager, access(["mark_attendance"]));
  assert.equal(missing.allowed, false);
  assert.match(missing.reason, /Report Builder/);
  assert.equal(checkTool("find_low_attendance", manager, access(["mark_attendance", "reports_builder"])).allowed, true);
});

test("something outside the school's plan is said to be outside the plan", () => {
  const result = checkTool("get_fees", manager, access([], { notInPlan: ["paygira_org_bills", "paygira_payments"] }));
  assert.equal(result.allowed, false);
  assert.match(result.reason, /plan doesn't include/);
});

test("a feature not released to the school isn't offered", () => {
  const result = checkTool("find_low_attendance", manager, access(["mark_attendance", "reports_builder"], { features: { mira_outreach: false } }));
  assert.equal(result.allowed, false);
  assert.match(result.reason, /isn't available for your school yet/);
});

test("parents and students can't use any tool", () => {
  assert.equal(checkTool("get_term", { viewerType: "guardian" }, access([])).allowed, false);
  assert.equal(checkTool("find_student", { viewerType: "student" }, access(["manage_students"])).allowed, false);
});

test("unknown access refuses anything that needs a permission", () => {
  const unknown = { ok: false, held: new Set(), notInPlan: new Set(), labels: new Map(), permissions: [], classes: null, features: {} };
  assert.equal(checkTool("find_student", teacher, unknown).allowed, false);
  assert.equal(checkTool("get_my_calendar", teacher, unknown).allowed, true);
});

test("runTool refuses before the tool runs", async () => {
  const result = await runTool("send_message", { message: "hi", channels: ["email"] }, teacher, { access: access(["manage_students"]) });
  assert.equal(result.status, "denied");
  assert.match(result.result, /Mailroom/);
});

test("email problems are for managers and supervisors only", () => {
  assert.equal(checkTool("list_failed_emails", teacher, access([])).allowed, false);
  assert.equal(checkTool("list_failed_emails", manager, access([])).allowed, true);
});

test("the access summary lists what they hold and what they don't, without driver-only items", () => {
  const text = describeAccess(teacher, access(["manage_students", "manage_reports", "reports_builder"], { classes: ["7th Grade"] }));
  assert.match(text, /holds: Manage Students; Manage Reports\/Printing \(Report Builder\)/);
  assert.match(text, /do NOT have.*Mailroom - Send SMS/);
  assert.match(text, /7th Grade/);
  assert.doesNotMatch(text, /Any Route/);
  const summary = accessSummary(teacher, access(["manage_students"]));
  assert.deepEqual(summary.can, ["Manage Students"]);
  assert.ok(summary.cannot.includes("Mailroom"));
});

test("tools the person can't use are never offered", () => {
  const schemas = [{ name: "find_student" }, { name: "send_message" }, { name: "get_term" }];
  const offered = selectToolSchemas(schemas, new Set(["students", "communication"]), (name) => name !== "send_message").map((s) => s.name);
  assert.ok(offered.includes("find_student"));
  assert.ok(!offered.includes("send_message"));
  assert.ok(offered.includes("load_tools"));
});

test("delete tools are only offered when the person asked to delete", () => {
  assert.equal(isDestructiveTool("delete_class"), true);
  assert.equal(isDestructiveTool("set_employee_hold"), true);
  assert.equal(isDestructiveTool("draft_family_messages"), false);
  assert.equal(destructiveAllowed("Draft a message to their families.", []), false);
  assert.equal(destructiveAllowed("Please delete the Load Test Class", []), true);
  // A "yes" to a delete warning still finds the request just before it.
  assert.equal(destructiveAllowed("yes", [{ role: "user", content: "remove the Science subject" }, { role: "assistant", content: "Are you sure?" }]), true);
});

test("a request needing a missing permission is caught before Mira answers", () => {
  const none = () => false;
  assert.deepEqual(blockedIntents("Send a message to all parents about the field trip", none).map((i) => i.what), ["messaging families"]);
  assert.deepEqual(blockedIntents("How much does Emma Carter owe?", none).map((i) => i.what), ["fees and payments"]);
  assert.deepEqual(blockedIntents("Send a message to all parents", (name) => name === "send_message"), []);
  assert.deepEqual(blockedIntents("Which students are below 90% attendance?", none), []);
});

test("figures that appear in no tool result are caught, rounding and dates are fine", () => {
  const evidence = ['{"total":6,"rows":[{"rate":84.46},{"rate":72.0}],"date":"2026-10-12T00:00:00.000Z"}', "Which 7th Grade students are below 90%?"];
  assert.deepEqual(unsupportedFigures("**6 students** below 90%: Emma 84.5%, Liam 72% (since October 12).", evidence), []);
  assert.deepEqual(unsupportedFigures("There are 1,250 students and 6 are below 90%.", evidence), ["1,250"]);
  assert.deepEqual(unsupportedFigures("1. First step\n2. Second step", evidence), []);
  assert.deepEqual(unsupportedFigures("See [the report](https://example.com/r/98765).", evidence), []);
});

test("a long chat keeps a short digest of its oldest messages", () => {
  const digest = buildDigest([
    { role: "user", content: "Which 7th Grade students are below 90% attendance?", tool_calls: null },
    { role: "assistant", content: "Six students: " + "x".repeat(400), tool_calls: [{ name: "find_low_attendance" }] },
  ]);
  assert.match(digest, /^Person: Which 7th Grade students/);
  assert.match(digest, /Mira: Six students: x+\.\.\. \[looked up with: find_low_attendance\]/);
  assert.ok(digest.split("\n")[1].length < 300);
});
