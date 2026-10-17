const test = require("node:test");
const assert = require("node:assert");
const { STEPS, setStepSkipped } = require("../utils/setupChecklist");

test("every setup step has a title, a link and a check", () => {
  const keys = new Set();
  for (const step of STEPS) {
    assert.ok(step.key && step.title && step.hint && step.href && step.sql, step.key);
    assert.ok(step.href.startsWith("/"), step.key);
    assert.ok(!keys.has(step.key), `duplicate ${step.key}`);
    keys.add(step.key);
  }
  assert.ok(STEPS.some((s) => s.required) && STEPS.some((s) => !s.required));
});

test("required steps can't be skipped", async () => {
  const required = STEPS.find((s) => s.required);
  const db = { query: async () => { throw new Error("should not write"); } };
  const result = await setStepSkipped(db, 1, required.key, true, 1);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 409);
});

test("unknown steps are refused", async () => {
  const result = await setStepSkipped({}, 1, "nope", true, 1);
  assert.strictEqual(result.status, 404);
});

test("setup steps show for managers, the school account, admins and hub users only", () => {
  const { canSeeSetupSteps } = require("../utils/setupChecklist");
  const org = { organizationId: 63 };
  assert.ok(canSeeSetupSteps({ ...org, accountType: "Organization", userRole: "Manager" }));
  assert.ok(canSeeSetupSteps({ ...org, userRole: "Manager", accountType: "Manager" }));
  assert.ok(canSeeSetupSteps({ ...org, superAdminOrgSwitch: true, userRole: "Admin" }));
  assert.ok(canSeeSetupSteps({ ...org, hubOrgSwitch: { by: "hub" }, accountType: "Organization" }));
  assert.ok(!canSeeSetupSteps({ ...org, userRole: "Teacher", accountType: "Teacher" }));
  assert.ok(!canSeeSetupSteps({ ...org, userRole: "Supervisor", accountType: "Supervisor" }));
  assert.ok(!canSeeSetupSteps({ ...org, accountType: "Guardian", userRole: "Guardian" }));
  assert.ok(!canSeeSetupSteps({ accountType: "Organization" }));
});
