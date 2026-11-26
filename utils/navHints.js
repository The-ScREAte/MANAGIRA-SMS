"use strict";

// Helpers for the in-app page cache (public/js/spa-router.js + public/js/navCache.js).
//
//  - req.isPrefetch: the page asked for this ahead of a click (idle warm-up, hover). Such a request must
//    never change anything: no flash message consumed, no "last active" time pushed forward, nothing logged.
//  - A page fetched by the app's own navigation (header X-Nav-Cache: 1) gets an ETag computed with the page's
//    security nonce taken out, so a page that did not change answers 304 even though every response carries a
//    new nonce. The browser's own full loads are untouched (no hashing, still "no-store").
//  - Server-Timing on page answers, so the time the server spent on a page can be read in the browser.
const crypto = require("crypto");

function isPrefetchRequest(req) {
  const get = (name) => (req.get ? req.get(name) : (req.headers || {})[name.toLowerCase()]);
  return (
    get("X-Prefetch") === "1" ||
    get("X-SPA-Preload") === "1" ||
    /prefetch|prerender/i.test(String(get("Sec-Purpose") || get("Purpose") || ""))
  );
}

// The page text with this response's nonce removed, so two renders of the same page hash alike.
function normalizedEtag(body, nonce) {
  let text = String(body);
  if (nonce) text = text.split(nonce).join("");
  text = text.replace(/(?:[?&]|&amp;)(?:expires|signature)=[^&"'\s<]*/g, "");
  text = text.replace(/\bdata-(?:idle-left|ends-in)="[^"]*"/g, ""); // the sign-in clock the page was drawn with
  const hash = crypto.createHash("sha1").update(text).digest("base64").substring(0, 27);
  return `W/"nav-${Buffer.byteLength(text).toString(16)}-${hash}"`;
}

function navHints(req, res, next) {
  req.isPrefetch = isPrefetchRequest(req);
  if (req.method !== "GET") return next();
  const started = process.hrtime.bigint();
  const send = res.send;
  res.send = function patchedSend(body) {
    try {
      const type = String(res.getHeader("Content-Type") || "");
      if (typeof body === "string" && (!type || /text\/html/i.test(type)) && !res.headersSent) {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        res.setHeader("Server-Timing", `app;dur=${ms.toFixed(1)}`);
        if (req.get("X-Nav-Cache") === "1" && res.statusCode === 200 && !res.getHeader("Set-Cookie") && !res.getHeader("Location")) {
          res.setHeader("ETag", normalizedEtag(body, res.locals && res.locals.cspNonce));
        }
      }
    } catch (_error) { /* a page is still sent without it */ }
    return send.apply(this, arguments);
  };
  next();
}

// connect-flash for a prefetch: reads nothing, stores nothing (a message waits for the person's own visit).
function quietFlash(req, res, next) {
  if (req.isPrefetch) {
    req.flash = function quiet() { return arguments.length === 0 ? {} : arguments.length === 1 ? [] : 0; };
  }
  next();
}

module.exports = { navHints, quietFlash, isPrefetchRequest, normalizedEtag };
