"use strict";

// Answers that every request needs but that rarely change (is this account active, what
// is the school's current term) are kept for a few seconds, so a busy school costs the
// database one lookup instead of one per request. People asking at the same moment share
// one lookup, failures are never kept, and any change a school saves clears its answers
// straight away (forgetSchool, wired up in server.js).
const { BoundedMap } = require("./boundedMap");

const generations = new BoundedMap(20000);
const caches = [];

function createShortCache({ ttlMs, max = 5000 }) {
  const entries = new BoundedMap(max);
  const cache = {
    get(schoolId, key, load) {
      const fullKey = `${schoolId}:${generations.get(String(schoolId)) || 0}:${key}`;
      const hit = entries.get(fullKey);
      const now = Date.now();
      if (hit && hit.pending) return hit.pending;
      if (hit && hit.expires > now) return Promise.resolve(hit.value);
      const pending = Promise.resolve()
        .then(load)
        .then((value) => {
          entries.set(fullKey, { value, expires: Date.now() + ttlMs });
          return value;
        })
        .catch((error) => {
          entries.delete(fullKey);
          throw error;
        });
      entries.set(fullKey, { pending });
      return pending;
    },
  };
  caches.push(cache);
  return cache;
}

function forgetSchool(schoolId) {
  if (!schoolId) return;
  const key = String(schoolId);
  generations.set(key, (generations.get(key) || 0) + 1);
}

// Any save or other change a school makes refreshes what it sees on the next request.
function forgetSchoolAfterChanges(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.on("finish", () => forgetSchool(req.session && req.session.organizationId));
  }
  next();
}

module.exports = { createShortCache, forgetSchool, forgetSchoolAfterChanges };
