const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canViewDemoAudience,
  demoAudienceForSession,
  normalizeDemoAudiences,
} = require("../utils/appDemoAudience");
const { isCaptureSession } = require("../utils/appDemoCapture");

test("demo audiences normalize supported roles and preserve the existing public default", () => {
  assert.deepEqual(normalizeDemoAudiences(["parents", "students", "parents", "unknown"]), ["parents", "students"]);
  assert.deepEqual(normalizeDemoAudiences(null), ["public", "staff", "parents", "students"]);
  assert.equal(canViewDemoAudience(["parents"], "parents"), true);
  assert.equal(canViewDemoAudience(["parents"], "students"), false);
  assert.equal(canViewDemoAudience(["public"], "students"), true);
});

test("portal session roles map to their audience without exposing private audiences to anonymous visitors", () => {
  assert.equal(demoAudienceForSession({ userRole: "Guardian", guardianId: 7 }), "parents");
  assert.equal(demoAudienceForSession({ userRole: "Student", studentId: 8 }), "students");
  assert.equal(demoAudienceForSession({ userRole: "Teacher", userId: 9 }), "staff");
  assert.equal(demoAudienceForSession({}), "public");
});

test("capture is limited to authenticated portal or staff users in the selected school", () => {
  const window = { organization_id: 14 };
  assert.equal(isCaptureSession({ session: { organizationId: 14, userRole: "Guardian", guardianId: 7 } }, window), true);
  assert.equal(isCaptureSession({ session: { organizationId: 14, userRole: "Student", studentId: 8 } }, window), true);
  assert.equal(isCaptureSession({ session: { organizationId: 14, userRole: "Teacher", userId: 9 } }, window), true);
  assert.equal(isCaptureSession({ session: { organizationId: 14, userRole: "Guardian" } }, window), false);
  assert.equal(isCaptureSession({ session: { organizationId: 14, userRole: "Student" } }, window), false);
  assert.equal(isCaptureSession({ session: { organizationId: 14, userRole: "Driver", userId: 9 } }, window), false);
  assert.equal(isCaptureSession({ session: { organizationId: 15, userRole: "Guardian", guardianId: 7 } }, window), false);
});
