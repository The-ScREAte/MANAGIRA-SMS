// utils/siteLastmod.js
// The real "last changed" date of a static public page: the newest git commit that touched any of
// its template files, or the file's own modified time when git is not there (or the file has
// uncommitted changes). The same value on every request until the page really changes, which is
// what makes <lastmod> in the sitemap believable to search engines.
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let gitDates = null; // Promise<Map<relative file, Date>>

function runGit(args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: ROOT, timeout: 8000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : String(stdout)));
  });
}

async function loadGitDates() {
  const map = new Map();
  const log = await runGit(["log", "-n", "1500", "--name-only", "--format=@@%cI", "--", "views", "utils/managiraFAQ.js", "utils/landing.js"]);
  let when = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("@@")) { when = new Date(line.slice(2)); continue; }
    if (line && when && !Number.isNaN(when.getTime()) && !map.has(line)) map.set(line, when);
  }
  // Uncommitted edits count as "changed now" through the file's modified time (below).
  const dirty = await runGit(["status", "--porcelain", "--", "views", "utils"]);
  for (const line of dirty.split("\n")) {
    const file = line.slice(3).trim();
    if (file) map.delete(file);
  }
  return map;
}

function fileDate(relative, dates) {
  if (dates.has(relative)) return dates.get(relative);
  try { return fs.statSync(path.join(ROOT, relative)).mtime; } catch (_) { return null; }
}

// Newest date across the files (directories mean "every file inside, one level deep").
async function lastmodFor(files) {
  if (!gitDates) gitDates = loadGitDates().catch(() => new Map());
  const dates = await gitDates;
  let newest = null;
  for (const relative of files) {
    let list = [relative];
    try {
      if (fs.statSync(path.join(ROOT, relative)).isDirectory()) list = fs.readdirSync(path.join(ROOT, relative)).map((f) => `${relative}/${f}`);
    } catch (_) { /* a missing file is ignored */ }
    for (const f of list) {
      const d = fileDate(f, dates);
      if (d && (!newest || d > newest)) newest = d;
    }
  }
  return newest;
}

module.exports = { lastmodFor, _reset: () => { gitDates = null; } };
