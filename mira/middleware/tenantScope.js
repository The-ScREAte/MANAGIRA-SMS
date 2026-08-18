// Normalizes the identity resolved by ssoAuth into the single shape every
// tool handler and query is required to read from (req.tenant) - tools
// never read req.identity directly, so there's exactly one place that
// decides what "the current tenant/user/role" means. Mirrors the role-tag
// resolution used by the main app's announcement system for consistency.
const MANAGER_LIKE_ROLES = new Set(["organization", "admin", "mini admin"]);

function resolveViewerType(identity) {
  if (identity.guardianId) return "guardian";
  if (identity.studentId) return "student";
  return "staff";
}

function resolveRoleTags(identity) {
  const tags = [];
  const userRole = String(identity.userRole || "").trim().toLowerCase();
  const accountType = String(identity.accountType || "").trim().toLowerCase();

  if (identity.guardianId) tags.push("parent", "guardian");
  if (identity.studentId) tags.push("student");
  if (userRole === "teacher") tags.push("teacher");
  if (userRole === "student teacher") tags.push("student_teacher");
  if (userRole === "driver" || accountType === "driver") tags.push("driver");
  if (MANAGER_LIKE_ROLES.has(userRole) || MANAGER_LIKE_ROLES.has(accountType)) tags.push("org_admin");
  if (accountType === "admin") tags.push("super_admin");

  return [...new Set(tags)];
}

function tenantScope(req, res, next) {
  if (!req.identity) {
    return res.status(401).json({ error: "Not signed in." });
  }

  const viewerType = resolveViewerType(req.identity);
  const viewerId = viewerType === "guardian" ? req.identity.guardianId : viewerType === "student" ? req.identity.studentId : req.identity.userId;

  req.tenant = {
    organizationId: req.identity.organizationId,
    organizationName: req.identity.organizationName || `Organization #${req.identity.organizationId}`,
    userId: viewerId,
    viewerType,
    roleTags: resolveRoleTags(req.identity),
    displayName: [req.identity.firstName, req.identity.lastName].filter(Boolean).join(" ") || "there",
  };

  next();
}

module.exports = { tenantScope, resolveRoleTags, resolveViewerType };
