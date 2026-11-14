"use strict";
// A school's own staff roles (feature school_roles): beside the built-in Manager, Supervisor,
// Teacher and Driver, a school adds its own ("Food Service", "Office Clerk") from the staff form.
// A role is a name, the built-in role it's based on (the account type the person gets) and the
// permissions it gives. Choosing it on the staff form ticks those permissions (still changeable
// for one person); the person shows the role's name. Nobody can make a role that gives more than
// they could give a person themselves.
const BASE_TYPES = ["Manager", "Supervisor", "Teacher", "Driver"];
const BUILT_IN = new Set(BASE_TYPES.map((t) => t.toLowerCase()));

let readyAt = 0;
let isReady = false;
async function ready(db) {
  if (isReady || Date.now() - readyAt < 60000) return isReady;
  let r;
  try {
    ({ rows: [r] } = await db.query(
      "SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'school_roles')::int + (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'school_role_id')::int AS n"
    ));
  } catch (error) {
    return isReady; // a busy database: asked again next time
  }
  readyAt = Date.now();
  isReady = Number(r.n) === 2;
  return isReady;
}
const on = (organizationId) => require("./shards/features").isOn("school_roles", { organizationId: Number(organizationId) || null });

async function list(db, organizationId) {
  if (!on(organizationId) || !(await ready(db))) return [];
  const { rows } = await db.query(
    `SELECT r.role_id, r.name, r.base_type, r.permissions, (SELECT COUNT(*) FROM users u WHERE u.school_role_id = r.role_id AND u.organization_id = r.organization_id)::int AS people
       FROM school_roles r WHERE r.organization_id = $1 AND r.archived_at IS NULL ORDER BY LOWER(r.name)`,
    [organizationId]
  );
  return rows;
}
async function byId(db, organizationId, roleId) {
  if (!(await ready(db))) return null;
  const { rows: [row] } = await db.query("SELECT * FROM school_roles WHERE organization_id = $1 AND role_id = $2 AND archived_at IS NULL", [organizationId, Number(roleId) || 0]);
  return row || null;
}

// A new role. `allowed`: the permission keys this school's plan offers; `highRisk`: whether the
// person making it may give high-risk permissions (and base a role on Manager).
async function create(db, organizationId, input, { userId = null, allowed = null, highRisk = false, transportOn = true } = {}) {
  if (!on(organizationId) || !(await ready(db))) return { error: "Roles aren't available yet." };
  const name = String(input.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (name.length < 2) return { error: "Give the role a name." };
  if (BUILT_IN.has(name.toLowerCase())) return { error: `${name} is already one of Managira's roles.` };
  const baseType = BASE_TYPES.includes(input.baseType) ? input.baseType : "Teacher";
  if (baseType === "Manager" && !highRisk) return { error: "Only a manager can make a role based on Manager." };
  if (baseType === "Driver" && !transportOn) return { error: "Turn transportation on first to make a driver role." };
  // The permissions ticked when it was made, or the built-in role's own.
  const asked = input.permissions == null ? defaultsFor(baseType, organizationId) : input.permissions;
  const permissions = keep(asked, { allowed, highRisk });
  try {
    const { rows: [role] } = await db.query(
      "INSERT INTO school_roles (organization_id, name, base_type, permissions, created_by) VALUES ($1, $2, $3, $4::text[], $5) RETURNING role_id, name, base_type, permissions",
      [organizationId, name, baseType, permissions, userId]
    );
    return { ok: true, role: { ...role, people: 0 } };
  } catch (error) {
    if (error.code === "23505") return { error: `There's already a role called ${name}.` };
    throw error;
  }
}
async function update(db, organizationId, roleId, input, { allowed = null, highRisk = false } = {}) {
  const role = await byId(db, organizationId, roleId);
  if (!role) return { error: "That role isn't there." };
  if (role.base_type === "Manager" && !highRisk) return { error: "Only a manager can change a role based on Manager." };
  const permissions = keep(input.permissions || [], { allowed, highRisk });
  // What this person can't give stays as it was (a high-risk permission someone else put there).
  const kept = (role.permissions || []).filter((key) => !keep([key], { allowed, highRisk }).length);
  const all = [...new Set([...permissions, ...kept])];
  await db.query("UPDATE school_roles SET permissions = $3::text[], updated_at = NOW() WHERE organization_id = $1 AND role_id = $2", [organizationId, role.role_id, all]);
  return { ok: true, role: { role_id: role.role_id, name: role.name, base_type: role.base_type, permissions: all } };
}
async function archive(db, organizationId, roleId) {
  if (!(await ready(db))) return { error: "Roles aren't available yet." };
  const { rowCount } = await db.query("UPDATE school_roles SET archived_at = NOW(), updated_at = NOW() WHERE organization_id = $1 AND role_id = $2 AND archived_at IS NULL", [organizationId, Number(roleId) || 0]);
  if (rowCount) await db.query("UPDATE users SET school_role_id = NULL WHERE organization_id = $1 AND school_role_id = $2", [organizationId, Number(roleId) || 0]);
  return rowCount ? { ok: true } : { error: "That role isn't there." };
}

// The permissions a built-in role starts with (the same presets as the staff form).
function defaultsFor(baseType, organizationId) {
  const p = require("../middleware/permissionMiddleware");
  if (baseType === "Manager") return p.getSuggestedPermissionsForRole("Manager");
  if (baseType === "Driver") return p.mergePermissionsForRole("Driver", []);
  if (baseType === "Teacher") return p.rolePresetPermissions("Teacher", { questions: require("./assessmentApproval").flowOn(organizationId) });
  return p.rolePresetPermissions(baseType);
}
// Only permissions that exist, are in the school's plan and the person may give.
function keep(keys, { allowed = null, highRisk = false } = {}) {
  const { PERMISSION_OPTIONS } = require("../middleware/permissionMiddleware");
  const options = new Map(PERMISSION_OPTIONS.map((o) => [o.key, o]));
  return [...new Set([].concat(keys || []).map(String))].filter((key) => {
    const option = options.get(key);
    if (!option || option.retired) return false;
    if (allowed && !allowed.has(key)) return false;
    if (option.highRisk && !highRisk) return false;
    return true;
  });
}

// The staff form's role list: each role with only the permissions this page can tick.
async function forForm(db, organizationId, { available = null, canAssignHighRisk = false, transportOn = true, current = null } = {}) {
  const roles = await list(db, organizationId).catch(() => []);
  return {
    on: on(organizationId) && (await ready(db)),
    canAddManager: Boolean(canAssignHighRisk),
    canAddDriver: Boolean(transportOn),
    roles: roles
      .filter((r) => r.role_id === Number(current) || ((r.base_type !== "Manager" || canAssignHighRisk) && (r.base_type !== "Driver" || transportOn)))
      .map((r) => ({ id: r.role_id, name: r.name, base: r.base_type, people: r.people, permissions: (r.permissions || []).filter((k) => !available || available.has(k)) })),
  };
}
async function roleOf(db, organizationId, userId) {
  if (!(await ready(db))) return null;
  const { rows: [row] } = await db.query("SELECT school_role_id FROM users WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
  return row ? row.school_role_id : null;
}
// Names for the staff list: user id → the school role's name.
async function namesByUser(db, organizationId) {
  if (!on(organizationId) || !(await ready(db))) return new Map();
  const { rows } = await db.query(
    "SELECT u.user_id, r.name FROM users u JOIN school_roles r ON r.role_id = u.school_role_id AND r.organization_id = u.organization_id AND r.archived_at IS NULL WHERE u.organization_id = $1",
    [organizationId]
  );
  return new Map(rows.map((r) => [Number(r.user_id), r.name]));
}
// On a staff save: the chosen school role, only when it's this school's and based on the account
// type being saved (anything else: a built-in role, no school role). `client` may be a transaction.
async function assign(client, organizationId, userId, roleId, accountType) {
  const id = Number(roleId) || null;
  await client.query(
    `UPDATE users SET school_role_id = (SELECT role_id FROM school_roles WHERE organization_id = $2 AND role_id = $3 AND base_type = $4 AND archived_at IS NULL)
      WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId, id, String(accountType || "")]
  );
}

// JSON routes behind the staff form (Add Staff or Edit Staff & Access).
function handlers(db) {
  const p = require("../middleware/permissionMiddleware");
  const context = async (req, res) => {
    const organizationId = req.session.organizationId;
    const transport = await require("./transportation").getTransportationIntegrationStatus(db, organizationId).catch(() => null);
    const transportOn = Boolean(transport && transport.activated);
    const role = req.session.userRole || (req.session.user && req.session.user.account_type) || req.session.accountType;
    const highRisk = p.isManagerLikeRole(role) || String(role || "").trim() === "Manager";
    const allowed = new Set(p.permissionOptionsFor({ organizationId, allowedFeatures: res.locals.planFeaturesKnown ? res.locals.allowedFeatures : null, miraActivated: res.locals.miraActivated, transportActivated: transportOn }).map((o) => o.key));
    const userId = req.session.userId || (req.session.user && req.session.user.user_id) || null;
    return { organizationId, transportOn, highRisk, allowed, userId };
  };
  const answer = (res, result) => res.status(result.error ? 400 : 200).json(result);
  const failed = (res, error) => { console.error("[schoolRoles]", error.message); res.status(500).json({ error: "That didn't save. Try again." }); };
  return {
    create: async (req, res) => {
      try {
        const c = await context(req, res);
        const body = req.body || {};
        const result = await create(db, c.organizationId, { name: body.name, baseType: body.baseType, permissions: Array.isArray(body.permissions) ? body.permissions : null }, { userId: c.userId, allowed: c.allowed, highRisk: c.highRisk, transportOn: c.transportOn });
        if (result.role) result.role = { id: result.role.role_id, name: result.role.name, base: result.role.base_type, people: 0, permissions: result.role.permissions };
        answer(res, result);
      } catch (error) { failed(res, error); }
    },
    update: async (req, res) => {
      try {
        const c = await context(req, res);
        const result = await update(db, c.organizationId, req.params.roleId, { permissions: (req.body || {}).permissions }, { allowed: c.allowed, highRisk: c.highRisk });
        if (result.role) result.role = { id: result.role.role_id, name: result.role.name, base: result.role.base_type, permissions: result.role.permissions.filter((k) => c.allowed.has(k)) };
        answer(res, result);
      } catch (error) { failed(res, error); }
    },
    remove: async (req, res) => {
      try {
        const c = await context(req, res);
        const role = await byId(db, c.organizationId, req.params.roleId);
        if (role && role.base_type === "Manager" && !c.highRisk) return answer(res, { error: "Only a manager can remove a role based on Manager." });
        answer(res, await archive(db, c.organizationId, req.params.roleId));
      } catch (error) { failed(res, error); }
    },
  };
}

module.exports = { BASE_TYPES, ready, on, list, byId, create, update, archive, defaultsFor, keep, forForm, roleOf, namesByUser, assign, handlers };
