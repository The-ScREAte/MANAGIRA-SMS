"use strict";

// A page checking in every few seconds (bus position, notification count) reads its
// session each time. Those small requests share a copy for a few seconds, while full
// pages and every save always use the database, so it stays right across several
// servers. This server's own saves and sign-outs update the copy at once.
const { AsyncLocalStorage } = require("node:async_hooks");
const { BoundedMap } = require("./boundedMap");

const TTL_MS = Number(process.env.SESSION_CACHE_MS) || 10000;
const SMALL_REQUESTS = /^\/(transportation\/live\/|transportation\/road-route|notifications\/count|notifications\/new-term-popup|me\/announcements|common\/setupSteps|api\/chatbot\/popular)/;
const smallRequest = new AsyncLocalStorage();

// Goes before the session middleware.
function markSmallRequests(req, res, next) {
  if (req.method === "GET" && SMALL_REQUESTS.test(req.path)) return smallRequest.run(true, next);
  return next();
}

function withSessionCache(StoreClass) {
  return class CachedSessionStore extends StoreClass {
    constructor(options) {
      super(options);
      this.sessionCopies = new BoundedMap(5000);
    }

    get(sid, callback) {
      if (smallRequest.getStore()) {
        const hit = this.sessionCopies.get(sid);
        if (hit && hit.expires > Date.now()) {
          // A fresh object each time: the request is free to change its own session.
          return callback(null, JSON.parse(hit.json));
        }
      }
      return super.get(sid, (error, session) => {
        if (!error && session) {
          this.sessionCopies.set(sid, { json: JSON.stringify(session), expires: Date.now() + TTL_MS });
        }
        callback(error, session);
      });
    }

    set(sid, session, callback) {
      this.sessionCopies.set(sid, { json: JSON.stringify(session), expires: Date.now() + TTL_MS });
      return super.set(sid, session, (error) => {
        if (error) this.sessionCopies.delete(sid);
        if (callback) callback(error);
      });
    }

    destroy(sid, callback) {
      this.sessionCopies.delete(sid);
      return super.destroy(sid, callback);
    }
  };
}

module.exports = { withSessionCache, markSmallRequests };
