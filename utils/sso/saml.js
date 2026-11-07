"use strict";

// SAML 2.0, for any provider. Sign-ins always start here and the provider must answer that
// exact request, signed with the school's certificate, for this school, within its time limit.
const crypto = require("crypto");
const { SAML } = require("@node-saml/node-saml");
const requests = require("./requests");
const { safeFetch } = require("../safeFetch");
const { readCertificate, SsoSetupError } = require("./connections");
const { DOMParser } = require("@xmldom/xmldom");

const CLOCK_SKEW_MS = 2 * 60 * 1000;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;

const entityIdOf = (base, connection) => `${base}/account/sso/saml/${connection.public_id}/metadata`;
const acsOf = (base, connection) => `${base}/account/sso/saml/${connection.public_id}/acs`;

function clientFor(db, base, connection, { requestId = null } = {}) {
  return new SAML({
    callbackUrl: acsOf(base, connection),
    entryPoint: connection.saml_sso_url,
    issuer: entityIdOf(base, connection),
    idpIssuer: connection.saml_entity_id,
    idpCert: connection.saml_certificates,
    audience: entityIdOf(base, connection),
    // Some providers sign the whole answer, some the assertion inside: one is required.
    wantAssertionsSigned: false,
    wantAuthnResponseSigned: false,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    identifierFormat: null,
    disableRequestedAuthnContext: true,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    validateInResponseTo: "always",
    requestIdExpirationPeriodMs: 10 * 60 * 1000,
    generateUniqueId: () => requestId,
    cacheProvider: {
      saveAsync: async (_key, value) => ({ value, createdAt: Date.now() }),
      getAsync: async (key) => {
        const row = await requests.peek(db, key, connection);
        return row ? new Date(row.created_at).toISOString() : null;
      },
      removeAsync: async () => null,
    },
  });
}

async function startUrl(db, req, res, base, connection, kind) {
  const requestId = `_${crypto.randomBytes(20).toString("hex")}`;
  await requests.create(db, req, res, connection, { kind, requestId });
  return clientFor(db, base, connection, { requestId }).getAuthorizeUrlAsync(requestId, {});
}

// The person's email, from where the school's provider says it is.
const EMAIL_NAMES = [
  "email", "mail", "Email", "emailAddress", "EmailAddress", "User.Email", "user.email", "primaryEmail",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  "urn:oid:0.9.2342.19200300.100.1.3",
];
const looksLikeEmail = (value) => typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

function emailFrom(profile, connection) {
  const names = connection.email_attribute ? [connection.email_attribute, ...EMAIL_NAMES] : EMAIL_NAMES;
  for (const name of names) {
    const value = Array.isArray(profile[name]) ? profile[name][0] : profile[name];
    if (looksLikeEmail(value)) return value.trim().toLowerCase();
  }
  return looksLikeEmail(profile.nameID) ? profile.nameID.trim().toLowerCase() : null;
}

// Returns { requestId, email, subject }, or throws.
async function finish(db, base, connection, body) {
  const { profile } = await clientFor(db, base, connection).validatePostResponseAsync({ SAMLResponse: String(body.SAMLResponse || "") });
  if (!profile) throw new Error("no profile in the answer");
  const requestId = profile.inResponseTo || null;
  if (!requestId || requestId !== String(body.RelayState || "")) throw new Error("the answer isn't for this sign-in");
  return { requestId, email: emailFrom(profile, connection), subject: profile.nameID || null };
}

function metadata(base, connection) {
  return clientFor(null, base, connection, { requestId: "_unused" }).generateServiceProviderMetadata(null, null);
}

// A provider's metadata (pasted, or from its address) fills in the three settings it needs.
function readMetadataXml(xml) {
  if (String(xml).length > MAX_METADATA_BYTES) throw new SsoSetupError("That metadata is too large.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new SsoSetupError("That metadata can't be read.");
  let document;
  try {
    document = new DOMParser({ onError: () => {} }).parseFromString(String(xml), "text/xml");
  } catch (_error) {
    throw new SsoSetupError("That metadata can't be read.");
  }
  const byName = (node, name) => Array.from(node.getElementsByTagNameNS("*", name) || []);
  const entity = byName(document, "EntityDescriptor")[0] || document.documentElement;
  const idp = entity && byName(entity, "IDPSSODescriptor")[0];
  if (!idp) throw new SsoSetupError("That isn't sign-on provider metadata. It should come from your provider's SAML settings.");
  const services = byName(idp, "SingleSignOnService");
  const pick = (binding) => services.find((node) => String(node.getAttribute("Binding") || "").endsWith(binding));
  const service = pick("HTTP-Redirect") || pick("HTTP-POST");
  const certificates = byName(idp, "X509Certificate")
    .filter((node) => {
      const key = node.parentNode && node.parentNode.parentNode && node.parentNode.parentNode.parentNode;
      const use = key && key.getAttribute ? key.getAttribute("use") : null;
      return !use || use === "signing";
    })
    .map((node) => node.textContent || "");
  const unique = [...new Set(certificates.map((text) => text.replace(/\s+/g, "")))];
  const read = unique.map((text) => { try { return readCertificate(text); } catch (_error) { return null; } }).filter(Boolean);
  if (!service || !service.getAttribute("Location") || !read.length) throw new SsoSetupError("That metadata is missing the sign-in address or certificate.");
  return { samlEntityId: entity.getAttribute("entityID") || "", samlSsoUrl: service.getAttribute("Location"), samlCertificates: read };
}

async function readMetadataUrl(url) {
  let response;
  try {
    response = await safeFetch(url, { headers: { Accept: "application/samlmetadata+xml, application/xml, text/xml" } });
  } catch (error) {
    throw new SsoSetupError(`That address couldn't be read: ${error.message}`);
  }
  if (!response.ok) throw new SsoSetupError(`That address answered with an error (${response.status}).`);
  return readMetadataXml((await response.text()).slice(0, MAX_METADATA_BYTES + 1));
}

module.exports = { startUrl, finish, metadata, readMetadataXml, readMetadataUrl, entityIdOf, acsOf, emailFrom };
