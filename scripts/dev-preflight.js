// Runs before `npm run dev`. Stops Managira dev servers left over from an
// earlier `npm run dev` (another terminal, a closed editor) so the new session
// gets ports 4000/4100 instead of crashing with "Port already in use".
// Only processes belonging to THIS project are touched; anything else on the
// ports is reported, never stopped.
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORTS = [Number(process.env.PORT || 4000), Number(process.env.MIRA_PORT || 4100)];

if (process.platform === "win32") process.exit(0);

const run = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (_) {
    return "";
  }
};

const cwdOf = (pid) => (run(`lsof -a -p ${pid} -d cwd -Fn`).split("\n").find((l) => l.startsWith("n")) || "").slice(1);
const inProject = (dir) => dir === ROOT || dir.startsWith(ROOT + path.sep);

// Our own ancestors (npm -> this script) must never be stopped.
const table = run("ps -axo pid=,ppid=,command=").split("\n").map((line) => {
  const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
  return m ? { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] } : null;
}).filter(Boolean);
const byPid = new Map(table.map((p) => [p.pid, p]));
const ancestors = new Set();
for (let pid = process.pid; pid && byPid.has(pid) && !ancestors.has(pid); pid = byPid.get(pid).ppid) ancestors.add(pid);

// 1. Leftover dev sessions of this project (concurrently + nodemon watchers).
const stale = table.filter((p) =>
  !ancestors.has(p.pid) &&
  p.command.includes(ROOT) &&
  (/node_modules\/\.bin\/(nodemon|concurrently)/.test(p.command))
);

// 2. Anything still listening on our ports.
const blockers = [];
PORTS.forEach((port) => {
  run(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`).split("\n").filter(Boolean).map(Number).forEach((pid) => {
    if (ancestors.has(pid)) return;
    if (inProject(cwdOf(pid))) stale.push({ pid, command: `server on port ${port}` });
    else blockers.push({ pid, port, command: (byPid.get(pid) || {}).command || "unknown" });
  });
});

const unique = [...new Map(stale.map((p) => [p.pid, p])).values()];
if (process.env.DEV_PREFLIGHT_DRY_RUN) {
  unique.forEach((p) => console.log(`[Dev] (dry run) would stop pid ${p.pid}: ${p.command.replace(ROOT, ".").slice(0, 90)}`));
  blockers.forEach((b) => console.log(`[Dev] (dry run) port ${b.port} used by another app: pid ${b.pid}`));
  process.exit(0);
}
unique.forEach((p) => {
  try {
    process.kill(p.pid, "SIGTERM");
    console.log(`[Dev] Stopped an old Managira dev process (pid ${p.pid}): ${p.command.replace(ROOT, ".").slice(0, 90)}`);
  } catch (_) {
    // already gone
  }
});

if (blockers.length) {
  blockers.forEach((b) => console.error(`[Dev] Port ${b.port} is used by another app (pid ${b.pid}: ${b.command.slice(0, 80)}). Stop it or set PORT/MIRA_PORT.`));
  process.exit(1);
}

// Give stopped servers a moment to release their ports.
if (unique.length) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && PORTS.some((port) => run(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`).trim())) {
    run("sleep 0.3");
  }
}
