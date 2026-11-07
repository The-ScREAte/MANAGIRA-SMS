const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const connections = require("../utils/sso/connections");
const saml = require("../utils/sso/saml");
const oidc = require("../utils/sso/oidc");
const { checkedUrl, isPrivateIp } = require("../utils/safeFetch");

function makeCertificate(days = 30) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sso-test-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", String(days), "-subj", "/CN=test"], { stdio: "ignore" });
  const pem = fs.readFileSync(path.join(dir, "c.pem"), "utf8");
  fs.rmSync(dir, { recursive: true, force: true });
  return pem;
}

test("addresses that could reach the server's own network are refused", () => {
  ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"].forEach((ip) => assert.equal(isPrivateIp(ip), true, ip));
  ["8.8.8.8", "142.250.1.1", "2607:f8b0::1"].forEach((ip) => assert.equal(isPrivateIp(ip), false, ip));
  assert.throws(() => checkedUrl("http://example.com/x"), /https/);
  assert.throws(() => checkedUrl("https://169.254.169.254/latest"), /reached/);
  assert.throws(() => checkedUrl("https://user:secret@example.com/"), /reached/);
  assert.throws(() => checkedUrl("file:///etc/passwd"), /https/);
  assert.equal(checkedUrl("https://idp.example.com/metadata").hostname, "idp.example.com");
});

test("a certificate must be real and current", () => {
  const pem = makeCertificate();
  assert.match(connections.readCertificate(pem), /BEGIN CERTIFICATE/);
  assert.match(connections.readCertificate(pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "")), /BEGIN CERTIFICATE/, "the bare block works too");
  assert.throws(() => connections.readCertificate("not a certificate at all!"), connections.SsoSetupError);
  assert.throws(() => connections.readCertificate("QUJD"), connections.SsoSetupError);
  assert.equal(connections.readCertificate(""), null);
});

test("a provider's metadata fills in its settings, and a hostile file is refused", () => {
  const body = makeCertificate().replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  const xml = `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/e"><md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${body}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.com/post"/><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/redirect"/></md:IDPSSODescriptor></md:EntityDescriptor>`;
  const found = saml.readMetadataXml(xml);
  assert.equal(found.samlEntityId, "https://idp.example.com/e");
  assert.equal(found.samlSsoUrl, "https://idp.example.com/redirect", "prefers the redirect binding");
  assert.equal(found.samlCertificates.length, 1);
  assert.throws(() => saml.readMetadataXml(`<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x>&y;</x>`), /can't be read/);
  assert.throws(() => saml.readMetadataXml("<html></html>"), connections.SsoSetupError);
});

test("the email comes from what the provider signed, and an unverified one is refused", () => {
  const plain = { email_attribute: null };
  assert.equal(saml.emailFrom({ nameID: "A@School.edu" }, plain), "a@school.edu");
  assert.equal(saml.emailFrom({ nameID: "opaque-id", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "b@school.edu" }, plain), "b@school.edu");
  assert.equal(saml.emailFrom({ nameID: "opaque-id", workMail: "c@school.edu" }, { email_attribute: "workMail" }), "c@school.edu");
  assert.equal(saml.emailFrom({ nameID: "opaque-id" }, plain), null);
  assert.equal(oidc.emailFrom({ email: "d@school.edu", email_verified: true }, plain), "d@school.edu");
  assert.equal(oidc.emailFrom({ preferred_username: "e@school.edu" }, plain), "e@school.edu");
  assert.throws(() => oidc.emailFrom({ email: "f@school.edu", email_verified: false }, plain), /verified/);
});

test("a saved connection is only complete with everything it needs", () => {
  assert.equal(connections.isComplete({ protocol: "saml", saml_entity_id: "e", saml_sso_url: "u", saml_certificates: ["c"] }), true);
  assert.equal(connections.isComplete({ protocol: "saml", saml_entity_id: "e", saml_sso_url: "u", saml_certificates: [] }), false);
  assert.equal(connections.isComplete({ protocol: "oidc", oidc_issuer: "i", oidc_client_id: "c", oidc_client_secret_locked: "s" }), true);
  assert.equal(connections.isComplete({ protocol: "oidc", oidc_issuer: "i", oidc_client_id: "c" }), false);
});

// ---------- what the security review found ----------
const { isPortalRole } = require("../middleware/permissionMiddleware");

test("a parent or student session holds no staff permission, whatever it carries", async () => {
  const { userHasPermission } = require("../middleware/permissionMiddleware");
  const db = { query: async () => { throw new Error("must not look anything up for a parent or student"); } };
  for (const role of ["Guardian", "Student", "guardian", " student "]) {
    assert.equal(isPortalRole(role), true);
    assert.equal(await userHasPermission(db, { userId: 240, userRole: role, organizationId: 63, accountType: role, userEmail: "owner@school.example" }, "manage_sso"), false);
  }
  assert.equal(isPortalRole("Teacher"), false);
  assert.equal(isPortalRole("Manager"), false);
});

test("a student's number never becomes a member of staff with the same number", async () => {
  const setAllowedRoles = require("../middleware/setAllowedRoles");
  const session = { userRole: "Student", accountType: "Student", organizationId: 63, user: { user_id: 240, account_type: "Student" } };
  const res = { locals: {} };
  await new Promise((resolve) => setAllowedRoles({ session }, res, resolve));
  assert.equal(session.userRole, "Student");
  assert.equal(session.accountType, "Student");
  assert.equal(res.locals.userRole, "Student");
});

test("only a manager gets past the single sign-on settings door", () => {
  const { managersOnly } = require("../controllers/ssoController");
  const run = (session) => {
    let passed = false, status = null;
    managersOnly({ session }, { status(code) { status = code; return this; }, json() { return this; } }, () => { passed = true; });
    return { passed, status };
  };
  assert.equal(run({ userRole: "Manager" }).passed, true);
  assert.equal(run({ userRole: "Manager", accountType: "Organization" }).passed, true);
  for (const role of ["Teacher", "Driver", "Guardian", "Student", "Admin"]) {
    assert.deepEqual(run({ userRole: role, accountType: role }), { passed: false, status: 403 });
  }
});

test("a provider saying the email isn't verified is refused however it says it", () => {
  const { emailFrom } = require("../utils/sso/oidc");
  const connection = {};
  assert.throws(() => emailFrom({ email: "a@b.example", email_verified: false }, connection));
  assert.throws(() => emailFrom({ email: "a@b.example", email_verified: "false" }, connection));
  assert.throws(() => emailFrom({ email: "a@b.example", email_verified: "FALSE" }, connection));
  assert.equal(emailFrom({ email: "A@b.example", email_verified: true }, connection), "a@b.example");
  assert.equal(emailFrom({ email: "a@b.example" }, connection), "a@b.example");
});

test("addresses that hide a private one inside them are refused", () => {
  const { isPrivateIp } = require("../utils/safeFetch");
  for (const ip of ["::7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "::ffff:127.0.0.1", "::1", "fd00::1", "fe80::1", "127.0.0.1", "10.0.0.1", "169.254.169.254"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPrivateIp(ip), false, ip);
});

// ---------- nobody is ever turned away at a sign-in form ----------
function signInTry(guard, body) {
  const listeners = [];
  const req = { body, get: () => "", ip: "203.0.113.9", originalUrl: "/account/login" };
  const res = { statusCode: 302, on: (_n, fn) => listeners.push(fn), get: () => "/account/login" };
  const started = Date.now();
  return new Promise((resolve) => guard(req, res, () => resolve({ waited: Date.now() - started, finishAs(code, location) { res.statusCode = code; res.get = () => location; listeners.forEach((fn) => fn()); } })));
}

test("sign-in forms never refuse: wrong guesses only wait their turn, and a right password gets in", async () => {
  const { signInGuard } = require("../utils/authRateLimit");
  const guard = signInGuard("unit-login", { field: "email" });
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 10; i += 1) {
      const attempt = await signInTry(guard, { email: "someone@school.example" });
      assert.ok(attempt.waited < 50, "the first ten go straight through");
      attempt.finishAs(302, "/account/login");
    }
    const slowed = await signInTry(guard, { email: "someone@school.example" });
    assert.ok(slowed.waited < 50, "the eleventh takes the first turn");
    slowed.finishAs(302, "/account/login");
    const next = await signInTry(guard, { email: "someone@school.example" });
    assert.ok(next.waited >= 1500 && next.waited < 2500, `the next waits its turn, about 2 s (${next.waited})`);
    next.finishAs(302, "/common/orgDashboard");
    const after = await signInTry(guard, { email: "someone@school.example" });
    assert.ok(after.waited < 50, "signing in clears it");
    const other = await signInTry(guard, { email: "someone.else@school.example" });
    assert.ok(other.waited < 50, "and someone else on the same network was never affected");
  } finally {
    console.warn = warn;
  }
});
