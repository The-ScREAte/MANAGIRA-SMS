"use strict";

// Automated scanners ask for secrets and other sites' admin pages all day. They get
// a quick 404 here, before any session, database or page work is spent on them.
const PROBE = /(^|\/)\.(env|git|aws|ssh|htaccess|htpasswd|DS_Store)(\/|$|\.)|\.(php|asp|aspx|jsp|cgi|sql|bak)$|\/wp-(admin|content|includes|login|json)|\/(phpmyadmin|cgi-bin|vendor\/phpunit|xmlrpc)|\/admin\/controller\//i;

module.exports = function botProbes(req, res, next) {
  if (PROBE.test(req.path)) return res.status(404).type("txt").send("Not found");
  next();
};
module.exports.PROBE = PROBE;
