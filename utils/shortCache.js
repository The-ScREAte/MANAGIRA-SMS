"use strict";

// Answers that every request needs but that rarely change (is this account active, what
// is the school's current term) are kept for a few seconds, so a busy school costs the
// database one lookup instead of one per request. People asking at the same moment share
// one lookup, failures are never kept, and any change a school saves clears its answers
// straight away (forgetSchool, wired up in server.js).
const { BoundedMap } = require("./boundedMap");

// Not a BoundedMap: a counter that is dropped (cap reached, memory guard) starts again at 0, and an old
// answer made under generation 0 could then be served as if nothing had been saved since. There is one
// entry per school and per table, a few thousand numbers at most.
const generations = new Map();
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

const forgetListeners = [];
const generationOf = (schoolId) => generations.get(String(schoolId)) || 0;

// fromPeer: another server process told us (utils/cluster.js); don't tell it back.
function forgetSchool(schoolId, fromPeer = false) {
  if (schoolId === undefined || schoolId === null || schoolId === '') return;
  const key = String(schoolId);
  generations.set(key, (generations.get(key) || 0) + 1);
  if (!fromPeer) forgetListeners.forEach((listener) => { try { listener(schoolId); } catch (_) { /* never matters here */ } });
}
const onForget = (listener) => forgetListeners.push(listener);

// Saves that happen all day long and change nothing these answers are made of (a student's exam
// autosave, a bus position, a teacher marking attendance or entering scores): they don't clear a
// school's kept answers, or a busy school would never keep any.
const QUIET_SAVES = /^\/(student\/testing-room\/\d+\/(autosave|start|submit)|transportation\/driver\/(live-location|trips\/boarding)|common\/(saveSingleAttendance|saveAllScores)|notifications\/)/;
const isQuietSave = (req) => QUIET_SAVES.test(String(req.path || ""));

// Any save or other change a school makes refreshes what it sees on the next request.
function forgetSchoolAfterChanges(req, res, next) {
  const schoolId = req.session && req.session.organizationId;
  // The page's own lookups are kept per school (utils/stableReads.js).
  const quiet = isQuietSave(req);
  const stats = require("./requestStats").setSchool(schoolId);
  if (req.method !== "GET" && req.method !== "HEAD" && !quiet) {
    res.on("finish", () => forgetSchool(schoolId));
  } else if (schoolId && stats && !quiet) {
    // A page that opened a transaction may have saved something.
    res.on("finish", () => { if (stats.openedTransaction) forgetSchool(schoolId); });
  }
  next();
}

module.exports = { createShortCache, forgetSchool, forgetSchoolAfterChanges, generationOf, onForget };
