"use strict";

// A settings form that saves as its switches change asks for JSON (`Accept: application/json`): the
// handler's own flash message and redirect become a short JSON answer, so nothing waits in the
// session to appear on the next page. Every other request is handled exactly as before.
module.exports = function jsonSaves(req, res, next) {
  if (!/json/i.test(req.get("accept") || "")) return next();
  let failed = false;
  const flash = req.flash;
  req.flash = function quietFlash(type, ...rest) {
    if (!rest.length) return typeof flash === "function" ? flash.call(req, type) : [];
    if (/error/i.test(String(type))) failed = true;
    return undefined;
  };
  res.redirect = function jsonRedirect() {
    return res.status(failed ? 400 : 200).json({ success: !failed });
  };
  return next();
};
