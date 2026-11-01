const DEMO_AUDIENCES = ["public", "staff", "parents", "students"];

function normalizeDemoAudiences(value) {
  if (!Array.isArray(value)) return [...DEMO_AUDIENCES];
  return [...new Set(value.map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => DEMO_AUDIENCES.includes(item)))];
}

function demoAudienceForSession(session = {}) {
  const role = String(session.userRole || session.accountType || "").trim().toLowerCase();
  if (role === "guardian" || role === "parent") return "parents";
  if (role === "student") return "students";
  return session.userId ? "staff" : "public";
}

function canViewDemoAudience(audiences, audience) {
  const allowed = normalizeDemoAudiences(audiences);
  return allowed.includes("public") || allowed.includes(audience);
}

module.exports = {
  DEMO_AUDIENCES,
  normalizeDemoAudiences,
  demoAudienceForSession,
  canViewDemoAudience,
};
