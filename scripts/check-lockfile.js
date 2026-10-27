#!/usr/bin/env node
// Fails when package.json and package-lock.json disagree, which is what makes
// `npm ci` stop in CI and on deploys ("Missing: x from lock file"). Runs before
// each commit that touches either file (.githooks/pre-commit) and first in CI.
// Needs no installed packages; uses semver for version checks when it is there.
const fs = require("fs");
const path = require("path");

let semver = null;
try { semver = require("semver"); } catch (_) { /* before `npm ci`: ranges are still compared */ }

const FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const ROOT = path.join(__dirname, "..");
const projects = [".", "mira"].filter((dir) =>
  fs.existsSync(path.join(ROOT, dir, "package.json")) && fs.existsSync(path.join(ROOT, dir, "package-lock.json")));

const problems = [];
for (const dir of projects) {
  const where = dir === "." ? "" : dir + "/";
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, dir, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, dir, "package-lock.json"), "utf8"));
  const root = (lock.packages && lock.packages[""]) || {};
  const installed = (name) => lock.packages && lock.packages["node_modules/" + name];

  for (const field of FIELDS) {
    const wanted = pkg[field] || {};
    const locked = root[field] || {};
    for (const [name, range] of Object.entries(wanted)) {
      if (locked[name] === undefined) { problems.push(`${where}package-lock.json is missing ${name} (${field})`); continue; }
      if (locked[name] !== range) { problems.push(`${where}${name}: package.json asks for ${range}, the lock file has ${locked[name]}`); continue; }
      const entry = installed(name);
      if (!entry && field !== "peerDependencies" && field !== "optionalDependencies") { problems.push(`${where}package-lock.json has no installed copy of ${name}`); continue; }
      if (semver && entry && entry.version && semver.validRange(range) && !semver.satisfies(entry.version, range, { includePrerelease: true })) {
        problems.push(`${where}${name}@${entry.version} in the lock file does not match ${range}`);
      }
    }
    for (const name of Object.keys(locked)) {
      if (!(name in wanted)) problems.push(`${where}${name} is in the lock file but no longer in package.json (${field})`);
    }
  }

  // Top-level overrides ("name": "range") must be met by what the lock file installs.
  for (const [name, range] of Object.entries(pkg.overrides || {})) {
    if (typeof range !== "string") continue;
    const entry = installed(name);
    if (semver && entry && entry.version && semver.validRange(range) && !semver.satisfies(entry.version, range)) {
      problems.push(`${where}override ${name}@${range} is not met: the lock file has ${entry.version}`);
    }
  }
}

if (problems.length) {
  console.error("\npackage.json and package-lock.json are out of step:\n");
  problems.forEach((p) => console.error("  • " + p));
  console.error("\nFix: run `npm install` (and `npm --prefix mira install` for mira), then commit package-lock.json too.\n");
  process.exit(1);
}
console.log(`Lock files in step (${projects.map((d) => (d === "." ? "app" : d)).join(", ")}).`);
