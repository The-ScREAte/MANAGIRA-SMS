// Single sign-on: mounted at /account/sso. The settings routes are mounted at /account/settings/sso.
const express = require("express");
const { authRateLimit, signInGuard } = require("../utils/authRateLimit");
const { isAuthenticated, blockGuardians } = require("../middleware/middleware");
const { requirePermission, PERMISSIONS } = require("../middleware/permissionMiddleware");
const sso = require("../controllers/ssoController");

module.exports = (db) => {
  const signIn = express.Router();
  signIn.get("/", (req, res) => sso.page(req, res, db));
  signIn.post("/", signInGuard("sso", { field: "email", failedWhen: /^\/account\/sso/ }), (req, res) => sso.go(req, res, db));
  signIn.get("/start/:publicId([a-f0-9]{24})", (req, res) => sso.start(req, res, db));
  signIn.post("/start/:publicId([a-f0-9]{24})", signInGuard("sso-start", { failedWhen: /^\/account\/sso/ }), (req, res) => sso.startConfirmed(req, res, db));
  signIn.post("/saml/:publicId([a-f0-9]{24})/acs", (req, res) => sso.acs(req, res, db));
  signIn.get("/saml/:publicId([a-f0-9]{24})/metadata", (req, res) => sso.metadata(req, res, db));
  signIn.get("/oidc/:publicId([a-f0-9]{24})/callback", (req, res) => sso.oidcCallback(req, res, db));

  const settings = express.Router();
  const manager = [isAuthenticated, blockGuardians, requirePermission(PERMISSIONS.MANAGE_SSO), sso.managersOnly, sso.guard];
  settings.get("/", ...manager, (req, res) => sso.state(req, res, db));
  settings.post("/", ...manager, authRateLimit("sso-confirm", { field: "email", perIp: 300 }), (req, res) => sso.save(req, res, db));
  settings.post("/metadata", ...manager, (req, res) => sso.readMetadata(req, res, db));
  settings.get("/test", ...manager, (req, res) => sso.test(req, res, db));
  settings.post("/turn-on", ...manager, authRateLimit("sso-confirm", { field: "email", perIp: 30 }), (req, res) => sso.turnOn(req, res, db));
  settings.post("/turn-off", ...manager, authRateLimit("sso-confirm", { field: "email", perIp: 30 }), (req, res) => sso.turnOff(req, res, db));
  settings.post("/remove", ...manager, authRateLimit("sso-confirm", { field: "email", perIp: 30 }), (req, res) => sso.remove(req, res, db));
  settings.post("/everyone", ...manager, authRateLimit("sso-confirm", { field: "email", perIp: 30 }), (req, res) => sso.everyone(req, res, db));

  return { signIn, settings };
};
