"use strict";

// Logs any page that is slow or makes many queries: the real list of what to speed up next.
const { AsyncLocalStorage } = require("node:async_hooks");

const current = new AsyncLocalStorage();
const SLOW_MS = Number(process.env.SLOW_PAGE_MS) || 800;
const MANY_QUERIES = Number(process.env.MANY_QUERIES) || 25;

function requestStats(req, res, next) {
  const stats = { queries: 0, dbMs: 0, startedAt: process.hrtime.bigint() };
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - stats.startedAt) / 1e6;
    if (ms >= SLOW_MS || stats.queries >= MANY_QUERIES) {
      console.warn(`[page] ${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Math.round(ms)}ms, ${stats.queries} queries, ${Math.round(stats.dbMs)}ms in the database`);
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

module.exports = { requestStats, countQuery };
