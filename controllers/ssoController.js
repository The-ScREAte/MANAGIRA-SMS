"use strict";

// Signing in through a school's own provider, and the page where a manager sets that up.
const bcrypt = require("bcryptjs");
const connections = require("../utils/sso/connections");
const requests = require("../utils/sso/requests");
const saml = require("../utils/sso/saml");
const oidc = require("../utils/sso/oidc");
const { findAccount, signIn, SignInRefused } = require("../utils/sso/signIn");
const { logOrganizationActivity } = require("../utils/activityLog");
const { checkedUrl } = require("../utils/safeFetch");

const { SsoSetupError } = connections;
const NOT_WORKING = "Single sign-on didn't work. Try again, or ask your school's IT team.";

// The one address a provider is set up with, whichever school address someone started from.
function baseOf(req) {
  if (process.env.SSO_BASE_URL) return process.env.SSO_BASE_URL.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? "https://managira.com" : `${req.protocol}://${req.get("host")}`;
}

// Single sign-on has no page of its own: anything to say is said on the login page.
function backToPage(req, res, message, next) {
  if (message) req.flash("error", message);
  return res.redirect(`/account/login${next === "mira" ? "?next=mira" : ""}`);
}

const isActive = (connection) => connection && connection.status === "active" && connections.isOn(connection.organization_id);
const nextOf = (value) => (value === "mira" ? "mira" : "");
const miraAddress = () => `${require("../utils/miraIntegration").miraPublicUrl()}/continue`;

// The provider's address for this sign-in. The request it starts is tied to this browser.
async function startUrlFor(req, res, db, connection, kind, { loginHint = null, next = "" } = {}) {
  const base = baseOf(req);
  if (next === "mira") res.cookie("mg_sso_next", "mira", { path: "/account/sso", httpOnly: true, maxAge: 10 * 60 * 1000, sameSite: req.secure ? "none" : "lax", secure: Boolean(req.secure) });
  else res.clearCookie("mg_sso_next", { path: "/account/sso" });
  const url = connection.protocol === "saml"
    ? await saml.startUrl(db, req, res, base, connection, kind)
    : await oidc.startUrl(db, req, res, base, connection, kind, loginHint);
  return url;
}

async function beginSignIn(req, res, db, connection, kind, options = {}) {
  return res.redirect(await startUrlFor(req, res, db, connection, kind, options));
}

const nextCookie = (req) => (/(^|;\s*)mg_sso_next=mira(;|$)/.test(String(req.headers.cookie || "")) ? "mira" : "");

// The provider has said who this is, and everything about the answer has checked out.
async function finishSignIn(req, res, db, connection, row, email) {
  const ip = req.ip;
  const next = nextCookie(req);
  if (row.kind === "test") return finishTest(req, res, db, connection, email);
  if (!isActive(connection)) return backToPage(req, res, "Single sign-on isn't turned on for your school.", next);
  if (!email) {
    await connections.record(db, { organizationId: connection.organization_id, kind: "login", outcome: "refused", detail: "The provider sent no email address", ip });
    return backToPage(req, res, "Your school's sign-in didn't send an email address. Ask your school's IT team.", next);
  }
  const account = await findAccount(db, connection, email);
  if (account && !connection.turned_on_by_main && await connections.isMainManager(db, connection.organization_id, account.kind === "manager" ? { owner: true } : account.user)) {
    await connections.record(db, { organizationId: connection.organization_id, kind: "login", email, outcome: "refused", detail: "The main manager didn't turn this on", ip });
    return backToPage(req, res, "Your school's main manager signs in with a password until they turn on single sign-on themselves.", next);
  }
  if (!account) {
    await connections.record(db, { organizationId: connection.organization_id, kind: "login", email, outcome: "refused", detail: "No account at this school with this email", ip });
    return backToPage(req, res, "There's no account at your school for that email. Ask your school to add you.", next);
  }
  try {
    const landing = await signIn(db, req, connection, { ...account, email });
    await connections.record(db, { organizationId: connection.organization_id, kind: "login", email, outcome: "ok", ip });
    res.clearCookie("mg_sso_next", { path: "/account/sso" });
    return res.redirect(303, next === "mira" && account.kind !== "student" ? miraAddress() : landing);
  } catch (error) {
    if (!(error instanceof SignInRefused)) throw error;
    await connections.record(db, { organizationId: connection.organization_id, kind: "login", email, outcome: "refused", detail: error.message, ip });
    return backToPage(req, res, error.message, next);
  }
}

// A test never signs anyone in. It says what the provider sent, and whether it fits an account.
async function finishTest(req, res, db, connection, email) {
  const account = email ? await findAccount(db, connection, email) : null;
  if (email && account) {
    await db.query(
      `UPDATE sso_connections SET status = CASE WHEN status = 'draft' THEN 'tested' ELSE status END, tested_at = NOW(), tested_email = $2 WHERE connection_id = $1`,
      [connection.connection_id, email]
    );
  }
  await connections.record(db, {
    organizationId: connection.organization_id, kind: "test", email, outcome: email && account ? "ok" : "refused",
    detail: !email ? "The provider sent no email address" : account ? null : "No account at this school with this email", ip: req.ip,
  });
  return res.render("account/ssoTest", { layout: false, title: "Single sign-on test", ok: Boolean(email && account), email, hasEmail: Boolean(email), problem: null });
}

function failTest(res, message) {
  return res.render("account/ssoTest", { layout: false, title: "Single sign-on test", ok: false, email: null, hasEmail: false, problem: message });
}

// Words a manager can act on. Never shown to anyone else.
function explain(error) {
  const text = String((error && error.message) || "");
  if (/signature/i.test(text)) return "The signature didn't match. Check that the certificate is the current one from your provider.";
  if (/audience/i.test(text)) return "The provider's answer was meant for a different app. Check the Entity ID you gave it.";
  if (/issuer/i.test(text)) return "The answer came from a different provider than the one set up here. Check the issuer or Entity ID.";
  if (/expired|NotOnOrAfter|NotBefore|clock/i.test(text)) return "The answer had expired. Check the time on your provider's server, then try again.";
  if (/InResponseTo|in response/i.test(text)) return "That answer wasn't for this sign-in. Start the test again from Managira.";
  if (/client|secret|unauthorized|invalid_grant/i.test(text)) return "The provider refused the client ID or secret. Check both and save again.";
  if (/redirect/i.test(text)) return "The provider doesn't have this address on its list. Check the Redirect URI you gave it.";
  return "The provider's answer couldn't be accepted. Check the settings and try again.";
}

async function acs(req, res, db) {
  const connection = await connections.connectionByPublicId(db, req.params.publicId);
  // A school signs in one way at a time: an answer of the other kind is never looked at.
  if (!connection || connection.protocol !== "saml") return backToPage(req, res, NOT_WORKING);
  const next = nextCookie(req);
  let answer;
  try {
    answer = await saml.finish(db, baseOf(req), connection, req.body || {});
  } catch (error) {
    console.error("[SSO] SAML answer refused:", connection.organization_id, error.message);
    await connections.record(db, { organizationId: connection.organization_id, kind: "login", outcome: "refused", detail: String(error.message).slice(0, 300), ip: req.ip });
    const row = await requests.peek(db, String(req.body?.RelayState || ""), connection).catch(() => null);
    if (row && row.kind === "test") return failTest(res, explain(error));
    return backToPage(req, res, NOT_WORKING, next);
  }
  const row = await requests.consume(db, req, answer.requestId, connection);
  if (!row) {
    await connections.record(db, { organizationId: connection.organization_id, kind: "login", email: answer.email, outcome: "refused", detail: "Used twice, expired, or from a different browser", ip: req.ip });
    return backToPage(req, res, "That sign-in has expired. Please start again.", next);
  }
  return finishSignIn(req, res, db, connection, row, answer.email);
}

async function oidcCallback(req, res, db) {
  const connection = await connections.connectionByPublicId(db, req.params.publicId);
  if (!connection || connection.protocol !== "oidc") return backToPage(req, res, NOT_WORKING);
  const next = nextCookie(req);
  const row = await requests.consume(db, req, String(req.query.state || ""), connection);
  if (!row) {
    await connections.record(db, { organizationId: connection.organization_id, kind: "login", outcome: "refused", detail: "Used twice, expired, or from a different browser", ip: req.ip });
    return backToPage(req, res, "That sign-in has expired. Please start again.", next);
  }
  if (req.query.error) {
    const detail = String(req.query.error_description || req.query.error).slice(0, 300);
    await connections.record(db, { organizationId: connection.organization_id, kind: row.kind, outcome: "refused", detail, ip: req.ip });
    if (row.kind === "test") return failTest(res, `Your provider said: ${detail}`);
    return backToPage(req, res, /access_denied/.test(String(req.query.error)) ? "Sign-in was cancelled." : NOT_WORKING, next);
  }
  try {
    const { email } = await oidc.finish(baseOf(req), connection, row, req.query);
    return await finishSignIn(req, res, db, connection, row, email);
  } catch (error) {
    if (res.headersSent) throw error;
    console.error("[SSO] OpenID answer refused:", connection.organization_id, error.message);
    await connections.record(db, { organizationId: connection.organization_id, kind: row.kind, outcome: "refused", detail: String(error.message).slice(0, 300), ip: req.ip });
    if (row.kind === "test") return failTest(res, explain(error));
    return backToPage(req, res, NOT_WORKING, next);
  }
}

// ---------- the settings page ----------
function presented(req, row) {
  const base = baseOf(req);
  const urls = row ? {
    acs: saml.acsOf(base, row),
    entityId: saml.entityIdOf(base, row),
    metadata: saml.entityIdOf(base, row),
    redirectUri: oidc.callbackOf(base, row),
    start: `${base}/account/sso/start/${row.public_id}`,
  } : null;
  return {
    connection: row ? {
      provider: row.provider,
      protocol: row.protocol,
      displayName: row.display_name,
      status: row.status,
      complete: connections.isComplete(row),
      samlEntityId: row.saml_entity_id || "",
      samlSsoUrl: row.saml_sso_url || "",
      hasCertificate: Boolean(row.saml_certificates && row.saml_certificates.length),
      emailAttribute: row.email_attribute || "",
      oidcIssuer: row.oidc_issuer || "",
      oidcClientId: row.oidc_client_id || "",
      hasClientSecret: Boolean(row.oidc_client_secret_locked),
      allowStudents: row.allow_students,
      requireSso: row.require_sso,
      testedAt: row.tested_at,
      testedEmail: row.tested_email,
    } : null,
    urls,
  };
}

const actorName = (req) => [req.session.firstName, req.session.lastName].filter(Boolean).join(" ") || req.session.user?.email || "A manager";

function logChange(req, description) {
  logOrganizationActivity({
    organizationId: req.session.organizationId,
    userId: req.session.userId || req.session.user?.user_id || null,
    userName: actorName(req),
    userRole: req.session.userRole,
    actionType: "Updated",
    moduleName: "Single sign-on",
    pagePath: "/account/settings",
    recordType: "Setting",
    recordLabel: "Single sign-on",
    description,
    changedFields: [],
    ipAddress: req.ip,
  }).catch(() => {});
}

// Turning this on decides who can get into the whole school, so it asks for the password again.
async function passwordIsRight(req, db, password) {
  const given = String(password || "");
  if (!given) return false;
  const userId = req.session.userId;
  const { rows } = userId
    ? await db.query("SELECT password FROM users WHERE user_id = $1 AND organization_id = $2", [userId, req.session.organizationId])
    : await db.query("SELECT password FROM organizations WHERE organization_id = $1", [req.session.organizationId]);
  return Boolean(rows[0] && rows[0].password && await bcrypt.compare(given, rows[0].password));
}

const answer = (res, work) => work().catch((error) => {
  if (error instanceof SsoSetupError) return res.status(400).json({ success: false, message: error.message });
  console.error("[SSO] settings:", error.message);
  return res.status(500).json({ success: false, message: "That didn't work. Try again." });
});

module.exports = {
  // ---------- signing in ----------
  // The old address of the SSO page: everyone starts from the login page now.
  page: (req, res) => res.redirect(`/account/login${nextOf(req.query.next) ? "?next=mira" : ""}`),

  // The login page's first step: an email. A school that signs in through its own provider
  // gets sent there; everyone else is asked for a password, on the same page. An email nobody
  // has gets the same password step, so this tells a stranger nothing about password accounts.
  // A school's main manager keeps a password (and may also choose single sign-on), so they can
  // always get in if the provider is down.
  continueWithEmail: async (req, res, db) => {
    const next = nextOf(req.body?.next || req.query.next);
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 320);
    const wantsJson = /json/i.test(req.get("accept") || "");
    const passwordStep = (extra = {}) => (wantsJson
      ? res.json({ step: "password", ...extra })
      : require("./accountController").loginGet(req, res, db, { step: "password", email, next, ssoAlso: extra.sso || "" }));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      if (wantsJson) return res.status(400).json({ step: "email", message: "Enter a valid email address." });
      req.flash("error", "Enter a valid email address.");
      return res.redirect(`/account/login${next ? "?next=mira" : ""}`);
    }
    try {
      const school = req.schoolDetails || null;
      const row = await connections.connectionForEmail(db, email, { onlyOrganizationId: school ? school.organization_id : null });
      if (row && isActive(row)) {
        const account = await findAccount(db, row, email);
        const main = account && await connections.isMainManager(db, row.organization_id, account.kind === "manager" ? { owner: true } : account.user);
        if (!main) {
          const url = await startUrlFor(req, res, db, row, "login", { loginHint: email, next });
          return wantsJson ? res.json({ step: "sso", go: url }) : res.redirect(url);
        }
        return passwordStep({ sso: `/account/sso/start/${row.public_id}` });
      }
      return passwordStep();
    } catch (error) {
      console.error("[Login] continue:", error.message);
      // Whatever went wrong with single sign-on, a password still works.
      return passwordStep();
    }
  },

  go: (req, res, db) => module.exports.continueWithEmail(req, res, db),

  // A link a school can put in its own portal (Okta, ClassLink and so on). A link can be put
  // anywhere, so one followed from another site asks first: otherwise any site could sign a
  // visitor into an account of its choosing.
  start: async (req, res, db) => {
    const next = nextOf(req.query.next);
    try {
      const row = await connections.connectionByPublicId(db, req.params.publicId);
      if (!isActive(row)) return backToPage(req, res, "Single sign-on isn't turned on for this school.", next);
      if (["same-origin", "none"].includes(String(req.get("sec-fetch-site") || ""))) return await beginSignIn(req, res, db, row, "login", { next });
      const school = await db.query("SELECT organization_name FROM organizations WHERE organization_id = $1", [row.organization_id]);
      return res.render("account/ssoConfirm", {
        layout: false,
        title: "Log in with SSO",
        schoolName: school.rows[0] ? school.rows[0].organization_name : "your school",
        action: `/account/sso/start/${row.public_id}`,
        next,
      });
    } catch (error) {
      console.error("[SSO] start:", error.message);
      return backToPage(req, res, NOT_WORKING, next);
    }
  },

  startConfirmed: async (req, res, db) => {
    const next = nextOf(req.body?.next);
    try {
      const row = await connections.connectionByPublicId(db, req.params.publicId);
      if (!isActive(row)) return backToPage(req, res, "Single sign-on isn't turned on for this school.", next);
      return await beginSignIn(req, res, db, row, "login", { next });
    } catch (error) {
      console.error("[SSO] start:", error.message);
      return backToPage(req, res, NOT_WORKING, next);
    }
  },

  acs: (req, res, db) => acs(req, res, db).catch((error) => {
    console.error("[SSO] SAML:", error.message);
    if (!res.headersSent) backToPage(req, res, NOT_WORKING);
  }),

  oidcCallback: (req, res, db) => oidcCallback(req, res, db).catch((error) => {
    console.error("[SSO] OpenID:", error.message);
    if (!res.headersSent) backToPage(req, res, NOT_WORKING);
  }),

  metadata: async (req, res, db) => {
    try {
      const row = await connections.connectionByPublicId(db, req.params.publicId);
      if (!row || row.protocol !== "saml" || !connections.isOn(row.organization_id)) return res.status(404).send("Not found");
      res.set("Content-Type", "application/xml; charset=utf-8");
      return res.send(saml.metadata(baseOf(req), row));
    } catch (error) {
      console.error("[SSO] metadata:", error.message);
      return res.status(500).send("Not available");
    }
  },

  // ---------- setting it up (a manager, in this school, with the feature on) ----------
  // Whoever controls this can sign in as anyone at the school, so a permission alone isn't enough.
  managersOnly: (req, res, next) => {
    const role = String(req.session.userRole || "").trim().toLowerCase();
    if (role === "manager" || req.session.accountType === "Organization") return next();
    return res.status(403).json({ success: false, message: "Only a manager can change single sign-on." });
  },

  guard: (req, res, next) => {
    if (connections.isOn(req.session.organizationId)) return next();
    return res.status(404).json({ success: false, message: "Not available." });
  },

  state: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    const row = await connections.connectionFor(db, organizationId);
    const events = await db.query(
      `SELECT kind, email, outcome, detail, created_at FROM sso_events WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [organizationId]
    ).catch(() => ({ rows: [] }));
    return res.json({
      success: true,
      providers: Object.entries(connections.PROVIDERS).map(([key, value]) => ({ key, name: value.name, protocols: value.protocols })),
      events: events.rows,
      ...presented(req, row),
    });
  }),

  save: (req, res, db) => answer(res, async () => {
    // Once it's on, any change decides who gets in, so it asks for the password like turning it on.
    const current = await connections.connectionFor(db, req.session.organizationId);
    if (current && current.status === "active" && !(await passwordIsRight(req, db, req.body?.confirmPassword))) {
      return res.status(403).json({ success: false, needsPassword: true, message: "Enter your password to change this." });
    }
    const { row, wentOff } = await connections.saveSettings(db, req.session.organizationId, actorName(req), req.body);
    logChange(req, `${actorName(req)} changed the single sign-on settings${wentOff ? ", which turned it off until it's tested again" : ""}.`);
    return res.json({ success: true, wentOff, ...presented(req, row) });
  }),

  readMetadata: (req, res) => answer(res, async () => {
    const url = String(req.body?.url || "").trim();
    const xml = String(req.body?.xml || "").trim();
    if (!url && !xml) throw new SsoSetupError("Paste the metadata address, or the metadata itself.");
    if (url) {
      try { checkedUrl(url); } catch (error) { throw new SsoSetupError(error.message); }
    }
    const found = url ? await saml.readMetadataUrl(url) : saml.readMetadataXml(xml);
    return res.json({ success: true, samlEntityId: found.samlEntityId, samlSsoUrl: found.samlSsoUrl, samlCertificates: found.samlCertificates });
  }),

  test: async (req, res, db) => {
    try {
      const row = await connections.connectionFor(db, req.session.organizationId);
      if (!row || !connections.isComplete(row)) return failTest(res, "Fill in and save the connection first.");
      if (row.protocol === "oidc") await oidc.check(row);
      return await beginSignIn(req, res, db, row, "test");
    } catch (error) {
      console.error("[SSO] test:", error.message);
      return failTest(res, "That provider couldn't be reached. Check the address and try again.");
    }
  },

  turnOn: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    if (!(await passwordIsRight(req, db, req.body?.password))) return res.status(403).json({ success: false, message: "That password isn't right." });
    const row = await connections.connectionFor(db, organizationId);
    if (!row || row.status === "draft") return res.status(400).json({ success: false, message: "Run a successful test first." });
    const byMain = await connections.isMainManager(db, organizationId, req.session.accountType === "Organization" ? { owner: true } : { user_id: req.session.userId, account_type: req.session.userRole, email: req.session.user?.email });
    const saved = await connections.setStatus(db, organizationId, "active", { byMain });
    await connections.record(db, { organizationId, kind: "setup", email: req.session.user?.email, outcome: "ok", detail: "Turned on", ip: req.ip });
    logChange(req, `${actorName(req)} turned on single sign-on with ${row.display_name}.`);
    return res.json({ success: true, ...presented(req, saved) });
  }),

  turnOff: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    if (!(await passwordIsRight(req, db, req.body?.password))) return res.status(403).json({ success: false, message: "That password isn't right." });
    const row = await connections.connectionFor(db, organizationId);
    if (!row) return res.json({ success: true, connection: null, urls: null });
    const saved = await connections.setStatus(db, organizationId, row.tested_at ? "tested" : "draft");
    await connections.record(db, { organizationId, kind: "setup", email: req.session.user?.email, outcome: "ok", detail: "Turned off", ip: req.ip });
    logChange(req, `${actorName(req)} turned off single sign-on.`);
    return res.json({ success: true, ...presented(req, saved) });
  }),

  remove: (req, res, db) => answer(res, async () => {
    const organizationId = req.session.organizationId;
    if (!(await passwordIsRight(req, db, req.body?.password))) return res.status(403).json({ success: false, message: "That password isn't right." });
    await connections.removeConnection(db, organizationId);
    await connections.record(db, { organizationId, kind: "setup", email: req.session.user?.email, outcome: "ok", detail: "Removed", ip: req.ip });
    logChange(req, `${actorName(req)} removed single sign-on.`);
    return res.json({ success: true, connection: null, urls: null });
  }),
};
