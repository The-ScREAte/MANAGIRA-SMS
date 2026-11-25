"use strict";

// How the app checks the database's certificate.
//   DB_SSL_CA=<PEM text or a file path>  trust this CA and require a valid certificate
//   DB_SSL_VERIFY=true                   require a valid certificate (Node's built-in CAs)
//   DB_SSL_VERIFY=false                  never check it
//   neither                              checked when the database is on Render's public address
//                                        (*.render.com: its certificate is a public one and verifies),
//                                        not checked for any other address, such as Render's internal
//                                        dpg-... names, whose certificate carries no such name.
// A connection string that says sslmode=require/verify-* makes the pg driver verify the
// certificate itself; sslmode is dropped here whenever this module decides, so the decision is the
// one that counts.
const fs = require("fs");

function readCa(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("BEGIN CERTIFICATE")) return text.replace(/\\n/g, "\n");
  try { return fs.readFileSync(text, "utf8"); } catch (_) { return ""; }
}

function hostOf(connectionString) {
  try { return new URL(String(connectionString || "")).hostname.toLowerCase(); } catch (_) { return ""; }
}

// An address on Render's public side: a name with dots that ends in .render.com.
const isRenderPublicHost = (connectionString) => /^[a-z0-9-]+(\.[a-z0-9-]+)+\.render\.com$/.test(hostOf(connectionString));

const withoutSslmode = (connectionString) => String(connectionString || "").replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");

function dbSslSettings(connectionString, env = process.env) {
  const ca = readCa(env.DB_SSL_CA);
  if (env.DB_SSL_CA && !ca) console.warn("[DB] DB_SSL_CA is set but is not a certificate or a readable file; it is being ignored.");
  const flag = String(env.DB_SSL_VERIFY || "").trim().toLowerCase();
  const off = { connectionString, ssl: { rejectUnauthorized: false }, verifies: false, automatic: false };
  if (ca) return { connectionString: withoutSslmode(connectionString), ssl: { ca, rejectUnauthorized: true }, verifies: true, automatic: false };
  if (flag === "true") return { connectionString: withoutSslmode(connectionString), ssl: { rejectUnauthorized: true }, verifies: true, automatic: false };
  if (flag === "false") return off;
  if (isRenderPublicHost(connectionString)) return { connectionString: withoutSslmode(connectionString), ssl: { rejectUnauthorized: true }, verifies: true, automatic: true };
  return off;
}

const CERTIFICATE_CODES = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_UNTRUSTED", "HOSTNAME_MISMATCH"]);
const isCertificateError = (error) => Boolean(error) && CERTIFICATE_CODES.has(String(error.code || ""));

// Only a check chosen automatically gives way: if the certificate can't be verified (a region whose
// certificate differs), the pool carries on unchecked, as before, and says so once; it never stops
// the app from reaching its database. A check someone asked for stays strict.
let warned = false;
function fallBack(pool, settings, error) {
  if (!settings || !settings.automatic || !pool || !pool.options || !isCertificateError(error)) return false;
  if (pool.options.ssl && pool.options.ssl.rejectUnauthorized === false) return true; // already done by another request
  pool.options.ssl = { rejectUnauthorized: false };
  if (!warned) {
    warned = true;
    console.warn(`[DB] The database certificate could not be verified (${error.code}); continuing without checking it. Set DB_SSL_CA to its CA, or DB_SSL_VERIFY=false to stop trying.`);
  }
  return true;
}

module.exports = { dbSslSettings, isRenderPublicHost, isCertificateError, fallBack };
