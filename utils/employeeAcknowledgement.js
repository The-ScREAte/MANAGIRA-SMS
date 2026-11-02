// The confirmation a school manager gives when adding or changing a staff
// member's access ("I'm adding this person and giving them these permissions").
// Every confirmation is kept, with who gave it, when, the role and the
// permissions, and also written to the school's activity log.
const db = require("../config/db");
const { logOrganizationActivity } = require("./activityLog");

const ACK_VERSION = "2026-11-01";
const ACK_FIELD = "accessAcknowledged";

let schemaPromise = null;
function ensureSchema(database = db) {
  if (!schemaPromise) {
    schemaPromise = database.query(`
      CREATE TABLE IF NOT EXISTS employee_access_acknowledgements (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL,
        employee_user_id INTEGER NOT NULL,
        action VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update')),
        account_type VARCHAR(40),
        permissions TEXT[] NOT NULL DEFAULT '{}',
        acknowledged_by INTEGER,
        acknowledged_name VARCHAR(255),
        version VARCHAR(20) NOT NULL,
        ip_address VARCHAR(45),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`).then(() => database.query(
      `CREATE INDEX IF NOT EXISTS idx_employee_access_ack_org ON employee_access_acknowledgements (organization_id, employee_user_id, created_at DESC)`
    )).catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

const isAcknowledged = (body) => {
  const v = body && body[ACK_FIELD];
  return v === "yes" || v === "true" || v === true || v === "on";
};

async function record(req, { organizationId, employeeUserId, action, accountType, permissions, employeeName }) {
  try {
    await ensureSchema();
    const s = req.session || {};
    const u = s.user || {};
    const byId = Number(s.userId || u.user_id) || null;
    const byName = [s.firstName || u.first_name, s.lastName || u.last_name].filter(Boolean).join(" ") || "Organization";
    const perms = Array.isArray(permissions) ? permissions.map(String) : [];
    await db.query(
      `INSERT INTO employee_access_acknowledgements
         (organization_id, employee_user_id, action, account_type, permissions, acknowledged_by, acknowledged_name, version, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [organizationId, employeeUserId, action, accountType || null, perms, byId, byName, ACK_VERSION, req.ip || null]
    );
    await logOrganizationActivity({
      organizationId,
      userId: byId,
      userName: byName,
      userRole: s.userRole || s.accountType || null,
      actionType: "Confirmed",
      moduleName: "Users / Employees",
      pagePath: req.originalUrl,
      recordType: "Staff access",
      recordId: String(employeeUserId),
      recordLabel: employeeName || null,
      description: `${byName} confirmed ${action === "create" ? "adding" : "the access of"} ${employeeName || "this staff member"} as ${accountType || "staff"}${perms.length ? ` with: ${perms.join(", ")}` : " with no extra permissions"}.`,
      ipAddress: req.ip || null,
    }).catch(() => {});
  } catch (error) {
    console.error("[employeeAcknowledgement]", error.message);
  }
}

module.exports = { ACK_VERSION, ACK_FIELD, isAcknowledged, record, ensureSchema };
