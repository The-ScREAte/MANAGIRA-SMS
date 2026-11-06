const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SHARD_SECRET = "unit-test-secret";
const signing = require("../utils/shards/signing");
const { classifyTable, LINKED, HUB_TABLES, REFERENCE } = require("../utils/shards/schoolTables");
const { buildPlan, loadOrder } = require("../utils/shards/moveSchool");
const { schemaDifferences } = require("../utils/shards/catalog");
const { parseDirectory, chooseShard, clientAddress } = require("../edge");
const { validateShard, environmentFor } = require("../utils/shards/provision");
const { trustEdge, withShardLinks } = require("../utils/shards/routing");
const features = require("../utils/shards/features");
const { requireSuperAdmin, requireFreshPassword } = require("../middleware/shardAdminGuard");

const table = (name, columns, primaryKey = []) => [name, { name, columns: columns.map((c) => ({ name: c, type: "integer", required: false })), primaryKey, triggers: [] }];
const fk = (child, columns, parent, parent_columns, required = false) => ({ child, columns, parent, parent_columns, required });

test("a route cookie can't be forged, and only the router's signature is believed", () => {
  const value = signing.routeValue("us-shard-02");
  assert.equal(signing.routeFromCookies(`a=1; mgr_shard=${encodeURIComponent(value)}`), "us-shard-02");
  assert.equal(signing.routeFromCookies("mgr_shard=us-shard-02.forged"), null);
  assert.equal(signing.routeFromCookies(""), null);
  assert.equal(signing.isEdgeRequest({ "x-managira-edge": signing.edgeToken() }), true);
  assert.equal(signing.isEdgeRequest({ "x-managira-edge": "forged" }), false);
  assert.equal(signing.isEdgeRequest({}), false);
});

test("calls between shards need a fresh signature over that exact body", () => {
  const body = JSON.stringify({ login: "a@b.c" });
  const headers = signing.signCall(body);
  assert.equal(signing.verifyCall(headers, body), true);
  assert.equal(signing.verifyCall(headers, body + " "), false, "a changed body");
  assert.equal(signing.verifyCall({ ...headers, "x-shard-time": String(Date.now() - 120000) }, body), false, "an old call");
  assert.equal(signing.verifyCall({}, body), false);
});

test("a test shard's signature can't call a production shard", () => {
  const body = "{}";
  const headers = signing.signCall(body, signing.testShardSecret());
  assert.equal(signing.verifyCall(headers, body), false);
});

test("a sign-up hand-off can't be altered", () => {
  const sealed = signing.sealHandoff({ planSelection: { planId: 3 } });
  assert.deepEqual(signing.openHandoff(sealed), { planSelection: { planId: 3 } });
  assert.equal(signing.openHandoff(`${sealed}x`), null);
  assert.equal(signing.openHandoff("nonsense"), null);
});

test("only the router's signed headers change the host and visitor address", () => {
  const run = (headers) => { const req = { headers }; trustEdge(req, {}, () => {}); return req.headers; };
  const forged = run({ host: "shard.onrender.com", "x-managira-edge": "forged", "x-managira-host": "manis.managira.com", "x-managira-client-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" });
  assert.equal(forged.host, "shard.onrender.com");
  assert.equal(forged["x-forwarded-for"], "1.1.1.1");
  const real = run({ host: "shard.onrender.com", "x-managira-edge": signing.edgeToken(), "x-managira-host": "manis.managira.com", "x-managira-client-ip": "9.9.9.9", "x-forwarded-for": "5.5.5.5" });
  assert.equal(real.host, "manis.managira.com");
  assert.equal(real["x-forwarded-for"], "9.9.9.9", "rate limits see the visitor, not the router");
});

test("the router sends each request to the right shard", () => {
  const shards = [
    { shard_id: 1, name: "us-shard-01", environment: "production", status: "active", is_control: true, app_url: "https://a.example" },
    { shard_id: 2, name: "us-shard-02", environment: "production", status: "active", is_control: false, app_url: "https://b.example" },
    { shard_id: 3, name: "old-shard-01", environment: "production", status: "retired", is_control: false, app_url: "https://c.example" },
  ];
  const directory = parseDirectory(shards, [{ subdomain: "manis", shard_id: 2 }, { subdomain: "gone", shard_id: 3 }], [{ subdomain: "testhub", shard_id: 2 }]);
  const pick = (host, url = "/", cookie = "") => chooseShard({ headers: { host, cookie }, url }, directory)?.name;
  assert.equal(pick("manis.managira.com"), "us-shard-02");
  assert.equal(pick("manis.testhub.managira.com"), "us-shard-02");
  assert.equal(pick("testhub.managira.com"), "us-shard-02");
  assert.equal(pick("x.testhub.managira.com"), "us-shard-02", "a hub's subdomain finds its shard");
  assert.equal(pick("unknown.managira.com"), "us-shard-01");
  assert.equal(pick("gone.managira.com"), "us-shard-01", "a retired shard takes no traffic");
  assert.equal(pick("managira.com"), "us-shard-01");
  const cookie = `mgr_shard=${encodeURIComponent(signing.routeValue("us-shard-02"))}`;
  assert.equal(pick("managira.com", "/", cookie), "us-shard-02");
  assert.equal(pick("managira.com", "/", "mgr_shard=us-shard-02.forged"), "us-shard-01");
  assert.equal(pick("managira.com", "/admin/shards", cookie), "us-shard-01", "shard pages are always on the control shard");
  assert.equal(pick("managira.com", `/account/reset-password?token=x&via=${encodeURIComponent(signing.routeValue("us-shard-02"))}`), "us-shard-02");
  assert.equal(pick("managira.com", "/x?via=us-shard-02.forged"), "us-shard-01");
  assert.equal(clientAddress({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" }, socket: {} }), "2.2.2.2");
});

test("every written table link names real-looking columns and a school table", () => {
  const known = (name) => Object.hasOwn(LINKED, name) || Object.hasOwn(HUB_TABLES, name);
  assert.ok(known("guardian_students"));
  Object.values(LINKED).forEach((where) => {
    const sql = where("t");
    assert.doesNotMatch(sql, /IN \(SELECT "[a-z_]+" FROM/, "a bare column would silently match every school");
  });
});

test("tables are sorted into school, hub or platform, and nothing is guessed", () => {
  assert.equal(classifyTable("students", ["student_id", "organization_id"]).kind, "school");
  assert.equal(classifyTable("plans", ["id"]).kind, "platform");
  assert.equal(classifyTable("user_sessions", ["sid"]).kind, "platform");
  assert.equal(classifyTable("hub_users", ["hub_id"]).kind, "platform", "hub tables stay when a school moves alone");
  assert.equal(classifyTable("hub_users", ["hub_id"], { withHub: true }).kind, "school", "and travel with the hub");
  assert.equal(classifyTable("something_new", ["id"]), null);
  assert.ok(REFERENCE.includes("plans"));
});

test("the copy order puts parents first and breaks only real loops", () => {
  const school = new Map(["organizations", "users", "classes", "students"].map((name) => [name, {}]));
  const links = [
    fk("users", ["organization_id"], "organizations", ["organization_id"], true),
    fk("organizations", ["created_by"], "users", ["user_id"], false),
    fk("classes", ["organization_id"], "organizations", ["organization_id"], true),
    fk("students", ["class_id"], "classes", ["class_id"], false),
  ];
  const order = loadOrder([...school.keys()], links, school);
  assert.ok(order.indexOf("organizations") < order.indexOf("users"), "the required link wins the loop");
  assert.ok(order.indexOf("classes") < order.indexOf("students"), "an optional link outside a loop is still respected");
});

test("a plan refuses unknown tables and impossible loops", () => {
  const catalog = {
    tables: new Map([table("organizations", ["organization_id"], ["organization_id"]), table("mystery", ["id"])]),
    foreignKeys: [],
  };
  assert.match(buildPlan(catalog).problems.join(), /mystery/);

  const looped = {
    tables: new Map([table("a_things", ["id", "organization_id", "b_id"], ["id"]), table("b_things", ["id", "organization_id", "a_id"], ["id"])]),
    foreignKeys: [fk("a_things", ["b_id"], "b_things", ["id"], true), fk("b_things", ["a_id"], "a_things", ["id"], true)],
  };
  assert.match(buildPlan(looped).problems.join(), /first/);
});

test("rows pointing outside the school are held back or cleared, never copied as they are", () => {
  const catalog = {
    tables: new Map([table("users", ["user_id", "organization_id"], ["user_id"]), table("classes", ["class_id", "organization_id", "created_by"], ["class_id"]), table("grades", ["id", "organization_id", "user_id"], ["id"])]),
    foreignKeys: [fk("classes", ["created_by"], "users", ["user_id"], false), fk("grades", ["user_id"], "users", ["user_id"], true)],
  };
  const plan = buildPlan(catalog);
  const classes = plan.tables.find((t) => t.name === "classes");
  const grades = plan.tables.find((t) => t.name === "grades");
  assert.match(classes.projection, /CASE WHEN t\."created_by" IN/);
  assert.match(grades.where, /t\."user_id" IN/);
});

test("a destination missing a column or table is reported", () => {
  const source = { tables: new Map([table("students", ["student_id", "new_column"])]) };
  const destination = { tables: new Map([table("students", ["student_id"])]) };
  assert.match(schemaDifferences(source, destination, ["students"]).join(), /new_column/);
  assert.match(schemaDifferences(source, { tables: new Map() }, ["students"]).join(), /no table/);
});

test("shard names and details are checked", () => {
  assert.equal(validateShard({ name: "us-shard-02" }).errors.length, 0);
  assert.ok(validateShard({ name: "Bad Name" }).errors.length);
  assert.ok(validateShard({ name: "us-shard-2" }).errors.length);
  assert.ok(validateShard({ name: "us-shard-02", countries: "Ghana" }).errors.length);
  assert.deepEqual(validateShard({ name: "af-shard-01", countries: "gh, ng" }).values.countries, ["GH", "NG"]);
  assert.equal(validateShard({ name: "us-shard-02" }).values.acceptsNew, false, "a new shard takes no schools until told to");
});

test("a test shard gets nothing of production's", () => {
  process.env.STRIPE_SECRET_KEY = "sk_real";
  process.env.SESSION_SECRET = "real-session-secret";
  const urls = { databaseUrl: "postgres://t", controlUrl: "postgres://control" };
  const testing = environmentFor({ name: "test-shard-01", environment: "testing" }, urls);
  assert.equal(testing.STRIPE_SECRET_KEY, undefined);
  assert.equal(testing.CONTROL_DB_URL, undefined);
  assert.notEqual(testing.SHARD_SECRET, process.env.SHARD_SECRET);
  assert.notEqual(testing.SESSION_SECRET, "real-session-secret");
  const production = environmentFor({ name: "us-shard-02", environment: "production" }, urls);
  assert.equal(production.STRIPE_SECRET_KEY, "sk_real");
  assert.equal(production.CONTROL_DB_URL, "postgres://control");
  assert.equal(production.SHARD_NAME, "us-shard-02");
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.SESSION_SECRET;
});

test("email links name their shard, except on the control shard", () => {
  const previous = process.env.SHARD_NAME;
  process.env.SHARD_NAME = "us-shard-02";
  const out = withShardLinks('<a href="https://www.managira.com/common/set-password?token=abc">x</a><img src="https://www.managira.com/images/logo.png"> https://school.managira.com/a');
  assert.match(out, /token=abc&via=us-shard-02\./);
  assert.match(out, /logo\.png"/, "images are left alone");
  assert.match(out, /school\.managira\.com\/a$/, "school addresses already route themselves");
  process.env.SHARD_NAME = "us-shard-01";
  assert.equal(withShardLinks("https://www.managira.com/a"), "https://www.managira.com/a");
  if (previous === undefined) delete process.env.SHARD_NAME; else process.env.SHARD_NAME = previous;
});

test("a feature with no saved choice follows its default", () => {
  assert.equal(features.isOn("transport_report_builder", { organizationId: 5 }), true);
  assert.equal(features.isOn("no_such_feature", { organizationId: 5 }), true);
});

const respond = () => {
  const res = { statusCode: 200, redirected: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, redirect(to) { this.redirected = to; return this; }, end() { return this; } };
  return res;
};

test("only a platform super admin gets past the guard", async () => {
  for (const session of [{}, { accountType: "Mini Admin", userId: 1 }, { accountType: "Internal Worker", userId: 1 }, { accountType: "Manager", userId: 1 }, { accountType: "Admin", userId: 1, superAdminOrgSwitch: true }]) {
    let passed = false;
    const res = respond();
    await requireSuperAdmin({ session, headers: { accept: "application/json" }, flash: () => {} }, res, () => { passed = true; });
    assert.equal(passed, false, JSON.stringify(session));
    assert.equal(res.statusCode, 403);
  }
});

test("shard pages need a recent password check", () => {
  const go = (session, method = "GET", accept = "text/html") => {
    let passed = false;
    const res = respond();
    requireFreshPassword({ session, method, headers: { accept }, originalUrl: "/admin/shards/releases" }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal(go({ shardConfirmedAt: Date.now() }).passed, true);
  const stale = go({ shardConfirmedAt: Date.now() - 31 * 60 * 1000 });
  assert.equal(stale.passed, false);
  assert.match(stale.res.redirected, /confirm\?next=%2Fadmin%2Fshards%2Freleases/);
  assert.equal(go({}, "POST", "application/json").res.statusCode, 401);
});
