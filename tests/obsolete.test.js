const test = require("node:test");
const assert = require("node:assert");
const { inUseMessage, safeReturnTo, wantsJson, obsoleteHandler, KINDS } = require("../utils/obsolete");

test("in-use message names the records and offers obsolete", () => {
  const msg = inUseMessage("The class “Grade 3”", [{ count: 72, text: "72 scores" }, { count: 4, text: "4 assessments" }]);
  assert.match(msg, /can't be deleted/);
  assert.match(msg, /72 scores and 4 assessments/);
  assert.match(msg, /make it obsolete instead/);
});

test("return path stays on this site", () => {
  assert.strictEqual(safeReturnTo("/common/manageClassSubjectAndGradYr", "/x"), "/common/manageClassSubjectAndGradYr");
  assert.strictEqual(safeReturnTo("//evil.example", "/x"), "/x");
  assert.strictEqual(safeReturnTo("https://evil.example", "/x"), "/x");
  assert.strictEqual(safeReturnTo("/\\evil", "/x"), "/x");
});

test("JSON requests are detected", () => {
  assert.ok(wantsJson({ headers: { accept: "application/json" } }));
  assert.ok(wantsJson({ headers: { "content-type": "application/json" } }));
  assert.ok(!wantsJson({ headers: { accept: "text/html" } }));
  assert.ok(!wantsJson({}));
});

test("every kind can be found and checked", () => {
  for (const [name, def] of Object.entries(KINDS)) {
    assert.ok(def.table && def.idColumn && def.nameColumn && def.noun, name);
    assert.strictEqual(typeof def.uses, "function", name);
  }
});

test("handler refuses kinds the route doesn't allow", async () => {
  const handler = obsoleteHandler({}, { kinds: ["class"], fallbackRedirect: "/back" });
  let status = 0;
  let body = null;
  const res = { status(code) { status = code; return this; }, json(b) { body = b; return this; } };
  await handler({ headers: { accept: "application/json" }, session: { organizationId: 63 }, body: { kind: "remark", id: "1" } }, res);
  assert.strictEqual(status, 400);
  assert.strictEqual(body.success, false);
});

test("handler asks to sign in without a school", async () => {
  const handler = obsoleteHandler({}, { kinds: ["class"], fallbackRedirect: "/back" });
  let status = 0;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  await handler({ headers: { accept: "application/json" }, session: {}, body: { kind: "class", id: "1" } }, res);
  assert.strictEqual(status, 401);
});
