// Mira's search through all the help guides: scorer, synonyms, typos, audience, the prompt
// budget, the two tools, and the chat context. Offline: no model, no network, no real database
// (the orchestrator's database, internal API and document search are stubbed).
process.env.MIRA_MOCK_LLM = "true";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// Stubs, before the orchestrator is loaded: nothing here may reach a database or the network.
const stub = (file, exports) => { const id = require.resolve(file); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let ragDelayMs = 0;
let ragResult = [];
stub("../config/db", { query: async () => ({ rows: [] }), pool: {} });
stub("../db/schema", { ensureMiraSchema: async () => {} });
stub("../internalApiClient", { callInternalApi: async () => { throw new Error("offline"); }, runAsCaller: async (_t, fn) => fn() });
stub("../services/ragService", { retrieveContext: async () => { if (ragDelayMs) await new Promise((r) => setTimeout(r, ragDelayMs)); return ragResult; } });

const help = require("../services/helpSearch");
const { buildIndex } = help;
const searchHelpGuides = require("../tools/searchHelpGuides");
const getHelpGuide = require("../tools/getHelpGuide");
const { REGISTRY } = require("../tools");
const { TOOL_ACCESS } = require("../services/access");
const { levelOf } = require("../services/levels");

const slugs = (q, o) => help.searchGuides(q, o).map((r) => r.slug);

test("searches every guide and returns several distinct guides with links", () => {
  const results = help.searchGuides("how do I post report cards to parents", { limit: 5 });
  assert.ok(results.length >= 3 && results.length <= 5, `got ${results.length}`);
  assert.equal(new Set(results.map((r) => r.slug)).size, results.length, "one result per guide");
  results.forEach((r) => { assert.match(r.url, /^\/legal\/user-documentation\//); assert.ok(r.title && r.snippet); });
  assert.ok(slugs("how do I post report cards to parents").slice(0, 3).includes("report-card-send-and-history"));
});

test("covers topics from every part of the help center", () => {
  const cases = [
    ["set up PayGira bills for a class", /paygira/], ["report settings choose what appears on report cards", /report-settings/],
    ["custom editor build a form section", /custom-editor/], ["class settings lunch sharing", /class-settings/],
    ["online admission on our website", /admission/], ["bus routes and stops", /transportation/], ["driver starts a trip", /driver/],
    ["single sign-on SAML", /single-sign-on/], ["subscription renewal price", /renewal|pricing/], ["move our data from PowerSchool", /migration|data/],
    ["what can Mira do", /mira/], ["how do parents pay a school bill", /parent-pay|paygira/], ["student takes an online test", /student|test/],
  ];
  cases.forEach(([q, pattern]) => assert.ok(slugs(q).slice(0, 5).some((s) => pattern.test(s)), `${q}: ${slugs(q).join(", ")}`));
});

test("synonyms: marks, kids, login, remove find the guides' own words", () => {
  const rows = [
    { slug: "grades", title: "Enter grades", topic: "Assessments & grades", contentHtml: "<h2>Enter scores</h2><ol><li>Open the gradebook and choose the class. Enter scores for your students.</li></ol>" },
    { slug: "weather", title: "School calendar", topic: "Calendar", contentHtml: "<h2>Holidays</h2><p>Add a holiday.</p>" },
    { slug: "signin", title: "Sign in to Managira", topic: "Account & sign-in", contentHtml: "<h2>Sign in</h2><p>Enter your email and password.</p>" },
  ];
  const index = buildIndex(rows);
  assert.equal(help.searchGuides("where do I put in marks for the kids", { index })[0].slug, "grades");
  assert.equal(help.searchGuides("login", { index })[0].slug, "signin");
  assert.ok(help.synonyms().get("grade").has("mark"));
  assert.ok(help.synonyms().get("student").has("pupil"));
});

test("menu names and product words map to the guides", () => {
  assert.ok(slugs("Class & notif. settings").slice(0, 3).includes("class-settings"));
  assert.ok(slugs("Attendance & lunch").some((s) => /attendance|lunch|class-settings/.test(s)));
  assert.ok(slugs("how much does it cost").slice(0, 3).some((s) => /renewal|pricing|about-managira/.test(s)));
});

test("typos of five or more letters are still found", () => {
  assert.ok(slugs("how do I take attendence for lunch").slice(0, 3).some((s) => /attendance/.test(s)));
  assert.ok(slugs("how do I print a transcrpit").slice(0, 3).some((s) => /transcript/.test(s)));
});

test("audience: family guides first for a parent, staff guides first for staff, never excluded", () => {
  const asParent = help.searchGuides("see my child's grades and report cards", { audience: "parent", limit: 5 });
  assert.match(asParent[0].slug, /^parent-/);
  const asStaff = help.searchGuides("post report cards and grades for the class", { audience: "staff", limit: 6 });
  assert.ok(!/^parent-/.test(asStaff[0].slug), asStaff[0].slug);
  const asDriver = help.searchGuides("start a trip", { audience: "driver", limit: 3 });
  assert.ok(asDriver.some((r) => /driver/.test(r.slug)));
  // staff still get family guides when the question is about families
  assert.ok(help.searchGuides("what can parents see in the parent portal", { audience: "staff", limit: 5 }).some((r) => /^parent-/.test(r.slug)));
});

test("nothing returned when nothing relevant, and for empty or chit-chat input", () => {
  assert.deepEqual(help.searchGuides("zxqv blorptastic wumbo"), []);
  assert.deepEqual(help.searchGuides("   "), []);
  assert.equal(help.guideContext({ question: "yes" }).text, "");
  assert.equal(help.guideContext({ question: "thanks!" }).text, "");
});

test("the index is built once and rebuilt when the guides change", () => {
  help.resetForTests();
  const a = help.sharedIndex();
  assert.equal(help.sharedIndex(), a);
  const t = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) help.searchGuides("how do I add a student to a class");
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 / 20 < 30, "under 30 ms a search");
});

test("guideContext stays within the budget and cites links", () => {
  const questions = ["how do I post report cards to parents", "how do I set up PayGira bills", "where do I turn on lunch for a class", "how do I connect single sign-on", "what can Mira do", "how do I add a teacher and give permissions", "how do I track the bus", "forgot my password"];
  questions.forEach((question) => {
    const ctx = help.guideContext({ question });
    assert.ok(ctx.size > 0 && ctx.size <= help.CONTEXT_BUDGET, `${question}: ${ctx.size}`);
    assert.ok(ctx.results.length >= 1 && ctx.results.length <= 4);
    assert.match(ctx.text, /\(\/legal\/user-documentation\/[a-z0-9-]+/);
    assert.match(ctx.text, /search_help_guides/);
  });
  assert.ok(help.guideContext({ question: "how do I set up PayGira bills" }).results.length >= 3, "several guides, not one");
});

test("a data question gets a guide hint only when it is a clear match", () => {
  const data = help.guideContext({ question: "which students are absent today" });
  assert.ok(data.results.length <= 1);
  assert.ok(help.guideContext({ question: "how do I take attendance for a class" }).results.length >= 2);
});

test("a short follow-up borrows the turn before", () => {
  const alone = slugs("and for parents?");
  const withPrior = help.searchGuides("and for parents?", { context: "how do I post report cards" }).map((r) => r.slug);
  assert.ok(withPrior.some((s) => /report-card|grades/.test(s)), withPrior.join(","));
  assert.ok(withPrior.length >= alone.length);
});

test("search_help_guides: output shape and access", async () => {
  const out = await searchHelpGuides.handler({ query: "reset a teacher password", limit: 4 });
  assert.equal(out.ok, true);
  assert.ok(out.results.length >= 1 && out.results.length <= 4);
  out.results.forEach((r) => ["title", "topic", "section", "url", "snippet"].forEach((k) => assert.ok(k in r, k)));
  assert.equal((await searchHelpGuides.handler({ query: "zxqv blorptastic" })).results.length, 0);
  assert.equal((await searchHelpGuides.handler({ query: "" })).ok, false);
  ["search_help_guides", "get_help_guide"].forEach((name) => {
    assert.ok(REGISTRY[name], name);
    assert.deepEqual(TOOL_ACCESS[name], { open: true });
    assert.equal(levelOf(name, REGISTRY[name]), 0);
  });
});

test("get_help_guide: whole guide by url or slug, trimmed, section first", async () => {
  const [first] = help.searchGuides("report settings choose what appears on report cards");
  const byUrl = await getHelpGuide.handler({ url: first.url });
  assert.equal(byUrl.ok, true);
  assert.ok(byUrl.text.length > 300 && byUrl.text.length <= 6500, byUrl.text.length);
  const bySlug = await getHelpGuide.handler({ slug: first.slug });
  assert.equal(bySlug.url, byUrl.url);
  const focused = await getHelpGuide.handler({ slug: "report-settings", section: "attendance is off" });
  assert.match(focused.text.split("\n\n")[2] || focused.text, /attendance/i);
  assert.equal((await getHelpGuide.handler({ url: "/legal/user-documentation/does-not-exist-zzz-qqq" })).ok, false);
  assert.equal((await getHelpGuide.handler({})).ok, false);
});

test("Mira's own capability list and the product overview are searchable", () => {
  assert.ok(help.sharedIndex().bySlug.has("mira-capabilities-list"));
  assert.ok(help.sharedIndex().bySlug.has("about-managira"));
});

test("offline eval over every guide: top-3 at least 90%, a guide for at least 95%", () => {
  const { run } = require("../evals/helpSearch.eval");
  const r = run({ withOld: false });
  assert.ok(r.total >= 250, `${r.total} questions`);
  assert.ok(r.stats.new.k3 / r.total >= 0.9, `top-3 ${(r.stats.new.k3 / r.total).toFixed(3)}`);
  assert.ok(r.stats.new.any / r.total >= 0.95, `any ${(r.stats.new.any / r.total).toFixed(3)}`);
  assert.ok(r.falsePositives.length <= 6);
});

// ---- the chat context ----
const orchestrator = require("../services/orchestrator");
const tenant = (viewerType, extra = {}) => ({ organizationId: 63, viewerType, userId: 1, userRole: "Manager", accountType: "Organization", displayName: "Test", organizationName: "Test School", roleLabel: "Manager", ...extra });
const ctxOf = async (t, userText, history = []) => {
  const messages = await orchestrator.buildContextMessages({ tenant: t, userText, history, classScope: null, access: { ok: false, held: new Set(), labels: new Map(), permissions: [], features: {} }, digest: null });
  return messages.find((m) => /Relevant help guides/.test(m.content));
};

test("chat context: guides added for how-to and other questions, last among the guide blocks, within the budget", async () => {
  for (const [who, q] of [["staff", "how do I post report cards to parents"], ["staff", "what is PayGira and how do parents pay"], ["staff", "can I turn off lunch for one class"], ["parent", "where do I see my child's grades"], ["student", "how do I take a test online"]]) {
    const message = await ctxOf(tenant(who), q);
    assert.ok(message, `${who}: ${q}`);
    assert.ok(message.content.length <= help.CONTEXT_BUDGET, message.content.length);
    assert.match(message.content, /Never describe menus|only source for menus/);
  }
});

test("chat context: a failure in the guide search never breaks the chat", async () => {
  const original = help.guideContext;
  help.guideContext = () => { throw new Error("boom"); };
  const originalError = console.error; console.error = () => {};
  try {
    const messages = await orchestrator.buildContextMessages({ tenant: tenant("staff"), userText: "how do I add a student", history: [], classScope: null, access: { ok: false, held: new Set(), labels: new Map(), permissions: [], features: {} }, digest: null });
    assert.ok(messages.length >= 1);
    assert.equal(messages.some((m) => /Relevant help guides/.test(m.content)), false);
  } finally { help.guideContext = original; console.error = originalError; }
});

test("chat context: the 900 ms document-search limit still holds", async () => {
  ragDelayMs = 3000;
  ragResult = [{ content: "school fact" }];
  const t = Date.now();
  try {
    const messages = await orchestrator.buildContextMessages({ tenant: tenant("staff"), userText: "how do I add a student", history: [], classScope: null, access: { ok: false, held: new Set(), labels: new Map(), permissions: [], features: {} }, digest: null });
    assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
    assert.equal(messages.some((m) => /school fact/.test(m.content)), false);
    assert.ok(messages.some((m) => /Relevant help guides/.test(m.content)), "guides still arrive");
  } finally { ragDelayMs = 0; ragResult = []; }
});
