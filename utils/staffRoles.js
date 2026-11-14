"use strict";
// A member of staff's access, as they and their school's admins see it ("Your access",
// /common/my-access): their role, school, classes (main or assistant teacher, subjects), what
// they can and can't do, their roles in the school's old system (staff_role_history, from a
// data migration, read-only) and every change to their role since (staff_role_changes).
const perms = require("../middleware/permissionMiddleware");
const features = require("./shards/features");

const { PERMISSION_OPTIONS, PERMISSIONS_SAVED_KEY } = perms;

let tablesReady = false;
let checkedAt = 0;
async function ready(db) {
  if (tablesReady || Date.now() - checkedAt < 60000) return tablesReady;
  checkedAt = Date.now();
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('staff_role_history', 'staff_role_changes', 'staff_access_seen')"
  ).catch(() => ({ rows: [{ n: 0 }] }));
  tablesReady = Number(rows[0].n) === 3;
  return tablesReady;
}
// Released with the data migration (feature data_migration).
const on = async (db, organizationId) => features.isOn("data_migration", { organizationId: Number(organizationId) || null }) && (await ready(db));

// Someone's role, saved permissions and class roles: compared before and after a change.
async function snapshot(db, organizationId, userId) {
  const assistant = await require("./mainTeacher").assistantReady(db);
  const [user, saved, classes] = await Promise.all([
    db.query("SELECT account_type::text AS role FROM users WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]),
    db.query("SELECT permission_key FROM user_permissions WHERE user_id = $1 AND organization_id = $2 ORDER BY permission_key", [userId, organizationId]).catch(() => ({ rows: [] })),
    db.query(
      `SELECT c.class_name, COALESCE(uc.main, FALSE) AS main, ${assistant ? "COALESCE(uc.assistant, FALSE)" : "FALSE"} AS assistant
         FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = $2
        WHERE uc.user_id = $1 ORDER BY c.class_name`,
      [userId, organizationId]
    ),
  ]);
  if (!user.rows[0]) return null;
  return {
    role: user.rows[0].role,
    permissions: saved.rows.map((r) => r.permission_key).filter((k) => k !== PERMISSIONS_SAVED_KEY),
    classes: classes.rows.map((r) => `${r.class_name}${r.main ? " (main teacher)" : r.assistant ? " (assistant teacher)" : ""}`),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// One row per thing that changed: role, permissions, class roles. Never stops the save.
async function logChanges(db, { organizationId, userId, before, after, by, byId = null }) {
  if (!(await on(db, organizationId)) || !after) return 0;
  const rows = [];
  if (!before || before.role !== after.role) rows.push(["role", before ? before.role : null, after.role]);
  if (!before || !same(before.permissions, after.permissions)) rows.push(["permissions", before ? before.permissions : null, after.permissions]);
  if (!before || !same(before.classes, after.classes)) rows.push(["class roles", before ? before.classes : null, after.classes]);
  for (const [what, oldValue, newValue] of rows) {
    await db.query(
      "INSERT INTO staff_role_changes (organization_id, user_id, changed_by, changed_by_id, what, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [organizationId, userId, by || "Someone", byId, what, JSON.stringify(oldValue), JSON.stringify(newValue)]
    ).catch((error) => console.error("[staffRoles] log:", error.message));
  }
  return rows.length;
}

// What someone can and can't do, in the words of the staff form (main permissions only).
// Drivers see only what belongs to driving; nobody else is told about the driver's permissions.
function abilities(held, available, role = null) {
  const has = new Set(held);
  const driver = String(role || "").toLowerCase() === "driver";
  const mains = PERMISSION_OPTIONS.filter((o) => !o.parent && !o.retired && (!available || available.has(o.key))
    && (driver ? perms.isDriverPermission(o.key) : o.group !== "Driver"));
  const can = mains.filter((o) => has.has(o.key)).map((o) => ({
    label: o.label,
    description: o.description || "",
    includes: PERMISSION_OPTIONS.filter((c) => c.parent === o.key && has.has(c.key) && !c.notAPage).map((c) => c.label),
  }));
  const cannot = mains.filter((o) => !has.has(o.key)).map((o) => o.label);
  return { can, cannot };
}

// Everything the "Your access" page shows. `admin`: the viewer runs the school (history and
// the change log are theirs to see).
async function accessPage(db, { organizationId, userId, admin = false, allowedFeatures = null }) {
  const { rows: [user] } = await db.query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, u.account_type::text AS role, COALESCE(u.on_hold, FALSE) AS on_hold, o.organization_name
       FROM users u JOIN organizations o ON o.organization_id = u.organization_id
      WHERE u.user_id = $1 AND u.organization_id = $2 AND u.removed_at IS NULL`,
    [userId, organizationId]
  );
  if (!user) return null;
  const assistant = await require("./mainTeacher").assistantReady(db);
  const [classes, subjects, saved] = await Promise.all([
    db.query(
      `SELECT c.class_id, c.class_name, COALESCE(uc.main, FALSE) AS main, ${assistant ? "COALESCE(uc.assistant, FALSE)" : "FALSE"} AS assistant
         FROM user_classes uc JOIN classes c ON c.class_id = uc.class_id AND c.organization_id = $2 AND c.obsolete_at IS NULL
        WHERE uc.user_id = $1 ORDER BY c.class_name`,
      [userId, organizationId]
    ),
    db.query(
      `SELECT s.subject_name, s.class_id FROM user_subjects us JOIN subjects s ON s.subject_id = us.subject_id AND s.organization_id = $2
        WHERE us.user_id = $1 AND s.obsolete_at IS NULL ORDER BY s.subject_name`,
      [userId, organizationId]
    ),
    perms.getUserPermissions(db, userId, organizationId).catch(() => []),
  ]);
  const held = perms.effectivePermissionsForRole(user.role, saved);
  const available = new Set(perms.permissionOptionsFor({ organizationId, allowedFeatures }).map((o) => o.key));
  const bySubject = new Map();
  subjects.rows.forEach((s) => { if (!bySubject.has(s.class_id)) bySubject.set(s.class_id, []); bySubject.get(s.class_id).push(s.subject_name); });
  const ready = await on(db, organizationId);
  const [history, changes] = ready ? await Promise.all([
    db.query(
      `SELECT kind, value, detail, start_date, end_date, active, source_system, recorded_at FROM staff_role_history
        WHERE organization_id = $1 AND (user_id = $2 OR (user_id IS NULL AND LOWER(email) = LOWER($3)))
        ORDER BY CASE kind WHEN 'mapped' THEN 0 WHEN 'role' THEN 1 WHEN 'school' THEN 2 ELSE 3 END, start_date NULLS LAST, value`,
      [organizationId, userId, user.email]
    ).then((r) => r.rows),
    admin ? db.query("SELECT changed_by, what, old_value, new_value, at FROM staff_role_changes WHERE organization_id = $1 AND user_id = $2 ORDER BY at DESC LIMIT 100", [organizationId, userId]).then((r) => r.rows) : [],
  ]) : [[], []];
  const labelOf = new Map(PERMISSION_OPTIONS.map((o) => [o.key, o.label]));
  changes.forEach((c) => {
    if (c.what !== "permissions") return;
    c.old_value = Array.isArray(c.old_value) ? c.old_value.map((k) => labelOf.get(k) || k) : c.old_value;
    c.new_value = Array.isArray(c.new_value) ? c.new_value.map((k) => labelOf.get(k) || k) : c.new_value;
  });
  const mapped = history.find((h) => h.kind === "mapped");
  const roleName = { Manager: "Manager", Supervisor: "Supervisor", Teacher: "Teacher", Driver: "Driver" }[user.role] || user.role;
  // One of the school's own roles (utils/schoolRoles.js) shows by its name.
  const ownRole = (await require("./schoolRoles").namesByUser(db, organizationId).catch(() => new Map())).get(Number(user.user_id));
  return {
    user,
    role: ownRole ? `${ownRole} (${roleName} account)`
      : mapped && mapped.detail && mapped.detail.accountType && mapped.value && mapped.value !== roleName ? `${mapped.value} (${roleName} account)` : roleName,
    classes: classes.rows.map((c) => ({
      name: c.class_name,
      as: c.main ? "Main teacher" : c.assistant ? "Assistant teacher" : null,
      subjects: c.main || c.assistant ? ["Every subject"] : bySubject.get(c.class_id) || [],
    })),
    allClasses: !["Teacher", "Driver"].includes(user.role),
    ...abilities(held, available, user.role),
    history: history.filter((h) => h.kind !== "mapped"),
    mapped: mapped || null,
    changes,
  };
}

// Imported staff see "Your access" the first time they open Managira (once).
async function firstVisitDue(db, req) {
  const s = req.session || {};
  const userId = Number(s.userId || (s.user && s.user.user_id));
  if (!userId || String(s.accountType || "").toLowerCase() === "organization" || !(await on(db, s.organizationId))) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM staff_role_history h WHERE h.organization_id = $1 AND h.user_id = $2
        AND NOT EXISTS (SELECT 1 FROM staff_access_seen x WHERE x.user_id = $2) LIMIT 1`,
    [s.organizationId, userId]
  );
  return rows.length > 0;
}
const markSeen = (db, organizationId, userId) => db.query(
  "INSERT INTO staff_access_seen (user_id, organization_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, organizationId]
).catch(() => {});

module.exports = { ready, on, snapshot, logChanges, abilities, accessPage, firstVisitDue, markSeen };
