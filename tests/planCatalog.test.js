const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// The plan catalog is released for school 63 only, as on the sandbox.
const featuresPath = path.join(__dirname, "..", "utils", "shards", "features.js");
require.cache[featuresPath] = {
  id: featuresPath,
  filename: featuresPath,
  loaded: true,
  exports: { FEATURES: {}, isOn: (key, { organizationId } = {}) => (key === "plan_catalog" ? Number(organizationId) === 63 : true) },
};
const catalog = require("../utils/planCatalog");
const { permissionOptionsFor, withinPlan } = require("../middleware/permissionMiddleware");

const SANDBOX = 63;
const OTHER = 146;
const rowsOf = (tiers) => catalog.PLAN.filter((item) => tiers.includes(item.tier)).flatMap((item) => item.names);
const CORE_ROWS = catalog.CORE.filter((item) => item.name).map((item) => item.name);
const STARTER = [...CORE_ROWS, ...rowsOf(["Starter"])];
const PRO = [...CORE_ROWS, ...rowsOf(["Starter", "Pro"])];
const PREMIUM = [...CORE_ROWS, ...rowsOf(["Starter", "Pro", "Premium"])];
const keysFor = (organizationId, features) => permissionOptionsFor({ organizationId, allowedFeatures: catalog.withCore(features, organizationId) }).map((o) => o.key);

test("a plan with nothing ticked still runs a school: the core is always included", () => {
  const keys = keysFor(SANDBOX, []);
  ["manage_students", "manage_guardians", "see_contacts", "manage_assessments", "mark_attendance", "manage_employees", "manage_classes_subjects"]
    .forEach((key) => assert.ok(keys.includes(key), `${key} with an empty plan`));
  ["manage_reports", "reports_builder", "generate_transcripts", "manage_paygira", "settings_website", "set_assessment_questions"]
    .forEach((key) => assert.ok(!keys.includes(key), `${key} needs its plan feature`));
});

test("Starter, Pro and Premium each open what their plan says", () => {
  const starter = keysFor(SANDBOX, STARTER), pro = keysFor(SANDBOX, PRO), premium = keysFor(SANDBOX, PREMIUM);
  // PayGira and report cards are in every plan.
  [starter, pro, premium].forEach((keys) => ["manage_paygira", "manage_reports", "reports_terminal"].forEach((key) => assert.ok(keys.includes(key), key)));
  // Pro adds online tests, transcripts and report card templates.
  ["set_assessment_questions", "generate_transcripts", "reports_settings"].forEach((key) => {
    assert.ok(!starter.includes(key), `${key} is not in Starter`);
    assert.ok(pro.includes(key) && premium.includes(key), `${key} from Pro`);
  });
  // Premium adds Report builder and the school website.
  ["reports_builder", "settings_website", "driver_report_builder"].forEach((key) => {
    assert.ok(!starter.includes(key) && !pro.includes(key), `${key} is Premium only`);
    assert.ok(premium.includes(key), `${key} in Premium`);
  });
});

test("where the catalog isn't released, plans work as before", () => {
  assert.deepEqual(catalog.withCore([], OTHER), []);
  assert.equal(catalog.withCore(null, SANDBOX), null, "an unreadable plan stays unreadable");
  assert.ok(!keysFor(OTHER, []).includes("manage_assessments"));
  assert.ok(withinPlan("reports_builder", ["Terminal Report"], OTHER), "Report builder came with report cards");
  assert.ok(withinPlan("reports_settings", ["Terminal Report"], OTHER), "and so did report settings");
});

test("the plan form offers each feature once, by the plan that first has it, and keeps what it no longer offers", () => {
  const form = catalog.planForm([
    { id: 34, feature_name: "Organization Dashboard" },
    { id: 37, feature_name: "Progressive Student Report" },
    { id: 41, feature_name: "Terminal Report" },
    { id: 64, feature_name: "Parent/Guardian Portal" },
    { id: 83, feature_name: "Lesson Notes" },
    { id: 95, feature_name: "Report Builder" },
    { id: 99, feature_name: "Something new" },
  ]);
  assert.deepEqual(form.choices.map((c) => c.key), ["report_cards", "parent_portal", "report_builder", "row_99"]);
  assert.deepEqual(form.choices[0].ids.sort(), [37, 41], "report cards and progress reports are one tick");
  assert.deepEqual(form.coreIds, [34]);
  assert.deepEqual(form.keptIds, [83]);
  assert.deepEqual(form.groups.map((g) => g.tier), ["Starter", "Premium", "Other"]);
});

test("plan cards list only what each plan adds to the one before it", () => {
  const plans = catalog.ladder([
    { plan_id: 1, plan_name: "Starter", features: [...STARTER, "Lesson Notes"].map((feature_name) => ({ feature_name })) },
    { plan_id: 2, plan_name: "Pro", features: PRO.map((feature_name) => ({ feature_name })) },
    { plan_id: 3, plan_name: "Premium", features: PREMIUM.map((feature_name) => ({ feature_name })) },
  ]);
  const labels = (list) => list.map((f) => f.feature_name);
  assert.deepEqual(labels(plans[0].newFeatures), ["School dashboard", "Student and family records", "Attendance", "Gradebook and assessments",
    "Report cards and progress reports", "Parent portal", "Student portal", "PayGira fees and payments", "School analytics"]);
  assert.equal(plans[0].plusOf, null);
  assert.equal(plans[1].plusOf, "Starter");
  assert.deepEqual(labels(plans[1].newFeatures), ["Online tests and Testing Room", "Official transcripts", "Custom report card templates", "Class merit sheets", "Class analytics", "Mira Basic for staff"]);
  assert.equal(plans[2].plusOf, "Pro");
  assert.deepEqual(labels(plans[2].newFeatures), ["Report builder", "School website and online admissions", "Docs and sheets", "Transportation", "Full Mira for all staff", "Priority support"]);
  // Opened, a card says where each inherited feature came from, the nearest plan first, each once.
  assert.deepEqual(plans[0].inherited, []);
  assert.deepEqual(plans[1].inherited.map((g) => g.from), ["Starter"]);
  assert.deepEqual(plans[2].inherited.map((g) => [g.from, g.features.length]), [["Pro", 6], ["Starter", 9]]);
  assert.deepEqual(plans.map((p) => p.popular), [false, true, false], "Pro is the one marked Most popular");
  // A plan that doesn't have everything of the one before it is shown whole.
  const odd = catalog.ladder([{ plan_name: "A", features: ["PayGira", "Report Builder"] }, { plan_name: "B", features: ["PayGira"] }]);
  assert.equal(odd[1].plusOf, null);
  assert.equal(odd[1].newFeatures.length, 5);
});

test("a plan's add-ons are the ones it includes", () => {
  assert.deepEqual([...catalog.includedAddons(STARTER)].sort(), ["parent_portal", "student_portal"]);
  assert.deepEqual([...catalog.includedAddons(PRO)].sort(), ["mira", "parent_portal", "student_portal"]);
  assert.deepEqual([...catalog.includedAddons(PREMIUM)].sort(), ["mira", "parent_portal", "student_portal", "transportation"]);
  assert.equal(catalog.includedAddons([]).size, 0);
});
