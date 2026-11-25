// A tiny server for tests/scaleOut.test.js: the real supervisor (utils/clusterPrimary.js) around a few answers.
if (require("../../utils/clusterPrimary").start()) return;
const http = require("http");
const clusterPrimary = require("../../utils/clusterPrimary");
const shortCache = require("../../utils/shortCache");
clusterPrimary.installWorker();
let closing = false;
const server = http.createServer((req, res) => {
  if (req.url === "/forget") { shortCache.forgetSchool(4242); res.end("ok"); return; }
  res.setHeader("Connection", "close");
  res.end(JSON.stringify({ pid: process.pid, worker: Number(process.env.CLUSTER_WORKER), leader: clusterPrimary.isLeader(), jobs: require("../../utils/jobsSwitch").jobsEnabled(), generation: shortCache.generationOf(4242) }));
});
server.listen(Number(process.env.PROBE_PORT), () => console.log("listening"));
const stop = () => { if (closing) return; closing = true; server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on("SIGTERM", stop);
