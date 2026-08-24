const test = require("node:test");
const assert = require("node:assert/strict");

const { REGISTRY, runTool, listToolSchemas } = require("../tools");

test("runTool: unknown tool name is denied, not silently ignored", async () => {
  const result = await runTool("delete_everything", {}, { organizationId: 63 });
  assert.equal(result.status, "denied");
});

test("listToolSchemas: every registered tool has name/description/parameters", () => {
  const schemas = listToolSchemas();
  assert.ok(schemas.length >= 9, "expected at least the 9 spec'd tools to be registered");
  for (const schema of schemas) {
    assert.ok(schema.name);
    assert.ok(schema.description);
    assert.ok(schema.parameters);
  }
});

test("runTool: the tenant object is passed through to the tool handler unmodified", async () => {
  const seenTenants = [];
  REGISTRY.__test_probe__ = {
    name: "__test_probe__",
    description: "test-only",
    parameters: {},
    async handler(args, tenant) {
      seenTenants.push(tenant);
      return { ok: true };
    },
  };
  try {
    const tenant = { organizationId: 63, userId: 1, viewerType: "staff", roleTags: ["teacher"] };
    const result = await runTool("__test_probe__", {}, tenant);
    assert.equal(result.status, "ok");
    assert.deepEqual(seenTenants[0], tenant);
  } finally {
    delete REGISTRY.__test_probe__;
  }
});

test("runTool: a handler throwing with .denied=true reports status 'denied', not 'error'", async () => {
  REGISTRY.__test_denied__ = {
    name: "__test_denied__",
    description: "test-only",
    parameters: {},
    async handler() {
      const err = new Error("not allowed");
      err.denied = true;
      throw err;
    },
  };
  try {
    const result = await runTool("__test_denied__", {}, { organizationId: 63 });
    assert.equal(result.status, "denied");
    assert.equal(result.result, "not allowed");
  } finally {
    delete REGISTRY.__test_denied__;
  }
});

test("runTool: a handler throwing a normal error reports status 'error'", async () => {
  REGISTRY.__test_error__ = {
    name: "__test_error__",
    description: "test-only",
    parameters: {},
    async handler() {
      throw new Error("boom");
    },
  };
  try {
    const result = await runTool("__test_error__", {}, { organizationId: 63 });
    assert.equal(result.status, "error");
  } finally {
    delete REGISTRY.__test_error__;
  }
});
