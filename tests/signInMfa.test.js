const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

// Stand-ins for the feature switch, the school's rules and the authenticator codes.
const featuresPath = require.resolve("../utils/shards/features");
const tenantPath = require.resolve("../utils/tenantSettings");
const mfaPath = require.resolve("../utils/mfa");
let rule = "off";
let appSetUp = false;
require.cache[featuresPath] = { id: featuresPath, filename: featuresPath, loaded: true, exports: { isOn: (key) => key === "sign_in_authenticator" } };
require.cache[tenantPath] = { id: tenantPath, filename: tenantPath, loaded: true, exports: { settingsFor: async () => ({ mfa_required: rule }) } };
require.cache[mfaPath] = { id: mfaPath, filename: mfaPath, loaded: true, exports: { isSetUp: async () => appSetUp, keyOf: (a) => `${a.kind}:${a.id}`, forSchool: async () => [] } };

const signInMfa = require("../utils/signInMfa");
const dbWith = (personRequired = false) => ({ query: async () => ({ rows: [{ required: personRequired }] }) });
const staff = (role, extra = {}) => ({ userId: 7, organizationId: 63, userRole: role, ...extra });

test("whose account an authenticator belongs to: staff and a school signed in as itself, never parents or students", () => {
  assert.deepEqual(signInMfa.accountOfSession(staff("Teacher")), { kind: "user", id: 7, organizationId: 63 });
  assert.deepEqual(signInMfa.accountOfSession({ accountType: "Organization", organizationId: 63, user: { user_id: 63 } }), { kind: "organization", id: 63, organizationId: 63 });
  assert.equal(signInMfa.accountOfSession({ guardianId: 4, organizationId: 63 }), null);
  assert.equal(signInMfa.accountOfSession({ studentId: 5, organizationId: 63 }), null);
  assert.equal(signInMfa.accountOfSession({ userId: 9 }), null, "a platform account with no school");
});

test("who must use an app: the school's rule by role, or a manager's choice for one person", async () => {
  rule = "off";
  assert.equal(await signInMfa.requiredFor(dbWith(false), staff("Teacher")), false);
  assert.equal(await signInMfa.requiredFor(dbWith(true), staff("Teacher")), true, "required for this one person");
  rule = "admins";
  assert.equal(await signInMfa.requiredFor(dbWith(false), staff("Manager")), true);
  assert.equal(await signInMfa.requiredFor(dbWith(false), staff("Supervisor")), true);
  assert.equal(await signInMfa.requiredFor(dbWith(false), staff("Teacher")), false);
  assert.equal(await signInMfa.requiredFor(dbWith(false), { accountType: "Organization", organizationId: 63, user: { user_id: 63 } }), true);
  rule = "staff";
  assert.equal(await signInMfa.requiredFor(dbWith(false), staff("Driver")), true);
  assert.equal(await signInMfa.requiredFor(dbWith(false), { guardianId: 4, organizationId: 63 }), false, "parents never");
  rule = "off";
});

function fakeReq(session, { path = "/common/orgDashboard", method = "GET", accept = "text/html" } = {}) {
  return { session, path, method, xhr: false, get: (h) => (h.toLowerCase() === "accept" ? accept : "") };
}
function fakeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.redirect = (to) => { res.statusCode = 302; res.location = to; return res; };
  return res;
}

test("someone required to use an app is sent to set it up; everything else passes", async () => {
  const gate = signInMfa.gate(dbWith(false));
  const run = async (req) => { const res = fakeRes(); let passed = false; await gate(req, res, () => { passed = true; }); return { res, passed }; };
  rule = "staff"; appSetUp = false;
  let r = await run(fakeReq(staff("Teacher")));
  assert.equal(r.passed, false);
  assert.equal(r.res.location, "/account/authenticator?required=1");
  r = await run(fakeReq(staff("Teacher"), { path: "/common/x", method: "POST", accept: "application/json" }));
  assert.equal(r.res.statusCode, 403);
  r = await run(fakeReq(staff("Teacher"), { path: "/account/authenticator" }));
  assert.equal(r.passed, true, "the set-up page itself is open");
  r = await run(fakeReq(staff("Teacher"), { path: "/account/logout" }));
  assert.equal(r.passed, true, "signing out is open");
  r = await run(fakeReq(staff("Teacher", { signedInWith: "sso" })));
  assert.equal(r.passed, true, "single sign-on is left to the provider");
  r = await run(fakeReq({ guardianId: 4, organizationId: 63 }));
  assert.equal(r.passed, true, "parents aren't asked");
  appSetUp = true;
  r = await run(fakeReq(staff("Teacher", { appCheck: null })));
  assert.equal(r.passed, true, "set up: through");
  rule = "off"; appSetUp = false;
});

test("a breached password is refused; an unreachable service never blocks anyone", async () => {
  const rules = require("../utils/passwordRules");
  const realFetch = global.fetch;
  const password = "Correct Horse 2026!";
  const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  let asked = null;
  try {
    global.fetch = async (url) => { asked = url; return { ok: true, text: async () => `0000000000000000000000000000000000A:2\n${sha1.slice(5)}:42\n` }; };
    assert.equal(await rules.breachCount(password), 42);
    assert.equal(asked, `https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, "only the first 5 characters of the hash are sent");
    assert.match(await rules.passwordProblemAsync(password), /data breach/);
    global.fetch = async () => ({ ok: true, text: async () => "0000000000000000000000000000000000A:2\n" });
    assert.equal(await rules.passwordProblemAsync(password), null);
    global.fetch = async () => { throw new Error("offline"); };
    assert.equal(await rules.passwordProblemAsync(password), null, "fails open");
    assert.match(await rules.passwordProblemAsync("short"), /at least 8/);
  } finally {
    global.fetch = realFetch;
  }
});
