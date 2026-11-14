const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const human = require("../utils/humanCheck");

const solve = (c) => {
  for (let n = 0; n <= c.maxnumber; n += 1) if (crypto.createHash("sha256").update(c.salt + n).digest("hex") === c.challenge) return n;
  return -1;
};
const proofFor = (c, extra = {}) => JSON.stringify({ salt: c.salt, challenge: c.challenge, number: solve(c), issuedAt: c.issuedAt, signature: c.signature, ...extra });
const req = (body, ip = "10.0.0.1") => ({ body, ip });
// Pretend the form has been open a while, as a person's would.
function later(ms, fn) {
  const real = Date.now;
  Date.now = () => real() + ms;
  try { return fn(); } finally { Date.now = real; }
}

test("a solved challenge from a form open a few seconds passes, once", () => {
  human._reset();
  const c = human.issue("help");
  const body = { human_proof: proofFor(c) };
  assert.deepStrictEqual(later(5000, () => human.verify(req(body), "help")), { ok: true });
  assert.strictEqual(later(6000, () => human.verify(req(body), "help")).ok, false, "the same answer twice is refused");
});

test("bots are refused: no answer, a wrong one, a forged one, another form's, too fast, too old, the hidden field", () => {
  human._reset();
  const c = human.issue("help");
  assert.strictEqual(later(5000, () => human.verify(req({}), "help")).ok, false);
  assert.strictEqual(later(5000, () => human.verify(req({ human_proof: proofFor(c, { number: (solve(c) + 1) % c.maxnumber }) }), "help")).ok, false);
  assert.strictEqual(later(5000, () => human.verify(req({ human_proof: proofFor(c, { signature: "0".repeat(64) }) }), "help")).ok, false);
  assert.strictEqual(later(5000, () => human.verify(req({ human_proof: proofFor(c) }), "demo")).ok, false, "a help answer doesn't open the demo form");
  const quick = human.issue("help");
  assert.match(human.verify(req({ human_proof: proofFor(quick) }), "help").reason, /quick/);
  const old = human.issue("help");
  assert.match(later(3 * 60 * 60 * 1000, () => human.verify(req({ human_proof: proofFor(old) }), "help")).reason, /refresh/);
  const trap = human.issue("help");
  const caught = later(5000, () => human.verify(req({ human_proof: proofFor(trap), company_website: "http://spam.example" }), "help"));
  assert.strictEqual(caught.ok, false);
  assert.strictEqual(caught.bot, true);
});

test("one network can send only so many forms an hour", () => {
  human._reset();
  const results = [];
  for (let i = 0; i < 4; i += 1) {
    const c = human.issue("help");
    results.push(later(5000, () => human.verify(req({ human_proof: proofFor(c) }, "10.0.0.9"), "help", { perHour: 3 })).ok);
  }
  assert.deepStrictEqual(results, [true, true, true, false]);
  const other = human.issue("help");
  assert.strictEqual(later(5000, () => human.verify(req({ human_proof: proofFor(other) }, "10.0.0.10"), "help", { perHour: 3 })).ok, true, "another network still can");
});

test("an address gets at most a few confirmation emails a day, whoever types it", () => {
  human._reset();
  const sent = [1, 2, 3, 4].map(() => human.emailAllowance("Someone@Example.com"));
  assert.deepStrictEqual(sent, [true, true, true, false]);
  assert.strictEqual(human.emailAllowance("someone@example.com"), false, "case doesn't matter");
  assert.strictEqual(human.emailAllowance("other@example.com"), true);
  assert.strictEqual(human.emailAllowance(""), false);
});
