const { BoundedMap } = require("./boundedMap");
// API access for third-party integrations: service accounts (the "user" an
// integration acts as), personal access tokens (PATs) tied to a service
// account, and the school's client secrets.
//
// An integration exchanges client_id + client_secret + PAT for a short-lived
// access token (POST /api/v1/auth/token) and calls /api/v1/* with it. Every
// call re-checks that the PAT, the secret and the service account are still
// active and unexpired, so revoking any one of them stops access at once.
//
// Credentials are random 32-byte values shown once; only their SHA-256 hash is
// stored (enough for high-entropy secrets, and lookups stay a single index hit).
const crypto = require("crypto");
const db = require("../config/db");
const { logOrganizationActivity } = require("./activityLog");

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const TOKEN_EXPIRY_DAYS = [30, 90, 180, 365];
const SECRET_EXPIRY_DAYS = [90, 180, 365, 730];

// The data-sharing terms a school accepts for each service account (shown in
// views/partials/apiDataAgreement.ejs). Changing the text means a new version.
const AGREEMENT_VERSION = "2026-11-01";

// What an integration can be allowed to read, one area at a time. A service
// account is given areas; a token picks from its account's areas. PayGira and
// Transportation only count while the school uses them.
const API_AREAS = [
  { key: "students", label: "Students", scope: "students.read", description: "Names, student numbers, gender, class and status." },
  { key: "classes", label: "Classes & subjects", scope: "classes.read", description: "Classes, subjects, school years and terms." },
  { key: "guardians", label: "Parents & guardians", scope: "guardians.read", description: "Parent names, phone numbers, emails and their children." },
  { key: "attendance", label: "Attendance", scope: "attendance.read", description: "Daily attendance marks by class." },
  { key: "grades", label: "Grades", scope: "grades.read", description: "Assessment scores, percentages, grades and positions." },
  { key: "staff", label: "Staff", scope: "staff.read", description: "Staff names, roles and email addresses." },
  { key: "calendar", label: "Events & announcements", scope: "calendar.read", description: "School events and announcements." },
  { key: "paygira", label: "PayGira", scope: "paygira.read", description: "Bills, balances owed and payments received.", feature: "paygira" },
  { key: "transport", label: "Transportation", scope: "transport.read", description: "Buses, routes, stops and which stop each student uses.", feature: "transport" },
  // Sending information in: each is its own area, never part of an account's reading areas.
  { key: "students_write", label: "Students: add and update", scope: "students.write", description: "Add students to a class and change their names, birthdays, emails and student numbers.", write: true },
  { key: "guardians_write", label: "Parents & guardians: add and update", scope: "guardians.write", description: "Add parents, link them to their children and change their contact details.", write: true },
  { key: "attendance_write", label: "Attendance: mark", scope: "attendance.write", description: "Mark students present or absent for a day.", write: true },
  { key: "grades_write", label: "Grades: enter scores", scope: "grades.write", description: "Enter scores for assessments. Where teachers approve grades, families see them once the teacher posts them.", write: true },
  { key: "paygira_write", label: "PayGira: record payments", scope: "paygira.write", description: "Record payments taken outside Managira against a student's bill.", feature: "paygira", write: true },
];
const FEATURE_LABELS = { paygira: "PayGira", transport: "Transportation" };
const BASE_SCOPES = ["managira.api.access", "tenant.read"];
const ALL_PERMISSION_KEYS = API_AREAS.map((area) => area.key);
const READ_AREA_KEYS = API_AREAS.filter((area) => !area.write).map((area) => area.key);
// Kept for older callers and the guide.
const API_PERMISSIONS = API_AREAS;
const SCOPE_GROUPS = API_AREAS.map((area) => ({ key: area.key, label: area.label, scopes: [...BASE_SCOPES, area.scope] }));

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const newCredential = (prefix) => `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
const hintOf = (value) => String(value).slice(-4);
const clean = (value, max = 120) => String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// Which optional parts of Managira the school uses, kept for a minute.
const featureCache = new BoundedMap(1000);
async function schoolFeatures(organizationId) {
  const cached = featureCache.get(organizationId);
  if (cached && cached.at > Date.now() - 60 * 1000) return cached.value;
  const [paygira, transport] = await Promise.all([
    (async () => {
      // The school's plan (or its hub's) includes PayGira, or it already bills through it.
      const plan = await require("./accessCache").resolvePlanForOrganization(db, organizationId).catch(() => null);
      const { rows } = await db.query(
        `SELECT EXISTS (
           SELECT 1 FROM plan_features pf JOIN features f ON f.id = pf.feature_id
            WHERE pf.plan_id = $2
              AND LOWER(TRIM(f.feature_name)) IN ('paygira', 'pay gira', 'paygira & payments', 'paygira and payments')
         ) OR EXISTS (SELECT 1 FROM finance_bills WHERE organization_id = $1) AS enabled`,
        [organizationId, plan && plan.planId ? plan.planId : null]
      );
      return Boolean(rows[0] && rows[0].enabled);
    })().catch(() => false),
    require("./transportation").getTransportationIntegrationStatus(db, organizationId)
      .then((status) => Boolean(status && status.activated)).catch(() => false),
  ]);
  const value = { paygira, transport };
  featureCache.set(organizationId, { at: Date.now(), value });
  return value;
}

// Each area for a service account: can a token use it, and if not, why.
function groupAvailability(permissions, features = {}) {
  const granted = new Set(permissions || []);
  return API_AREAS.map((area) => {
    const featureOn = !area.feature || Boolean(features[area.feature]);
    const allowed = granted.has(area.key);
    return {
      key: area.key,
      label: area.label,
      description: area.description,
      write: Boolean(area.write),
      scopes: [...BASE_SCOPES, area.scope],
      available: allowed && featureOn,
      featureOff: !featureOn,
      missing: allowed ? [] : [area.label],
      reason: !featureOn ? `${FEATURE_LABELS[area.feature]} isn't turned on for this school.` : (!allowed ? "Its service account doesn't have this permission." : ""),
    };
  });
}

// The scopes a token actually has right now: its areas, cut down to what its
// service account allows and what the school has turned on.
function effectiveScopes(areaKeys, permissions, features = {}) {
  const wanted = new Set(areaKeys || []);
  const areas = groupAvailability(permissions, features).filter((area) => area.available && wanted.has(area.key));
  if (!areas.length) return [];
  return [...new Set([...BASE_SCOPES, ...areas.map((area) => API_AREAS.find((a) => a.key === area.key).scope)])].sort();
}

// Scopes a service account's permissions allow (features aside).
function allowedScopesFor(permissions) {
  return effectiveScopes(ALL_PERMISSION_KEYS, permissions, { paygira: true, transport: true });
}

// Only the areas saved on the account count, so areas added to Managira later
// never reach an integration that wasn't agreed for them.
const permissionsOf = (account) => (account.permissions || []).filter((key) => ALL_PERMISSION_KEYS.includes(key));

let schemaPromise = null;
function ensureApiAccessSchema(database = db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await database.query(`
        CREATE TABLE IF NOT EXISTS api_service_accounts (
          service_account_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          name VARCHAR(120) NOT NULL,
          description VARCHAR(255) NOT NULL DEFAULT '',
          all_permissions BOOLEAN NOT NULL DEFAULT FALSE,
          permissions TEXT[] NOT NULL DEFAULT '{}',
          status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ,
          revoked_by INTEGER
        )`);
      // The first version had an "Application" field (removed before any use).
      await database.query(`ALTER TABLE api_service_accounts ADD COLUMN IF NOT EXISTS description VARCHAR(255) NOT NULL DEFAULT ''`);
      await database.query(`ALTER TABLE api_service_accounts DROP COLUMN IF EXISTS application`);
      // The data-sharing agreement accepted for the account (latest acceptance).
      await database.query(`ALTER TABLE api_service_accounts
        ADD COLUMN IF NOT EXISTS agreement_version VARCHAR(20),
        ADD COLUMN IF NOT EXISTS agreement_accepted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS agreement_accepted_by INTEGER,
        ADD COLUMN IF NOT EXISTS agreement_accepted_name VARCHAR(255)`);
      // Service accounts can be put on hold (paused) and turned back on.
      await database.query(`ALTER TABLE api_service_accounts
        ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS held_by INTEGER`);
      await database.query(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_service_accounts_status_check'
                          AND pg_get_constraintdef(oid) LIKE '%on_hold%') THEN
            ALTER TABLE api_service_accounts DROP CONSTRAINT IF EXISTS api_service_accounts_status_check;
            ALTER TABLE api_service_accounts ADD CONSTRAINT api_service_accounts_status_check
              CHECK (status IN ('active', 'on_hold', 'revoked'));
          END IF;
        END $$`);
      // Names stay unique among accounts that can come back (active or on hold).
      await database.query(`DROP INDEX IF EXISTS ux_api_service_accounts_org_name`);
      await database.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_api_service_accounts_org_live_name
        ON api_service_accounts (organization_id, LOWER(name)) WHERE status <> 'revoked'`);
      await database.query(`
        CREATE TABLE IF NOT EXISTS api_personal_access_tokens (
          token_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          service_account_id INTEGER NOT NULL REFERENCES api_service_accounts(service_account_id) ON DELETE CASCADE,
          name VARCHAR(120) NOT NULL,
          scope_groups TEXT[] NOT NULL,
          token_hash CHAR(64) NOT NULL UNIQUE,
          token_hint VARCHAR(8) NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          last_used_at TIMESTAMPTZ,
          status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ,
          revoked_by INTEGER
        )`);
      await database.query(`CREATE INDEX IF NOT EXISTS idx_api_pats_org ON api_personal_access_tokens (organization_id, created_at DESC)`);
      await database.query(`
        CREATE TABLE IF NOT EXISTS api_clients (
          organization_id INTEGER PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
          client_id UUID NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await database.query(`
        CREATE TABLE IF NOT EXISTS api_client_secrets (
          secret_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          description VARCHAR(255) NOT NULL DEFAULT '',
          secret_hash CHAR(64) NOT NULL UNIQUE,
          secret_hint VARCHAR(8) NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          last_used_at TIMESTAMPTZ,
          status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ,
          revoked_by INTEGER
        )`);
      await database.query(`CREATE INDEX IF NOT EXISTS idx_api_client_secrets_org ON api_client_secrets (organization_id, created_at DESC)`);
      await database.query(`
        CREATE TABLE IF NOT EXISTS api_access_tokens (
          access_id SERIAL PRIMARY KEY,
          organization_id INTEGER NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
          token_id INTEGER NOT NULL REFERENCES api_personal_access_tokens(token_id) ON DELETE CASCADE,
          secret_id INTEGER NOT NULL REFERENCES api_client_secrets(secret_id) ON DELETE CASCADE,
          access_hash CHAR(64) NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await database.query(`CREATE INDEX IF NOT EXISTS idx_api_access_tokens_expiry ON api_access_tokens (expires_at)`);
      // Change times and deletion records for incremental sync.
      await require("./apiChangeTracking").ensureChangeTracking(database);
    })().catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

// Who did it, for the activity log.
function actorOf(req) {
  const session = req.session || {};
  const user = session.user || {};
  return {
    userId: Number(session.userId || user.user_id) || null,
    userName: [session.firstName || user.first_name, session.lastName || user.last_name].filter(Boolean).join(" ") || "Organization",
    userRole: session.userRole || session.accountType || user.account_type || null,
  };
}

function audit(req, organizationId, { action, recordType, recordId, label, description }) {
  const actor = req ? actorOf(req) : { userId: null, userName: "API integration", userRole: "Service account" };
  return logOrganizationActivity({
    organizationId,
    ...actor,
    actionType: action,
    moduleName: "API Access",
    pagePath: req ? req.originalUrl : "/api/v1",
    recordType,
    recordId: recordId == null ? null : String(recordId),
    recordLabel: label,
    description,
    ipAddress: req ? (req.ip || null) : null,
  }).catch(() => {}); // the log never blocks the action
}

// ---------- service accounts ----------
async function listServiceAccounts(organizationId) {
  await ensureApiAccessSchema();
  const { rows } = await db.query(
    `SELECT sa.*, (SELECT COUNT(*)::int FROM api_personal_access_tokens t
                    WHERE t.service_account_id = sa.service_account_id AND t.status = 'active' AND t.expires_at > NOW()) AS active_tokens
       FROM api_service_accounts sa
      WHERE sa.organization_id = $1
      ORDER BY (sa.status = 'active') DESC, LOWER(sa.name)`,
    [organizationId]
  );
  return rows;
}

function readPermissionInput(body) {
  const all = String(body.permissionMode || "all") === "all";
  const valid = new Set(ALL_PERMISSION_KEYS);
  const picked = [].concat(body.permissions || []).map(String).filter((key) => valid.has(key));
  // "Every area" is every area to read; sending information in is always ticked one by one.
  const writes = [...new Set(picked)].filter((key) => (API_AREAS.find((area) => area.key === key) || {}).write);
  return { all, permissions: all ? [...READ_AREA_KEYS, ...writes] : [...new Set(picked)] };
}

// Every save needs the school's acceptance of the data-sharing agreement.
function requireAgreement(body) {
  if (body.agreement !== true && body.agreement !== "true" && body.agreement !== "yes") {
    throw Object.assign(new Error("Accept the data-sharing agreement to continue."), { status: 400 });
  }
}
const areaSummary = (permissions) => (permissions.length
  ? API_AREAS.filter((a) => permissions.includes(a.key)).map((a) => a.label).join(", ")
  : "no areas");

async function createServiceAccount(req, organizationId, body) {
  await ensureApiAccessSchema();
  const name = clean(body.name);
  if (!name) throw Object.assign(new Error("Enter a name for the service account."), { status: 400 });
  requireAgreement(body);
  const description = clean(body.description, 255);
  const { all, permissions } = readPermissionInput(body);
  const actor = actorOf(req);
  try {
    const { rows } = await db.query(
      `INSERT INTO api_service_accounts (organization_id, name, description, all_permissions, permissions, created_by,
                                         agreement_version, agreement_accepted_at, agreement_accepted_by, agreement_accepted_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $6, $8) RETURNING *`,
      [organizationId, name, description, all, permissions, actor.userId, AGREEMENT_VERSION, actor.userName]
    );
    await audit(req, organizationId, { action: "Created", recordType: "Service account", recordId: rows[0].service_account_id, label: name, description: `Created service account "${name}" with access to ${areaSummary(permissions)}. ${actor.userName} accepted the data-sharing agreement (version ${AGREEMENT_VERSION}).` });
    return rows[0];
  } catch (error) {
    if (error.code === "23505") throw Object.assign(new Error("A service account with this name already exists."), { status: 409 });
    throw error;
  }
}

async function updateServiceAccount(req, organizationId, serviceAccountId, body) {
  await ensureApiAccessSchema();
  const name = clean(body.name);
  if (!name) throw Object.assign(new Error("Enter a name for the service account."), { status: 400 });
  requireAgreement(body);
  const { all, permissions } = readPermissionInput(body);
  const actor = actorOf(req);
  try {
    const { rows } = await db.query(
      `UPDATE api_service_accounts
          SET name = $3, description = $4, all_permissions = $5, permissions = $6, updated_at = NOW(),
              agreement_version = $7, agreement_accepted_at = NOW(), agreement_accepted_by = $8, agreement_accepted_name = $9
        WHERE organization_id = $1 AND service_account_id = $2 AND status IN ('active', 'on_hold')
        RETURNING *`,
      [organizationId, serviceAccountId, name, clean(body.description, 255), all, permissions, AGREEMENT_VERSION, actor.userId, actor.userName]
    );
    if (!rows[0]) throw Object.assign(new Error("Service account not found."), { status: 404 });
    await audit(req, organizationId, { action: "Updated", recordType: "Service account", recordId: serviceAccountId, label: name, description: `Updated service account "${name}": access to ${areaSummary(permissions)}. ${actor.userName} accepted the data-sharing agreement (version ${AGREEMENT_VERSION}).` });
    return rows[0];
  } catch (error) {
    if (error.code === "23505") throw Object.assign(new Error("A service account with this name already exists."), { status: 409 });
    throw error;
  }
}

async function revokeServiceAccount(req, organizationId, serviceAccountId) {
  await ensureApiAccessSchema();
  const actor = actorOf(req).userId;
  const { rows } = await db.query(
    `UPDATE api_service_accounts SET status = 'revoked', revoked_at = NOW(), revoked_by = $3, updated_at = NOW()
      WHERE organization_id = $1 AND service_account_id = $2 AND status IN ('active', 'on_hold') RETURNING name`,
    [organizationId, serviceAccountId, actor]
  );
  if (!rows[0]) throw Object.assign(new Error("Service account not found."), { status: 404 });
  // Its tokens stop working with it.
  await db.query(
    `UPDATE api_personal_access_tokens SET status = 'revoked', revoked_at = NOW(), revoked_by = $3
      WHERE organization_id = $1 AND service_account_id = $2 AND status = 'active'`,
    [organizationId, serviceAccountId, actor]
  );
  await audit(req, organizationId, { action: "Revoked", recordType: "Service account", recordId: serviceAccountId, label: rows[0].name, description: `Revoked service account "${rows[0].name}" and its access tokens.` });
}

// On hold: every call from its tokens is refused at once (the API only lets
// active service accounts through); turning it back on restores them.
async function holdServiceAccount(req, organizationId, serviceAccountId) {
  await ensureApiAccessSchema();
  const actor = actorOf(req);
  const { rows } = await db.query(
    `UPDATE api_service_accounts SET status = 'on_hold', held_at = NOW(), held_by = $3, updated_at = NOW()
      WHERE organization_id = $1 AND service_account_id = $2 AND status = 'active' RETURNING name`,
    [organizationId, serviceAccountId, actor.userId]
  );
  if (!rows[0]) throw Object.assign(new Error("Only an active service account can be put on hold."), { status: 404 });
  await audit(req, organizationId, { action: "On hold", recordType: "Service account", recordId: serviceAccountId, label: rows[0].name, description: `${actor.userName} put service account "${rows[0].name}" on hold. Its integrations can't reach Managira until it's turned back on.` });
}

async function resumeServiceAccount(req, organizationId, serviceAccountId) {
  await ensureApiAccessSchema();
  const actor = actorOf(req);
  try {
    const { rows } = await db.query(
      `UPDATE api_service_accounts SET status = 'active', held_at = NULL, held_by = NULL, updated_at = NOW()
        WHERE organization_id = $1 AND service_account_id = $2 AND status = 'on_hold' RETURNING name`,
      [organizationId, serviceAccountId]
    );
    if (!rows[0]) throw Object.assign(new Error("Only a service account on hold can be turned back on."), { status: 404 });
    await audit(req, organizationId, { action: "Turned on", recordType: "Service account", recordId: serviceAccountId, label: rows[0].name, description: `${actor.userName} turned service account "${rows[0].name}" back on.` });
  } catch (error) {
    if (error.code === "23505") throw Object.assign(new Error("Another service account already uses this name. Rename one first."), { status: 409 });
    throw error;
  }
}

// ---------- personal access tokens ----------
async function listTokens(organizationId) {
  await ensureApiAccessSchema();
  const { rows } = await db.query(
    `SELECT t.token_id, t.name, t.scope_groups, t.token_hint, t.expires_at, t.last_used_at, t.status, t.created_at,
            sa.name AS service_account_name, sa.status AS service_account_status, sa.all_permissions, sa.permissions
       FROM api_personal_access_tokens t
       JOIN api_service_accounts sa ON sa.service_account_id = t.service_account_id AND sa.organization_id = t.organization_id
      WHERE t.organization_id = $1
      ORDER BY (t.status = 'active' AND t.expires_at > NOW()) DESC, t.created_at DESC`,
    [organizationId]
  );
  return rows;
}

async function createToken(req, organizationId, body) {
  await ensureApiAccessSchema();
  const name = clean(body.name);
  if (!name) throw Object.assign(new Error("Enter a name for the token."), { status: 400 });
  const serviceAccountId = Number.parseInt(body.serviceAccountId, 10);
  const account = (await db.query(
    `SELECT * FROM api_service_accounts WHERE organization_id = $1 AND service_account_id = $2 AND status = 'active'`,
    [organizationId, serviceAccountId]
  )).rows[0];
  if (!account) throw Object.assign(new Error("Choose an active service account."), { status: 400 });
  if (!account.agreement_accepted_at) throw Object.assign(new Error("Accept the data-sharing agreement for this service account first (Management → Service accounts → Edit)."), { status: 400 });
  const wanted = [...new Set([].concat(body.scopeGroups || []).map(String))].slice(0, ALL_PERMISSION_KEYS.length);
  if (!wanted.length) throw Object.assign(new Error("Choose at least one scope."), { status: 400 });
  const availability = groupAvailability(permissionsOf(account), await schoolFeatures(organizationId));
  const blocked = wanted.map((key) => availability.find((group) => group.key === key) || { key }).filter((group) => !group.available);
  if (blocked.length) {
    // Say which it is: something the school has switched off, or something the account wasn't given.
    const switchedOff = blocked.find((group) => group.featureOff);
    throw Object.assign(new Error(switchedOff ? switchedOff.reason : "The service account's permissions don't allow one of the chosen scopes."), { status: 403 });
  }
  const days = TOKEN_EXPIRY_DAYS.includes(Number(body.expiresInDays)) ? Number(body.expiresInDays) : 365;
  const token = newCredential("mgr_pat");
  const { rows } = await db.query(
    `INSERT INTO api_personal_access_tokens (organization_id, service_account_id, name, scope_groups, token_hash, token_hint, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' days')::interval, $8)
     RETURNING token_id, expires_at`,
    [organizationId, account.service_account_id, name, wanted, sha256(token), hintOf(token), String(days), actorOf(req).userId]
  );
  await audit(req, organizationId, { action: "Created", recordType: "Access token", recordId: rows[0].token_id, label: name, description: `Created access token "${name}" for service account "${account.name}".` });
  return { token, tokenId: rows[0].token_id, expiresAt: rows[0].expires_at };
}

async function revokeToken(req, organizationId, tokenId) {
  await ensureApiAccessSchema();
  const { rows } = await db.query(
    `UPDATE api_personal_access_tokens SET status = 'revoked', revoked_at = NOW(), revoked_by = $3
      WHERE organization_id = $1 AND token_id = $2 AND status = 'active' RETURNING name`,
    [organizationId, tokenId, actorOf(req).userId]
  );
  if (!rows[0]) throw Object.assign(new Error("Token not found."), { status: 404 });
  await audit(req, organizationId, { action: "Revoked", recordType: "Access token", recordId: tokenId, label: rows[0].name, description: `Revoked access token "${rows[0].name}".` });
}

// ---------- client secrets ----------
async function getClientId(organizationId) {
  await ensureApiAccessSchema();
  await db.query(
    `INSERT INTO api_clients (organization_id, client_id) VALUES ($1, $2) ON CONFLICT (organization_id) DO NOTHING`,
    [organizationId, crypto.randomUUID()]
  );
  return (await db.query(`SELECT client_id FROM api_clients WHERE organization_id = $1`, [organizationId])).rows[0].client_id;
}

async function listSecrets(organizationId) {
  await ensureApiAccessSchema();
  const { rows } = await db.query(
    `SELECT secret_id, description, secret_hint, expires_at, last_used_at, status, created_at
       FROM api_client_secrets WHERE organization_id = $1
      ORDER BY (status = 'active' AND expires_at > NOW()) DESC, created_at DESC`,
    [organizationId]
  );
  return rows;
}

async function createSecret(req, organizationId, body, { replacing } = {}) {
  await ensureApiAccessSchema();
  const description = clean(body.description, 255);
  const days = SECRET_EXPIRY_DAYS.includes(Number(body.expiresInDays)) ? Number(body.expiresInDays) : 365;
  const secret = newCredential("mgr_cs");
  const { rows } = await db.query(
    `INSERT INTO api_client_secrets (organization_id, description, secret_hash, secret_hint, expires_at, created_by)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval, $6) RETURNING secret_id, expires_at`,
    [organizationId, description, sha256(secret), hintOf(secret), String(days), actorOf(req).userId]
  );
  await audit(req, organizationId, { action: "Created", recordType: "Client secret", recordId: rows[0].secret_id, label: description || `…${hintOf(secret)}`, description: replacing ? `Regenerated client secret (replaces …${replacing}).` : "Created a client secret." });
  return { secret, secretId: rows[0].secret_id, expiresAt: rows[0].expires_at, clientId: await getClientId(organizationId) };
}

async function revokeSecret(req, organizationId, secretId) {
  await ensureApiAccessSchema();
  const { rows } = await db.query(
    `UPDATE api_client_secrets SET status = 'revoked', revoked_at = NOW(), revoked_by = $3
      WHERE organization_id = $1 AND secret_id = $2 AND status = 'active' RETURNING description, secret_hint`,
    [organizationId, secretId, actorOf(req).userId]
  );
  if (!rows[0]) throw Object.assign(new Error("Client secret not found."), { status: 404 });
  await audit(req, organizationId, { action: "Revoked", recordType: "Client secret", recordId: secretId, label: rows[0].description || `…${rows[0].secret_hint}`, description: "Revoked a client secret." });
  return rows[0];
}

// A new secret with the same description, and the old one revoked.
async function regenerateSecret(req, organizationId, secretId) {
  const old = await revokeSecret(req, organizationId, secretId);
  return createSecret(req, organizationId, { description: old.description }, { replacing: old.secret_hint });
}

// ---------- the API side ----------
// client_id + client_secret + PAT -> a one-hour access token.
async function exchangeToken({ clientId, clientSecret, personalAccessToken, ip }) {
  await ensureApiAccessSchema();
  if (!clientId || !clientSecret || !personalAccessToken) return null;
  const { rows } = await db.query(
    `SELECT c.organization_id, s.secret_id, t.token_id, t.name AS token_name, t.scope_groups,
            sa.service_account_id, sa.name AS service_account_name, sa.all_permissions, sa.permissions
       FROM api_clients c
       JOIN api_client_secrets s ON s.organization_id = c.organization_id AND s.secret_hash = $2
                                AND s.status = 'active' AND s.expires_at > NOW()
       JOIN api_personal_access_tokens t ON t.organization_id = c.organization_id AND t.token_hash = $3
                                        AND t.status = 'active' AND t.expires_at > NOW()
       JOIN api_service_accounts sa ON sa.service_account_id = t.service_account_id
                                   AND sa.organization_id = c.organization_id AND sa.status = 'active'
      WHERE c.client_id::text = $1`,
    [String(clientId), sha256(clientSecret), sha256(personalAccessToken)]
  );
  const match = rows[0];
  if (!match) return null;
  const scopes = effectiveScopes(match.scope_groups, permissionsOf(match), await schoolFeatures(match.organization_id));
  if (!scopes.length) return null; // nothing it may read any more
  const accessToken = newCredential("mgr_at");
  await db.query(
    `INSERT INTO api_access_tokens (organization_id, token_id, secret_id, access_hash, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' seconds')::interval)`,
    [match.organization_id, match.token_id, match.secret_id, sha256(accessToken), String(ACCESS_TOKEN_TTL_SECONDS)]
  );
  await db.query(`UPDATE api_personal_access_tokens SET last_used_at = NOW() WHERE token_id = $1`, [match.token_id]);
  await db.query(`UPDATE api_client_secrets SET last_used_at = NOW() WHERE secret_id = $1`, [match.secret_id]);
  db.query(`DELETE FROM api_access_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`).catch(() => {});
  await logOrganizationActivity({
    organizationId: match.organization_id,
    userName: `API: ${match.service_account_name}`.slice(0, 255),
    userRole: "Service account",
    actionType: "Used",
    moduleName: "API Access",
    pagePath: "/api/v1/auth/token",
    recordType: "Access token",
    recordId: String(match.token_id),
    recordLabel: match.token_name,
    description: `Access token "${match.token_name}" was used to sign in (service account "${match.service_account_name}").`,
    ipAddress: ip || null,
  }).catch(() => {});
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, scopes };
}

// Bearer access token -> who is calling and what they may do, or null.
async function verifyAccessToken(accessToken) {
  await ensureApiAccessSchema();
  if (!accessToken || !String(accessToken).startsWith("mgr_at_")) return null;
  const { rows } = await db.query(
    `SELECT a.organization_id, a.token_id, t.scope_groups, t.last_used_at,
            sa.service_account_id, sa.name AS service_account_name, sa.all_permissions, sa.permissions
       FROM api_access_tokens a
       JOIN api_personal_access_tokens t ON t.token_id = a.token_id AND t.organization_id = a.organization_id
                                        AND t.status = 'active' AND t.expires_at > NOW()
       JOIN api_client_secrets s ON s.secret_id = a.secret_id AND s.organization_id = a.organization_id
                                AND s.status = 'active' AND s.expires_at > NOW()
       JOIN api_service_accounts sa ON sa.service_account_id = t.service_account_id
                                   AND sa.organization_id = a.organization_id AND sa.status = 'active'
      WHERE a.access_hash = $1 AND a.expires_at > NOW()`,
    [sha256(accessToken)]
  );
  const match = rows[0];
  if (!match) return null;
  // Last use is kept to the minute, so busy integrations don't write on every call.
  if (!match.last_used_at || Date.now() - new Date(match.last_used_at).getTime() > 60 * 1000) {
    db.query(`UPDATE api_personal_access_tokens SET last_used_at = NOW() WHERE token_id = $1`, [match.token_id]).catch(() => {});
  }
  return {
    organizationId: match.organization_id,
    tokenId: match.token_id,
    serviceAccount: { id: match.service_account_id, name: match.service_account_name },
    scopes: effectiveScopes(match.scope_groups, permissionsOf(match), await schoolFeatures(match.organization_id)),
  };
}

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  TOKEN_EXPIRY_DAYS,
  SECRET_EXPIRY_DAYS,
  AGREEMENT_VERSION,
  API_AREAS,
  API_PERMISSIONS,
  SCOPE_GROUPS,
  BASE_SCOPES,
  ALL_PERMISSION_KEYS,
  sha256,
  newCredential,
  allowedScopesFor,
  groupAvailability,
  effectiveScopes,
  permissionsOf,
  schoolFeatures,
  ensureApiAccessSchema,
  listServiceAccounts,
  createServiceAccount,
  updateServiceAccount,
  revokeServiceAccount,
  holdServiceAccount,
  resumeServiceAccount,
  listTokens,
  createToken,
  revokeToken,
  getClientId,
  listSecrets,
  createSecret,
  revokeSecret,
  regenerateSecret,
  exchangeToken,
  verifyAccessToken,
};
