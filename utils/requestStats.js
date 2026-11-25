"use strict";

// Logs any page that is slow or makes many queries: the real list of what to speed up next.
const { AsyncLocalStorage } = require("node:async_hooks");

const current = new AsyncLocalStorage();
// Quiet by default while developing; set SLOW_PAGE_MS / MANY_QUERIES to see more (production keeps the tighter limits).
const DEV = process.env.NODE_ENV !== "production";
const SLOW_MS = Number(process.env.SLOW_PAGE_MS) || (DEV ? 4000 : 800);
const MANY_QUERIES = Number(process.env.MANY_QUERIES) || (DEV ? 60 : 25);
// Background polling and images never tell us anything about a page.
const QUIET_PATHS = /^\/(notifications\/|public-image|common\/setupSteps|common\/page-finder|common\/ui-preferences|api\/chatbot\/popular|me\/announcements|notices\/active|account\/session-status|api-access\/usage-banner)/;

function requestStats(req, res, next) {
  const stats = { queries: 0, dbMs: 0, startedAt: process.hrtime.bigint() };
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - stats.startedAt) / 1e6;
    if (ms >= SLOW_MS || stats.queries >= MANY_QUERIES) {
      const path = req.originalUrl.split("?")[0];
      if (QUIET_PATHS.test(path)) return;
      console.warn(`[slow] ${req.method} ${path} ${res.statusCode} · ${(ms / 1000).toFixed(1)}s · ${stats.queries} queries · db ${(stats.dbMs / 1000).toFixed(1)}s`);
    }
  });
  current.run(stats, next);
}

function countQuery(ms) {
  const stats = current.getStore();
  if (stats) {
    stats.queries += 1;
    stats.dbMs += ms;
  }
}

// One page load's answers to repeated reads of Managira's own settings and price tables
// (config/db.js): nothing outlives the request, so nothing can go stale.
function requestMemo() {
  const stats = current.getStore();
  if (!stats) return null;
  if (!stats.memo) stats.memo = new Map();
  return stats.memo;
}

// Once the session says which school this request is for, its lookups can be kept per school.
function setSchool(schoolId) {
  const stats = current.getStore();
  if (stats && schoolId) stats.schoolId = Number(schoolId) || null;
  return stats || null;
}
// This request's own store (utils/stableReads.js reads it); null outside a request.
const store = () => current.getStore() || null;
// A transaction was opened: whatever this request saved isn't seen by the kept answers, so it reads fresh from here on.
function openedTransaction() {
  const stats = current.getStore();
  if (stats) { stats.openedTransaction = true; stats.noShared = true; }
}

module.exports = { requestStats, countQuery, requestMemo, setSchool, store, openedTransaction };
