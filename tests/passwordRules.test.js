const test = require("node:test");
const assert = require("node:assert/strict");

// The same bcryptjs, without the worker threads (they keep a test process from ending).
const bcrypt = require("bcryptjs");
const hashingPath = require.resolve("../utils/passwordHashing");
require.cache[hashingPath] = { id: hashingPath, filename: hashingPath, loaded: true, exports: { compare: bcrypt.compare, hash: bcrypt.hash } };

const rules = require("../utils/passwordRules");

test("a new password needs 8 characters and at most 72 bytes", () => {
  assert.match(rules.passwordProblem("Ab1!xyz"), /at least 8/);
  assert.equal(rules.passwordProblem("Ab1!wxyz"), null);
  assert.equal(rules.passwordProblem("a".repeat(72)), null);
  assert.match(rules.passwordProblem("a".repeat(73)), /at most 72/);
  // Counted in bytes, as bcrypt reads them.
  assert.match(rules.passwordProblem("é".repeat(37)), /at most 72/);
  assert.match(rules.passwordProblem(""), /at least 8/);
});

test("the old sign-in form of a password is exactly what the validator produced", () => {
  const validator = require("validator");
  for (const password of ["Tom&Jerry's/1!", "  spaced out  ", "<b>\"quote\"</b>", "back\\slash`tick", "plain"]) {
    assert.equal(rules.legacyForm(password), validator.escape(password.trim()), password);
  }
});

test("a password opens whether it was saved as typed or in the old escaped form", async () => {
  const typed = "Tom&Jerry's/1!";
  const savedAsTyped = await bcrypt.hash(typed, 4);
  const savedEscaped = await bcrypt.hash(rules.legacyForm(typed), 4);
  assert.equal(await rules.passwordMatches(typed, savedAsTyped), true);
  assert.equal(await rules.passwordMatches(typed, savedEscaped), true);
  assert.equal(await rules.passwordMatches("Tom&Jerry's/1", savedAsTyped), false);
  assert.equal(await rules.passwordMatches(typed, null), false);
  assert.equal(await rules.passwordMatches(typed, "not-a-hash"), false);
});

test("sign-in forms leave the password exactly as typed", async () => {
  const validation = require("../validation/accountValidation");
  for (const chain of [validation.validateLogin, validation.validateGuardianLogin, validation.validateStudentLogin]) {
    const req = { body: { email: "a@b.com", identifier: "a@b.com", password: "  Tom&Jerry's/1! " } };
    for (const step of chain) if (step.run) await step.run(req);
    assert.equal(req.body.password, "  Tom&Jerry's/1! ");
  }
});
