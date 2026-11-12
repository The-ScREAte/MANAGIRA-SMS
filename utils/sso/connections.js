"use strict";

// A school's single sign-on connection: reading it, saving it, and what can go wrong with
// what a manager typed. Everything else in SSO goes through here.
const crypto = require("crypto");
const features = require("../shards/features");
const { encryptSecret, decryptSecret, isSettingsEncryptionKeyConfigured } = require("../encryption");
const { checkedUrl } = require("../safeFetch");

const TABLE_MISSING = "42P01";

// What each provider supports, first choice first. Anything else is "other".
const PROVIDERS = {
  google: { name: "Google Workspace", protocols: ["saml", "oidc"] },
  microsoft: { name: "Microsoft Entra ID", protocols: ["saml", "oidc"] },
  okta: { name: "Okta", protocols: ["saml", "oidc"] },
  onelogin: { name: "OneLogin", protocols: ["saml", "oidc"] },
  classlink: { name: "ClassLink", protocols: ["saml", "oidc"] },
  clever: { name: "Clever", protocols: ["saml"] },
  jumpcloud: { name: "JumpCloud", protocols: ["saml", "oidc"] },
  ping: { name: "Ping Identity", protocols: ["saml", "oidc"] },
  auth0: { name: "Auth0", protocols: ["saml", "oidc"] },
  adfs: { name: "Microsoft AD FS", protocols: ["saml"] },
  shibboleth: { name: "Shibboleth", protocols: ["saml"] },
  other: { name: "Our own provider", protocols: ["saml", "oidc"] },
};

// How each kind of connection is named to the people signing in.
const PROTOCOL_NAMES = { saml: "SAML", oidc: "OpenID Connect" };

class SsoSetupError extends Error {}

const isOn = (organizationId) => features.isOn("sso", { organizationId });

function clean(value, max = 500) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, max);
}

// A certificate as the SAML library wants it: the block, with its own line breaks.
function readCertificate(text) {
  const body = String(text || "").replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  if (!body) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new SsoSetupError("That certificate doesn't look right. Paste it again, or use the metadata instead.");
  const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`;
  let certificate;
  try { certificate = new crypto.X509Certificate(pem); } catch (_error) { throw new SsoSetupError("That certificate doesn't look right. Paste it again, or use the metadata instead."); }
  if (new Date(certificate.validTo).getTime() < Date.now()) throw new SsoSetupError("That certificate has expired. Download a current one from your provider.");
  return pem;
}

function checkedAddress(value, label) {
  const text = clean(value, 2000);
  if (!text) return "";
  try { return checkedUrl(text).toString(); } catch (error) { throw new SsoSetupError(`${label}: ${error.message}`); }
}

// Microsoft's shared addresses let anyone with any Microsoft account through.
function checkedIssuer(value) {
  const issuer = checkedAddress(value, "Issuer").replace(/\/\.well-known\/openid-configuration\/?$/, "");
  if (/login\.microsoftonline\.com\/(common|organizations|consumers)(\/|$)/i.test(issuer)) {
    throw new SsoSetupError("Use the issuer address with your own Microsoft tenant ID in it, not the shared one.");
  }
  return issuer;
}

function readSettings(body, current) {
  const provider = PROVIDERS[body.provider] ? body.provider : (current && current.provider) || "other";
  const protocol = PROVIDERS[provider].protocols.includes(body.protocol) ? body.protocol : PROVIDERS[provider].protocols[0];
  const settings = {
    provider,
    protocol,
    displayName: clean(body.displayName, 80) || PROVIDERS[provider].name,
    allowStudents: body.allowStudents === true,
    requireSso: body.requireSso === true,
    emailAttribute: clean(body.emailAttribute, 200) || null,
  };
  if (protocol === "saml") {
    settings.samlEntityId = clean(body.samlEntityId, 1000);
    settings.samlSsoUrl = checkedAddress(body.samlSsoUrl, "Sign-in address");
    const given = Array.isArray(body.samlCertificates) ? body.samlCertificates : [body.samlCertificate];
    const certificates = given.map(readCertificate).filter(Boolean);
    settings.samlCertificates = certificates.length ? certificates : (current && current.protocol === "saml" ? current.saml_certificates || [] : []);
  } else {
    settings.oidcIssuer = checkedIssuer(body.oidcIssuer);
    settings.oidcClientId = clean(body.oidcClientId, 500);
    settings.oidcClientSecret = clean(body.oidcClientSecret, 2000);
  }
  return settings;
}

const isComplete = (row) => (row.protocol === "saml"
  ? Boolean(row.saml_entity_id && row.saml_sso_url && row.saml_certificates && row.saml_certificates.length)
  : Boolean(row.oidc_issuer && row.oidc_client_id && row.oidc_client_secret_locked));

async function connectionFor(db, organizationId) {
  try {
    const { rows } = await db.query("SELECT * FROM sso_connections WHERE organization_id = $1", [organizationId]);
    return rows[0] || null;
  } catch (error) {
    if (error.code === TABLE_MISSING) return null;
    throw error;
  }
}

async function connectionByPublicId(db, publicId) {
  if (!/^[a-f0-9]{24}$/.test(String(publicId || ""))) return null;
  try {
    const { rows } = await db.query("SELECT * FROM sso_connections WHERE public_id = $1", [publicId]);
    return rows[0] || null;
  } catch (error) {
    if (error.code === TABLE_MISSING) return null;
    throw error;
  }
}

// Saving a change takes the connection back to untested: what's on now must be what was tested.
async function saveSettings(db, organizationId, actorName, body) {
  const current = await connectionFor(db, organizationId);
  const settings = readSettings(body || {}, current);
  if (settings.oidcClientSecret && !isSettingsEncryptionKeyConfigured()) throw new SsoSetupError("This server can't store secrets safely yet. Contact Managira support.");
  const lockedSecret = settings.oidcClientSecret ? encryptSecret(settings.oidcClientSecret) : (current && current.protocol === "oidc" ? current.oidc_client_secret_locked : null);
  const same = (a, b) => String(a || "") === String(b || "");
  const signInChanged = !current
    || current.provider !== settings.provider
    || current.protocol !== settings.protocol
    || !same(current.email_attribute, settings.emailAttribute)
    || (settings.protocol === "saml"
      ? !same(current.saml_entity_id, settings.samlEntityId) || !same(current.saml_sso_url, settings.samlSsoUrl) || JSON.stringify(current.saml_certificates || []) !== JSON.stringify(settings.samlCertificates)
      : !same(current.oidc_issuer, settings.oidcIssuer) || !same(current.oidc_client_id, settings.oidcClientId) || Boolean(settings.oidcClientSecret));
  const status = signInChanged ? "draft" : current.status;
  const { rows } = await db.query(
    `INSERT INTO sso_connections (organization_id, public_id, provider, protocol, display_name, status, saml_entity_id, saml_sso_url, saml_certificates, email_attribute,
                                  oidc_issuer, oidc_client_id, oidc_client_secret_locked, allow_students, require_sso, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (organization_id) DO UPDATE SET
       provider = EXCLUDED.provider, protocol = EXCLUDED.protocol, display_name = EXCLUDED.display_name, status = EXCLUDED.status,
       saml_entity_id = EXCLUDED.saml_entity_id, saml_sso_url = EXCLUDED.saml_sso_url, saml_certificates = EXCLUDED.saml_certificates, email_attribute = EXCLUDED.email_attribute,
       oidc_issuer = EXCLUDED.oidc_issuer, oidc_client_id = EXCLUDED.oidc_client_id, oidc_client_secret_locked = EXCLUDED.oidc_client_secret_locked,
       allow_students = EXCLUDED.allow_students, require_sso = EXCLUDED.require_sso, updated_by = EXCLUDED.updated_by, updated_at = NOW(),
       tested_at = CASE WHEN $6 = 'draft' THEN NULL ELSE sso_connections.tested_at END,
       tested_email = CASE WHEN $6 = 'draft' THEN NULL ELSE sso_connections.tested_email END
     RETURNING *`,
    [
      organizationId, current ? current.public_id : crypto.randomBytes(12).toString("hex"), settings.provider, settings.protocol, settings.displayName, status,
      // Only the way in use is kept: a key left over from the other one must never count.
      settings.protocol === "saml" ? settings.samlEntityId : null,
      settings.protocol === "saml" ? settings.samlSsoUrl : null,
      settings.protocol === "saml" ? settings.samlCertificates : [],
      settings.emailAttribute,
      settings.protocol === "oidc" ? settings.oidcIssuer : null,
      settings.protocol === "oidc" ? settings.oidcClientId : null,
      settings.protocol === "oidc" ? lockedSecret : null, settings.allowStudents, settings.requireSso, actorName,
    ]
  );
  // A sign-in already under way was started with the old settings.
  if (current && signInChanged) await db.query("DELETE FROM sso_login_requests WHERE connection_id = $1", [current.connection_id]);
  return { row: rows[0], wentOff: Boolean(current && current.status === "active" && status === "draft") };
}

async function setStatus(db, organizationId, status, { byMain = false } = {}) {
  const { rows } = await db.query(
    "UPDATE sso_connections SET status = $2, updated_at = NOW(), turned_on_by_main = CASE WHEN $2 = 'active' THEN $3 ELSE FALSE END WHERE organization_id = $1 RETURNING *",
    [organizationId, status, byMain]
  );
  return rows[0] || null;
}

async function removeConnection(db, organizationId) {
  await db.query("DELETE FROM sso_connections WHERE organization_id = $1", [organizationId]);
}

const clientSecretOf = (row) => (row.oidc_client_secret_locked ? decryptSecret(row.oidc_client_secret_locked) : "");

async function record(db, { organizationId, kind, email, outcome, detail, ip }) {
  await db.query(
    "INSERT INTO sso_events (organization_id, kind, email, outcome, detail, ip_address) VALUES ($1, $2, $3, $4, $5, $6)",
    [organizationId, kind, email ? String(email).slice(0, 320) : null, outcome, detail ? String(detail).slice(0, 500) : null, ip || null]
  ).catch((error) => console.error("[SSO] couldn't record an attempt:", error.message));
}

// The one school this email signs in through, if any. A person is only ever sent to a school
// that has them, and from the main page only if no other school does: a school can add any
// email it likes to its own lists, and that must never bring someone else's people to its
// sign-in page. On a school's own address, only that school counts. Platform admins never.
async function connectionForEmail(db, email, { onlyOrganizationId = null } = {}) {
  const address = clean(email, 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) return null;
  try {
    const { rows } = await db.query(
      `WITH people AS (
         SELECT u.organization_id, u.account_type::text AS kind, u.removed_at FROM users u WHERE LOWER(u.email) = $1
         UNION ALL SELECT o.organization_id, 'Owner', NULL FROM organizations o WHERE LOWER(o.email) = $1
         UNION ALL SELECT sa.organization_id, 'Student', NULL FROM student_accounts sa WHERE LOWER(sa.login_email) = $1
         UNION ALL SELECT ga.organization_id, 'Guardian', NULL FROM guardian_accounts ga WHERE LOWER(ga.login_email) = $1
       )
       SELECT c.*
         FROM sso_connections c
        WHERE c.status = 'active'
          AND ($2::int IS NULL OR c.organization_id = $2)
          AND NOT EXISTS (SELECT 1 FROM people p WHERE p.kind IN ('Admin', 'Mini Admin', 'Internal Worker'))
          AND ($2::int IS NOT NULL OR NOT EXISTS (SELECT 1 FROM people p WHERE p.organization_id IS DISTINCT FROM c.organization_id))
          AND EXISTS (
            SELECT 1 FROM people p
             WHERE p.organization_id = c.organization_id AND p.removed_at IS NULL
               AND (p.kind NOT IN ('Student', 'Guardian') OR (p.kind = 'Student' AND c.allow_students))
          )
        LIMIT 1`,
      [address, onlyOrganizationId]
    );
    return rows[0] && isOn(rows[0].organization_id) ? rows[0] : null;
  } catch (error) {
    if (error.code === TABLE_MISSING) return null;
    throw error;
  }
}

// The school's owner: the signup account, or the manager's row with its email.
async function isMainManager(db, organizationId, person) {
  if (!person) return false;
  if (person.owner) return true;
  if (String(person.account_type || "").trim().toLowerCase() !== "manager") return false;
  const { getPrimaryManagerUserId } = require("../../middleware/permissionMiddleware");
  return Number(await getPrimaryManagerUserId(db, organizationId)) === Number(person.user_id);
}

// ---------- each person's own way in ----------
// Every member of staff signs in one way: their school's provider ("sso") or a Managira password
// ("password", also what an empty value means). users.sign_in_method holds it once
// 2026-11-21_sign_in_method.sql has run; until then the school's connection decides for everyone,
// as it did before (methodReady). A school's main manager can always use a password, so nobody is
// locked out if the provider is down, and gets single sign-on too once they turned it on.
let methodCheck = { at: 0, ready: false };
async function methodReady(db) {
  if (Date.now() - methodCheck.at < 60000) return methodCheck.ready;
  const { rows } = await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'sign_in_method'"
  ).catch(() => ({ rows: [] }));
  methodCheck = { at: Date.now(), ready: rows.length > 0 };
  return methodCheck.ready;
}

// For tests, and right after the update runs: look again on the next call.
methodReady.forget = () => { methodCheck = { at: 0, ready: false }; };

// A users row read with SELECT * carries the column once it exists.
const hasMethod = (user) => Boolean(user) && Object.prototype.hasOwnProperty.call(user, "sign_in_method");
const usesSso = (user) => String((user && user.sign_in_method) || "") === "sso";

// What one person may use: { sso: true/false, password: true/false }. row is the school's
// connection, already known to be on. kind: "staff" | "manager" (the school's own account) | "student".
function waysFor(row, { kind = "staff", user = null, isMain = false } = {}) {
  if (isMain || kind === "manager") return { sso: Boolean(row.turned_on_by_main), password: true };
  if (kind === "student") return { sso: Boolean(row.allow_students), password: true };
  if (hasMethod(user)) return usesSso(user) ? { sso: true, password: false } : { sso: false, password: true };
  return { sso: true, password: !row.require_sso };
}

const activeRow = async (db, organizationId) => {
  if (!organizationId || !isOn(organizationId)) return null;
  const row = await connectionFor(db, organizationId);
  return row && row.status === "active" ? row : null;
};

// Whether a right password must be refused: this person signs in with their school's provider.
async function passwordRefused(db, organizationId, { isMainManager: isMain = false, isStudent = false, user = null } = {}) {
  if (isMain || isStudent) return false;
  const row = await activeRow(db, organizationId);
  if (!row) return false;
  return !waysFor(row, { kind: "staff", user }).password;
}

// How each member of staff signs in, for the staff list. The same rules as the login page:
// "sso" (the school's provider), "both" (the provider or a password: the main manager) or "password".
async function staffSignIn(db, organizationId) {
  const row = isOn(organizationId) ? await connectionFor(db, organizationId) : null;
  const active = Boolean(row && row.status === "active");
  const { getPrimaryManagerUserId } = require("../../middleware/permissionMiddleware");
  const mainId = active ? Number(await getPrimaryManagerUserId(db, organizationId)) : null;
  const ready = await methodReady(db);
  const methods = new Map();
  if (ready) {
    const { rows } = await db.query("SELECT user_id, sign_in_method FROM users WHERE organization_id = $1", [organizationId]).catch(() => ({ rows: [] }));
    rows.forEach((person) => methods.set(Number(person.user_id), person.sign_in_method));
  }
  // The last time each email signed in through the provider.
  const lastSso = new Map();
  if (row) {
    const { rows } = await db.query(
      `SELECT LOWER(email) AS email, MAX(created_at) AS at FROM sso_events
        WHERE organization_id = $1 AND kind = 'login' AND outcome = 'ok' AND email IS NOT NULL
        GROUP BY LOWER(email)`,
      [organizationId]
    ).catch(() => ({ rows: [] }));
    rows.forEach((event) => lastSso.set(event.email, event.at));
  }
  return {
    provider: active ? { name: row.display_name, protocol: PROTOCOL_NAMES[row.protocol] || "" } : null,
    methodsReady: ready,
    // What was chosen for them (shown on their form), whether or not single sign-on is on now.
    chosenFor: (user) => (methods.get(Number(user.user_id)) === "sso" ? "sso" : "password"),
    wayFor(user, { isOwner = false } = {}) {
      if (!active) return "password";
      const person = ready ? { sign_in_method: methods.get(Number(user.user_id)) || null } : null;
      const ways = waysFor(row, { user: person, isMain: isOwner || Number(user.user_id) === mainId });
      return ways.sso && ways.password ? "both" : ways.sso ? "sso" : "password";
    },
    lastSsoFor: (email) => lastSso.get(String(email || "").trim().toLowerCase()) || null,
  };
}

// The school's provider, for the staff form and invitations: { name, protocol } while single
// sign-on is on and each person's choice can be saved; otherwise null and nothing is offered.
async function providerForStaff(db, organizationId) {
  const row = await activeRow(db, organizationId).catch(() => null);
  if (!row || !(await methodReady(db))) return null;
  return { name: row.display_name, protocol: PROTOCOL_NAMES[row.protocol] || "" };
}

// For an invitation: { name, only } when this person signs in with the school's provider
// (only: no password to set), or null when they use a Managira password.
async function inviteSignIn(db, organizationId, { method = null } = {}) {
  const row = await activeRow(db, organizationId).catch(() => null);
  if (!row) return null;
  if (await methodReady(db)) return method === "sso" ? { name: row.display_name, only: true } : null;
  return { name: row.display_name, only: Boolean(row.require_sso) };
}

// How many of the school's staff sign in with its provider, and how many there are.
async function methodCounts(db, organizationId) {
  if (!(await methodReady(db))) return null;
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE sign_in_method = 'sso')::int AS sso
       FROM users WHERE organization_id = $1 AND removed_at IS NULL AND account_type::text NOT IN ('Admin', 'Mini Admin', 'Internal Worker')`,
    [organizationId]
  );
  return rows[0];
}

// Everyone at the school signs in with its provider from now on (the main manager keeps a password).
async function everyoneUsesSso(db, organizationId) {
  const { rowCount } = await db.query(
    `UPDATE users SET sign_in_method = 'sso', updated_at = NOW()
      WHERE organization_id = $1 AND removed_at IS NULL AND account_type::text NOT IN ('Admin', 'Mini Admin', 'Internal Worker')
        AND sign_in_method IS DISTINCT FROM 'sso'`,
    [organizationId]
  );
  return rowCount;
}

module.exports = {
  PROVIDERS, PROTOCOL_NAMES, SsoSetupError, isOn, isComplete, readCertificate, connectionFor, connectionByPublicId, connectionForEmail,
  saveSettings, setStatus, removeConnection, clientSecretOf, record, passwordRefused, isMainManager, staffSignIn, inviteSignIn,
  methodReady, waysFor, providerForStaff, methodCounts, everyoneUsesSso,
};
