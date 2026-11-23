// What Mira may change, and how a change is confirmed: the blocklist (no money, billing,
// permissions, sign-in, integrations or permanent student deletion, in Mira or in the
// internal API it calls), the confirmation gate in code, and the forms questions reaching
// the Forms & requests tools.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { REGISTRY } = require("../tools");
const { TOOL_ACCESS } = require("../services/access");
const gate = require("../services/confirmGate");
const { selectAreas, selectToolSchemas } = require("../services/toolSelector");
const { listToolSchemas } = require("../tools");

const READ = /^(get_|list_|find_|check_|compare_|whats_)/;
const NEVER_WORDS = new Set("pay payment payments paygira fee fees bill bills billing invoice invoices refund refunds payout payouts charge charges price prices pricing plan plans subscription subscriptions stripe permission permissions role roles access sso saml oidc password passwords secret secrets token tokens integration integrations apikey".split(" "));
const NEVER_PHRASES = /service[_-]?account|api[_-]?key|single[_-]?sign/i;
const blocked = (name) => NEVER_PHRASES.test(name) || name.toLowerCase().split(/[^a-z]+/).some((word) => NEVER_WORDS.has(word));

test("no tool changes money, billing, permissions, sign-in, integrations or passwords", () => {
  const writes = Object.keys(REGISTRY).filter((name) => !READ.test(name));
  const bad = writes.filter(blocked);
  assert.deepEqual(bad, [], `write tools in a blocked area: ${bad.join(", ")}`);
});

test("no tool deletes a student permanently", () => {
  const bad = Object.keys(REGISTRY).filter((name) => /^(delete|purge|erase|remove|archive)_students?$/.test(name) || /^(delete|purge|erase)_.*student/.test(name));
  assert.deepEqual(bad, []);
});

test("the internal API Mira calls has no write route in a blocked area", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../routes/internalApiRoute.js"), "utf8");
  const writes = [...source.matchAll(/router\.(post|put|patch|delete)\(\s*"([^"]+)"/g)].map((m) => m[2]);
  assert.ok(writes.length > 50, "found the internal write routes");
  const bad = writes.filter((route) => blocked(route) || /^\/students\/(delete|purge|erase|remove)/.test(route));
  assert.deepEqual(bad, [], `internal write routes in a blocked area: ${bad.join(", ")}`);
});

test("every tool has an access rule", () => {
  const missing = Object.keys(REGISTRY).filter((name) => !(name in TOOL_ACCESS));
  assert.deepEqual(missing, []);
});

// ---- the confirmation gate (services/confirmGate.js) ----
const T = { organizationId: 63, userId: 240 };
const make = (tool, args, level = 2, extra = {}) => gate.create({ tenant: extra.tenant || T, chatId: extra.chatId || 7, turn: extra.turn || 1, tool, args, level, label: tool });
const remind = { form: "Field trip permission", classes: "Grade 6" };

test("every change tool has a level, and read tools are level 0", () => {
  const { levelOf } = require("../services/levels");
  const missing = Object.entries(REGISTRY).filter(([name, tool]) => levelOf(name, tool) === null).map(([name]) => name);
  assert.deepEqual(missing, [], `tools without a level: ${missing.join(", ")}`);
  Object.entries(REGISTRY).filter(([, tool]) => tool.level === 0).forEach(([name]) => assert.ok(!/^(send|delete|create|set|update)_/.test(name), name));
});

test("only previews the person confirms run: a yes to the one waiting", () => {
  const p = make("remind_form_outstanding", remind);
  const out = gate.decide({ tenant: T, chatId: 7, userText: "Yes, send it" });
  assert.deepEqual(out.run.map((x) => x.id), [p.id]);
  gate.mark(p, "done");
  assert.equal(gate.decide({ tenant: T, chatId: 7, userText: "yes" }).run.length, 0, "single use");
});

test("anything other than a clear yes runs nothing", () => {
  ["what will it say?", "yes but only 6A", "not yet", "wait", "hold on", "maybe"].forEach((text) => {
    const p = make("remind_form_outstanding", remind, 2, { chatId: 8 });
    assert.equal(gate.decide({ tenant: T, chatId: 8, userText: text }).run.length, 0, text);
    gate.mark(p, "cancelled");
  });
});

test("no cancels what was waiting", () => {
  const p = make("send_message", { message: "Hi" }, 2, { chatId: 9 });
  const out = gate.decide({ tenant: T, chatId: 9, userText: "no, don't send it" });
  assert.equal(out.run.length, 0);
  assert.deepEqual(out.cancelled.map((x) => x.id), [p.id]);
});

test("the Confirm button runs exactly that preview; another person's or chat's id doesn't", () => {
  const p = make("create_event", { title: "PTA meeting" }, 1, { chatId: 10 });
  assert.equal(gate.decide({ tenant: { organizationId: 63, userId: 999 }, chatId: 10, userText: "Confirm", confirmId: p.id }).run.length, 0);
  assert.equal(gate.decide({ tenant: { organizationId: 158, userId: 240 }, chatId: 10, userText: "Confirm", confirmId: p.id }).run.length, 0);
  assert.equal(gate.decide({ tenant: T, chatId: 11, userText: "Confirm", confirmId: p.id }).run.length, 0);
  const forged = `${p.id.split(".")[0]}.AAAAAAAAAAAAAAAAAAAAAA`;
  assert.match(gate.decide({ tenant: T, chatId: 10, userText: "Confirm", confirmId: forged }).refusal || "", /no longer waiting|verified/);
  assert.deepEqual(gate.decide({ tenant: T, chatId: 10, userText: "Confirm", confirmId: p.id }).run.map((x) => x.id), [p.id]);
});

test("a preview expires after 10 minutes", () => {
  const p = make("create_event", { title: "Assembly" }, 1, { chatId: 12 });
  assert.equal(gate.verify(p.id, T, 12, Date.now() + 9 * 60 * 1000).ok, true);
  assert.match(gate.verify(p.id, T, 12, Date.now() + 11 * 60 * 1000).reason, /expired/);
  const tampered = { ...p };
  p.expiresAt += 60 * 60 * 1000; // a changed expiry no longer matches its signature
  assert.match(gate.verify(p.id, T, 12).reason, /verified/);
  Object.assign(p, tampered);
  assert.equal(gate.PREVIEW_TTL_MS, 10 * 60 * 1000);
});

test("several waiting: a bare yes runs none; yes to all runs them all", () => {
  const a = make("send_message", { message: "A" }, 2, { chatId: 13, turn: 5 });
  const b = make("send_message", { message: "B" }, 2, { chatId: 13, turn: 5 });
  assert.equal(gate.decide({ tenant: T, chatId: 13, userText: "yes" }).run.length, 0);
  assert.deepEqual(gate.decide({ tenant: T, chatId: 13, userText: "yes to all" }).run.map((x) => x.id), [a.id, b.id]);
});

test("Level 3 needs what it's about typed, by button or message", () => {
  const p = make("delete_class", { className: "Grade 6A" }, 3, { chatId: 14 });
  assert.match(gate.decide({ tenant: T, chatId: 14, userText: "yes" }).refusal, /type .*"Grade 6A"/);
  assert.match(gate.decide({ tenant: T, chatId: 14, userText: "Confirm", confirmId: p.id, typed: "yes" }).refusal, /type "Grade 6A"/);
  assert.deepEqual(gate.decide({ tenant: T, chatId: 14, userText: "Confirm", confirmId: p.id, typed: "grade 6a" }).run.map((x) => x.id), [p.id]);
  const q = make("delete_class", { className: "Grade 7B" }, 3, { chatId: 15 });
  assert.deepEqual(gate.decide({ tenant: T, chatId: 15, userText: "yes, delete Grade 7B" }).run.map((x) => x.id), [q.id]);
});

test("the model never sees a confirm switch", () => {
  const { forModelSchema } = require("../services/orchestrator");
  const schema = forModelSchema({ name: "delete_class", description: "Delete a class. On any clear yes, call again with confirm=true.", parameters: { type: "object", properties: { className: { type: "string" }, confirm: { type: "boolean" } }, required: ["className"] } });
  assert.ok(!("confirm" in schema.parameters.properties));
  assert.ok(!/confirm=true/.test(schema.description));
});

test("previews never come from tools that write without confirm", () => {
  ["create_event", "update_event", "create_school_announcement", "update_school_announcement", "set_employee_hold", "save_report"].forEach((name) => assert.ok(!gate.NATIVE_PREVIEW.has(name), name));
  [...gate.NATIVE_PREVIEW].forEach((name) => assert.ok(REGISTRY[name], `${name} is registered`));
});

test("nothing secret leaves a tool", () => {
  const { scrub } = require("../services/secrets");
  const found = [];
  const out = JSON.stringify(scrub({
    name: "Ama", password: "hunter2", token: "abc", hasPassword: true,
    link: "https://managira.s3.us-east-1.amazonaws.com/student-documents/63/1/x.pdf?X-Amz-Signature=abc&X-Amz-Credential=def",
    note: "key sk_live_ABCDEFGHIJKLMNOP and Bearer abcdefghijklmnopqrstuvwxyz123 and $2b$10$abcdefghijklmnopqrstuuv0123456789ABCDEFGHIJKLMNOPQRSTU",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  }, found));
  assert.ok(!/hunter2|"abc"|amazonaws|X-Amz|sk_live_|abcdefghijklmnopqrstuvwxyz123|\$2b\$|eyJhbGci/.test(out), out);
  assert.match(out, /"hasPassword":true/);
  assert.match(out, /"name":"Ama"/);
});

test("a tool can't reach another school: every call carries the caller's own", async () => {
  const client = require("../internalApiClient");
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => { seen.push({ url: String(url), body: init && init.body }); return { ok: true, json: async () => ({}) }; };
  try {
    await client.runAsCaller({ organizationId: 63, userId: 240, viewerType: "staff", userRole: "Manager", accountType: "Manager" }, async () => {
      await client.callInternalApi("/internal/api/classes?organizationId=158&q=x");
      await client.callInternalApi("/internal/api/classes/delete", { method: "POST", body: { organizationId: 158, organization_id: 158, className: "6A" } });
    });
  } finally {
    global.fetch = realFetch;
  }
  assert.match(seen[0].url, /organizationId=63/);
  assert.ok(!/organizationId=158/.test(seen[0].url));
  const body = JSON.parse(seen[1].body);
  assert.equal(body.organizationId, 63);
  assert.equal(body.organization_id, 63);
});

// ---- forms questions reach the Forms & requests tools ----
test("the Grade 6 forms question is routed to get_form_requests", () => {
  const questions = [
    "How many of these students in Grade 6 have task requested of their parent and they are not completed",
    "which parents haven't signed the permission slip",
    "outstanding forms for JHS 1",
    "remind the families who haven't filled in the consent form",
  ];
  const schemas = listToolSchemas();
  questions.forEach((userText) => {
    const areas = selectAreas({ userText, history: [] });
    assert.ok(areas.has("forms"), `${userText} -> ${[...areas].join(",")}`);
    const names = selectToolSchemas(schemas, areas, () => true).map((s) => s.name || (s.function && s.function.name));
    assert.ok(names.includes("get_form_requests"), userText);
  });
});

test("forms tools need Custom Editor or Manage Students", () => {
  assert.ok(TOOL_ACCESS.get_form_requests && TOOL_ACCESS.remind_form_outstanding);
});

test("one action changes at most 200 records", async () => {
  const { runTool } = require("../tools");
  const { TOOL_ACCESS } = require("../services/access");
  let ran = false;
  REGISTRY.__test_bulk__ = { name: "__test_bulk__", description: "test-only", parameters: {}, async handler() { ran = true; return {}; } };
  TOOL_ACCESS.__test_bulk__ = { open: true };
  try {
    const big = await runTool("__test_bulk__", { students: Array.from({ length: 201 }, (_, i) => ({ name: `S${i}` })) }, { organizationId: 63, viewerType: "staff" });
    assert.equal(big.status, "denied");
    assert.equal(ran, false);
    const fine = await runTool("__test_bulk__", { students: [{ name: "A" }] }, { organizationId: 63, viewerType: "staff" });
    assert.equal(fine.status, "ok");
  } finally {
    delete REGISTRY.__test_bulk__;
    delete TOOL_ACCESS.__test_bulk__;
  }
});

test("a count taken from a list that was cut short is caught; the total isn't", () => {
  const { noteShortLists, countsFromShortLists } = require("../services/orchestrator");
  const counts = new Map();
  noteShortLists({ truncated: true, totals: { studentsWithOutstanding: 612 }, students: new Array(500).fill({}) }, counts);
  assert.deepEqual(countsFromShortLists("**500** students still owe", counts), [500]);
  assert.deepEqual(countsFromShortLists("**612** students still owe; the list shows the first 500", counts), []);
  noteShortLists({ truncated: false, students: new Array(30).fill({}) }, counts);
  assert.deepEqual(countsFromShortLists("30 students", counts), []);
});

test("a read tool never lets the model choose who is asking", async () => {
  const client = require("../internalApiClient");
  const { readTool } = require("../tools/read/_factory");
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => { seen.push(String(url)); return { ok: true, json: async () => ({ ok: true }) }; };
  try {
    const tool = readTool({ name: "probe_read", description: "x", access: { open: true }, areas: ["students"] });
    await client.runAsCaller({ organizationId: 63, userId: 1026, viewerType: "staff", userRole: "Teacher", accountType: "Teacher", userEmail: "t@example.com" }, () =>
      tool.handler({ userId: 240, userRole: "Manager", accountType: "Organization", organizationId: 158, q: "Ama" }));
  } finally {
    global.fetch = realFetch;
  }
  const url = new URL(seen[0], "http://x");
  assert.equal(url.searchParams.get("userId"), "1026");
  assert.equal(url.searchParams.get("userRole"), "Teacher");
  assert.equal(url.searchParams.get("accountType"), "Teacher");
  assert.equal(url.searchParams.get("organizationId"), "63");
  assert.equal(url.searchParams.get("q"), "Ama");
});

test("a message reaching a whole school is confirmed by typing the recipient count", () => {
  const gate = require("../services/confirmGate");
  const T = { organizationId: 63, userId: 240 };
  const p = gate.create({ tenant: T, chatId: 41, turn: 1, tool: "send_message", args: { message: "School is closed tomorrow.", channels: ["email"], allGuardians: true }, level: 3, label: "Email every parent", typeToConfirm: "1801" });
  assert.equal(p.keyDetail, "1801");
  const plainYes = gate.decide({ tenant: T, chatId: 41, userText: "yes, send it" });
  assert.equal(plainYes.run.length, 0, "a plain yes isn't enough");
  assert.match(plainYes.refusal, /"1801"/);
  assert.equal(gate.decide({ tenant: T, chatId: 41, userText: "yes send it to all 1801" }).run.length, 1);
});

test("when only previews exist, a permanent change says exactly what to type", () => {
  const { waitingLine } = require("../services/orchestrator");
  assert.equal(waitingLine([{ level: 1, label: "Create event X" }]), "Nothing has been done yet: the preview above is waiting for your Confirm.");
  assert.equal(waitingLine([{ level: 3, label: "Delete school year 2026-2027", keyDetail: "2026-2027" }]), "Nothing has been done yet. Delete school year 2026-2027 can't be undone: to go ahead, type **2026-2027** (or press Confirm and type it).");
});

test("a delete takes what's attached only when the person asks for that", () => {
  const { asksToIncludeAttached } = require("../services/orchestrator");
  assert.equal(asksToIncludeAttached("Delete the subject Art.", []), false);
  assert.equal(asksToIncludeAttached("Delete Art and everything in it, including the scores.", []), true);
  assert.equal(asksToIncludeAttached("yes", [{ role: "user", content: "Delete the Fall enrollment with all its placements" }]), true, "said in the message before");
  assert.equal(asksToIncludeAttached("yes do it", [{ role: "user", content: "Delete the class Grade 5 - Room 7" }]), false);
});
