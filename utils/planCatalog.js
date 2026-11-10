// Everything a school can use, in one list. Admin › Pricing's plan form, the plan pages schools
// see, the plan checks (setAllowedFeatures, userHasPermission, checkFeatureAccess) and the bill
// (utils/orgPricing.js) all read it.
//
// - CORE: in every plan and never turned off, so a plan with nothing ticked still runs a school.
//   Those with a `name` are rows in `features` that pages check; `headline` ones are listed on
//   the plan cards schools see.
// - PLAN: ticked per plan in Admin › Pricing, in the order of the plan ladder. `names` are the
//   rows in `features` (what the pages check), `aliases` older spellings. `tier` is the standard
//   plan that first includes it (Starter, then Pro, then Premium): the form groups by it, the
//   database decides. `addon` means the plan includes that add-on, so a school on the plan
//   switches it on in Settings › Integrations at no charge; without it, the add-on is bought at
//   the price in Admin › Pricing › Add-ons.
// - NOT_IN_PLANS: old rows kept on plans but never offered or shown.
//
// The always-included rule and the per-feature checks for Report builder and report card
// templates apply where the `plan_catalog` release is on.
const features = require("./shards/features");

const TIERS = ["Starter", "Pro", "Premium"];

const CORE = [
  { key: "dashboard", name: "Organization Dashboard", label: "School dashboard", headline: true },
  { key: "records", name: "Student and Guardian Profile", aliases: ["Student and Guadian Profile"], label: "Student and family records", headline: true },
  { key: "attendance", name: "Attendance Tracking", aliases: ["Attendance tracking feature"], label: "Attendance", headline: true },
  { key: "gradebook", name: "Assessment Tracking", aliases: ["Assessment tracking feature"], label: "Gradebook and assessments", headline: true },
  { key: "classes", label: "Classes, subjects and timetables" },
  { key: "admissions", label: "Admissions, enrollment and promotions" },
  { key: "calendar", label: "Calendars and calendar sync" },
  { key: "activities", label: "Class activities and homework" },
  { key: "events", label: "Events and announcements" },
  { key: "mailroom", label: "Mail room" },
  { key: "pickup", label: "Emergency and pickup details" },
  { key: "staff", label: "Staff, roles and permissions" },
  { key: "security", label: "Single sign-on and sign-in rules" },
];

const PLAN = [
  { key: "report_cards", tier: "Starter", names: ["Terminal Report", "Progressive Student Report"], aliases: ["Progressive Student Report "], label: "Report cards and progress reports" },
  { key: "parent_portal", tier: "Starter", names: ["Parent/Guardian Portal"], aliases: ["Guardian Portal", "Parent Portal", "Parent Guardian Portal"], label: "Parent portal", addon: "parent_portal" },
  { key: "student_portal", tier: "Starter", names: ["Student Portal"], label: "Student portal", addon: "student_portal" },
  { key: "paygira", tier: "Starter", names: ["PayGira"], aliases: ["Pay Gira", "PayGira & Payments", "PayGira and Payments"], label: "PayGira fees and payments" },
  { key: "school_analytics", tier: "Starter", names: ["Organization Analytics & Insights"], label: "School analytics" },
  { key: "online_tests", tier: "Pro", names: ["Set Assessment Questions"], aliases: ["Assessment Questions"], label: "Online tests and Testing Room" },
  { key: "transcripts", tier: "Pro", names: ["Official School Transcript"], label: "Official transcripts" },
  { key: "report_templates", tier: "Pro", names: ["Custom Report Card Templates"], label: "Custom report card templates" },
  { key: "merit_sheets", tier: "Pro", names: ["Class Base Merit Sheet"], aliases: ["Class Base Merrit sheet"], label: "Class merit sheets" },
  { key: "class_analytics", tier: "Pro", names: ["Class Base Analytics & Insights"], label: "Class analytics" },
  { key: "mira_basic", tier: "Pro", names: ["Mira Basic"], label: "Mira Basic for staff", addon: "mira" },
  { key: "report_builder", tier: "Premium", names: ["Report Builder"], label: "Report builder" },
  { key: "website", tier: "Premium", names: ["School Website"], aliases: ["SchoolWebsite", "Public Website", "PublicWebsite"], label: "School website and online admissions" },
  { key: "docs", tier: "Premium", names: ["Create Files"], aliases: ["Files & Sheets", "Docs/Sheets"], label: "Docs and sheets" },
  { key: "transportation", tier: "Premium", names: ["Transportation"], label: "Transportation", addon: "transportation" },
  { key: "mira_full", tier: "Premium", names: ["Mira Full"], label: "Full Mira for all staff", addon: "mira" },
  { key: "priority_support", tier: "Premium", names: ["Priority Support"], label: "Priority support" },
];

// Lesson Notes never had a page: its row stays on old plans but is never offered or shown.
const NOT_IN_PLANS = [{ names: ["Lesson Notes"] }];

const norm = (value) => String(value || "").trim().toLowerCase();
const namesOf = (item) => [...(item.names || (item.name ? [item.name] : [])), ...(item.aliases || [])];
const CORE_NAMES = CORE.flatMap(namesOf);
const BY_NAME = new Map();
[...CORE.map((item) => ({ ...item, kind: "core" })), ...PLAN.map((item) => ({ ...item, kind: "plan" })), ...NOT_IN_PLANS.map((item) => ({ ...item, kind: "hidden" }))]
  .forEach((item) => namesOf(item).forEach((name) => BY_NAME.set(norm(name), item)));
const namesIn = (list) => (list || []).map((f) => (typeof f === "string" ? f : f && f.feature_name)).filter(Boolean);
const hasItem = (have, item) => namesOf(item).some((name) => have.has(norm(name)));

function catalogOn(organizationId) {
  return features.isOn("plan_catalog", { organizationId });
}

// A school's plan features with the always-included ones added (where released). `names` is the
// plan's list as the pages already cache it; null (the plan couldn't be read) stays null.
function withCore(names, organizationId) {
  if (!Array.isArray(names) || !catalogOn(organizationId)) return names;
  const have = new Set(names.map(norm));
  return [...names, ...CORE_NAMES.filter((name) => !have.has(norm(name)))];
}

const isCoreName = (name) => (BY_NAME.get(norm(name)) || {}).kind === "core";

// What a permission needs from the plan where the catalog is released, in place of
// PERMISSION_FEATURES (by root permission) and an option's `features` (by its own key).
const REPORT_NAMES = ["Terminal Report", "Progressive Student Report", "Class Base Merit Sheet", "Class Base Merrit sheet", "Official School Transcript", "Report Builder"];
const ROOT_NEEDS = {
  manage_reports: REPORT_NAMES,
  driver_report_builder: ["Report Builder"],
};
const OPTION_NEEDS = {
  reports_builder: ["Report Builder"],
  reports_settings: ["Custom Report Card Templates"],
};

// For Admin › Pricing's plan form: each plan feature whose rows exist (with their ids), grouped
// by the plan that first has it, plus the ids of the always-included and never-offered rows
// (kept on save). A row the catalog doesn't know is still offered, under its own name.
function planForm(featureRows) {
  const rows = (featureRows || []).map((row) => ({ id: Number(row.id), name: row.feature_name }));
  const idsFor = (item) => rows.filter((row) => namesOf(item).some((name) => norm(name) === norm(row.name))).map((row) => row.id);
  const choices = PLAN.map((item) => ({ ...item, ids: idsFor(item) })).filter((item) => item.ids.length);
  const catalogued = new Set([...CORE, ...PLAN, ...NOT_IN_PLANS].flatMap(idsFor));
  rows.filter((row) => !catalogued.has(row.id)).forEach((row) => choices.push({ key: `row_${row.id}`, tier: "Other", names: [row.name], label: row.name, ids: [row.id] }));
  return {
    groups: [...TIERS, "Other"].map((tier) => ({ tier, items: choices.filter((item) => item.tier === tier) })).filter((group) => group.items.length),
    choices,
    core: CORE,
    coreIds: CORE.flatMap(idsFor),
    keptIds: NOT_IN_PLANS.flatMap(idsFor),
  };
}

// A plan's features as schools read them: the headline core first, then what the plan has, in
// the order of the ladder, by their catalog names. `featureList` is [{ feature_name }] or names.
function forDisplay(featureList) {
  const names = namesIn(featureList);
  const have = new Set(names.map(norm));
  const known = new Set([...CORE, ...PLAN, ...NOT_IN_PLANS].flatMap(namesOf).map(norm));
  return [
    ...CORE.filter((item) => item.headline),
    ...PLAN.filter((item) => hasItem(have, item)),
  ].map((item) => ({ feature_name: item.label })).concat(names.filter((name) => !known.has(norm(name))).map((name) => ({ feature_name: name })));
}

// The plan schools are steered to: its card is marked "Most popular".
const POPULAR_PLAN = "Pro";

// The plans as a ladder, in the order given: each plan's `features` (everything, for a plan
// shown on its own) and, when it has all of the plan before it, `plusOf` (that plan's name),
// `newFeatures` (only what it adds) and `inherited` (what it has from the plans before it, the
// nearest first, each feature once: [{ from: "Pro", features }, { from: "Starter", features }]).
// Cards then read "Everything in Pro, plus", and open to show where each feature came from.
function ladder(plans) {
  let before = null;
  let chain = [];
  return (plans || []).map((plan) => {
    const all = forDisplay(plan.features);
    const labels = new Set(all.map((f) => f.feature_name));
    const builds = Boolean(before) && [...before.labels].every((label) => labels.has(label)) && labels.size > before.labels.size;
    const newFeatures = builds ? all.filter((f) => !before.labels.has(f.feature_name)) : all;
    const out = { ...plan, features: all, plusOf: builds ? before.name : null, newFeatures, inherited: builds ? [...chain].reverse() : [],
      popular: norm(plan.plan_name) === norm(POPULAR_PLAN) };
    chain = builds ? [...chain, { from: plan.plan_name, features: newFeatures }] : [{ from: plan.plan_name, features: all }];
    before = { name: plan.plan_name, labels };
    return out;
  });
}

// The add-ons a plan includes (hubBilling.INTEGRATIONS keys): free for schools on that plan.
function includedAddons(featureList) {
  const have = new Set(namesIn(featureList).map(norm));
  return new Set(PLAN.filter((item) => item.addon && hasItem(have, item)).map((item) => item.addon));
}

module.exports = {
  TIERS,
  CORE,
  PLAN,
  NOT_IN_PLANS,
  CORE_NAMES,
  ROOT_NEEDS,
  OPTION_NEEDS,
  catalogOn,
  withCore,
  isCoreName,
  planForm,
  forDisplay,
  ladder,
  POPULAR_PLAN,
  includedAddons,
};
