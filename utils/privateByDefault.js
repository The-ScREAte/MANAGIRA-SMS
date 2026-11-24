"use strict";

// What a signed-in person is shown is theirs alone. Pages already say "no-store"; the lists and
// JSON answers their pages fetch said nothing, so a shared cache (a school's proxy, a CDN rule)
// was free to keep one person's answer and hand it to the next. This marks any answer that
// names no caching rule of its own as private and to be re-checked. It is added just before
// the headers go out, so a route that sets its own rule (a photo kept for a day, say) keeps it.
function signedIn(session) {
  return Boolean(session && (session.userId || session.organizationId || session.studentId || session.guardianId || session.hubId));
}

function privateByDefault(req, res, next) {
  if ((req.method === "GET" || req.method === "HEAD") && signedIn(req.session)) {
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      const given = args.find((arg) => arg && typeof arg === "object" && !Array.isArray(arg));
      const hasRule = Boolean(this.getHeader("Cache-Control")) || Boolean(given && Object.keys(given).some((key) => key.toLowerCase() === "cache-control"));
      if (!hasRule && !this.headersSent) this.setHeader("Cache-Control", "private, no-cache");
      return writeHead.apply(this, args);
    };
  }
  next();
}

module.exports = { privateByDefault, signedIn };
