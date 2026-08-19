// Normalizes the identity resolved by ssoAuth into the single shape every
// tool handler and query is required to read from (req.tenant) - tools
// never read req.identity directly, so there's exactly one place that
// decides what "the current tenant/user/role" means. Mirrors the role-tag
// resolution used by the main app's announcement system for consistency.
// "manager" added alongside the original set: it's the actual account_type
// used by staff org-admins created through the employee flow (see
// controllers/internalApiController.js users query) - without it, any
// Manager account was silently missing the "org_admin" tag and every
// admin-gated tool (createAnnouncement, the School Year write tools) wrongly
// denied them even though the backend's real per-user permission check
// (middleware/permissionMiddleware.js userHasPermission) would have allowed
// it. This tag is still only a cheap first-pass hint for tool UX text -
// actual authorization for write actions is re-derived from the database,
// never trusted from this alone.
const MANAGER_LIKE_ROLES = new Set(["organization", "admin", "mini admin", "manager"]);

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

// Human-facing role name for the UI (sidebar/settings). Deliberately NOT
// derived from roleTags above - those are internal permission-bucket hints
// (e.g. "org_admin" covers Manager, org owner, AND platform Admin/Mini
// Admin alike) never meant to be shown verbatim; doing so previously
// displayed a Manager account as "Org Admin", a role name that doesn't
// exist anywhere in this app's actual role system (Manager/Supervisor/
// Teacher/Driver for org staff, Organization for the owner login, Guardian,
// Student - platform-level Admin/Mini Admin/Internal Worker and Hub owner
// sessions never reach Mira at all, see ssoAuth.js's organizationId check).
// This shows the real stored role name instead.
function resolveRoleLabel(identity, viewerType) {
  if (viewerType === "guardian") return "Guardian";
  if (viewerType === "student") return "Student";

  const raw = String(identity.userRole || identity.accountType || "").trim();
  if (!raw) return "Staff";
  if (raw.toLowerCase() === "organization") return "Organization Owner";
  return raw;
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
    roleLabel: resolveRoleLabel(req.identity, viewerType),
    displayName: [req.identity.firstName, req.identity.lastName].filter(Boolean).join(" ") || "there",
    // Raw role/account-type from the validated session (never from chat
    // input) - passed through to internal API write endpoints so they can
    // re-derive the caller's actual granted permissions (see
    // middleware/permissionMiddleware.js userHasPermission) rather than
    // trusting the coarser roleTags bucket above.
    userRole: req.identity.userRole || null,
    accountType: req.identity.accountType || null,
  };

  next();
}

module.exports = { tenantScope, resolveRoleTags, resolveViewerType, resolveRoleLabel };
