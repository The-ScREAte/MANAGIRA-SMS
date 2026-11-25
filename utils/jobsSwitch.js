"use strict";

// Whether this web server runs the scheduled jobs. On by default (one server, as today).
// With several web servers, set RUN_JOBS=false (or RUN_SCHEDULED_JOBS=false) on the web service
// and run `npm run worker` once; either name works. Even when two servers do run jobs, each job
// takes a Postgres advisory lock first (utils/dbLock.js), so no job ever runs twice at once.
// With WEB_CONCURRENCY workers on one server, only worker 1 runs them (utils/clusterPrimary.js).
function jobsEnabled(env = process.env) {
  if (env.CLUSTER_WORKER && env.CLUSTER_LEADER !== "1") return false;
  return env.RUN_SCHEDULED_JOBS !== "false" && env.RUN_JOBS !== "false";
}

module.exports = { jobsEnabled };
