const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// A bulk find-and-replace once left a control character (\x02, from a mis-written backreference) where
// text belonged, which broke the Help menu. No source file may contain one.
const root = path.join(__dirname, "..");
const DIRS = ["views", "public/js", "public/css", "utils", "controllers", "routes", "middleware", "jobs", "config"];
const EXT = new Set([".js", ".ejs", ".css", ".html", ".sql"]);
const BAD = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

test("no source file contains a stray control character", () => {
  const offenders = [];
  for (const dir of DIRS) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of walk(full, [])) {
      if (BAD.test(fs.readFileSync(file, "latin1"))) offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
});
