"use strict";

// OpenID Connect, for any provider that publishes the standard settings. The library checks the
// answer's signature, issuer, audience, time limits, state, nonce and PKCE.
const { BoundedMap } = require("../boundedMap");
const { safeFetch, localAllowed } = require("../safeFetch");
const { clientSecretOf } = require("./connections");
const requests = require("./requests");

const load = () => import("openid-client");
const CONFIG_CACHE_MS = 10 * 60 * 1000;
const configs = new BoundedMap(500);

const callbackOf = (base, connection) => `${base}/account/sso/oidc/${connection.public_id}/callback`;

async function configFor(connection) {
  const key = `${connection.connection_id}:${new Date(connection.updated_at).getTime()}`;
  const hit = configs.get(key);
  if (hit && Date.now() - hit.at < CONFIG_CACHE_MS) return hit.config;
  const client = await load();
  const config = await client.discovery(new URL(connection.oidc_issuer), connection.oidc_client_id, clientSecretOf(connection), undefined, {
    [client.customFetch]: (url, options) => safeFetch(url, options),
    ...(localAllowed() ? { execute: [client.allowInsecureRequests] } : {}),
  });
  config[client.customFetch] = (url, options) => safeFetch(url, options);
  if (localAllowed()) client.allowInsecureRequests(config);
  // The answer comes straight from the provider, but its signature is checked as well.
  client.enableNonRepudiationChecks(config);
  configs.set(key, { at: Date.now(), config });
  return config;
}

async function startUrl(db, req, res, base, connection, kind, loginHint) {
  const client = await load();
  const config = await configFor(connection);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  await requests.create(db, req, res, connection, { kind, requestId: state, nonce, verifier });
  return client.buildAuthorizationUrl(config, {
    redirect_uri: callbackOf(base, connection),
    scope: "openid email profile",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).href;
}

const looksLikeEmail = (value) => typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

function emailFrom(claims, connection) {
  if (String(claims.email_verified).toLowerCase() === "false") throw new Error("the provider says this email isn't verified");
  const names = connection.email_attribute ? [connection.email_attribute, "email", "preferred_username", "upn"] : ["email", "preferred_username", "upn"];
  for (const name of names) if (looksLikeEmail(claims[name])) return claims[name].trim().toLowerCase();
  return null;
}

// The request row is used up before the code is sent, so a replay can't get this far twice.
async function finish(base, connection, row, query) {
  if (!row.verifier || !row.nonce) throw new Error("that sign-in wasn't started for OpenID Connect");
  const client = await load();
  const config = await configFor(connection);
  const current = new URL(callbackOf(base, connection));
  Object.entries(query).forEach(([key, value]) => { if (typeof value === "string") current.searchParams.set(key, value); });
  const tokens = await client.authorizationCodeGrant(config, current, {
    pkceCodeVerifier: row.verifier,
    expectedState: row.request_id,
    expectedNonce: row.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("no identity in the answer");
  return { email: emailFrom(claims, connection), subject: claims.sub || null };
}

// Whether these settings reach a real provider, before anyone tries to sign in.
async function check(connection) {
  await configFor(connection);
}

module.exports = { startUrl, finish, callbackOf, emailFrom, check };
