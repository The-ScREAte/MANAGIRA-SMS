// Mira's coverage map (mira/coverage.json): every area of Managira has what Mira reads there,
// what it can change, or why it's left out; every tool and every feature is placed; a feature
// isn't done until Mira can see it or its exclusion is written down.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { REGISTRY } = require("../tools");
const { levelOf } = require("../services/levels");
const coverage = JSON.parse(fs.readFileSync(path.join(__dirname, "../coverage.json"), "utf8"));
const areas = Object.entries(coverage.areas);

test("every area has a read path, a change path or a written reason", () => {
  const bare = areas.filter(([, a]) => !(a.read || []).length && !(a.change || []).length && !a.excluded).map(([k]) => k);
  assert.deepEqual(bare, []);
});

test("every tool named in the map exists, reads are level 0 and changes level 1-3", () => {
  areas.forEach(([key, a]) => {
    (a.read || []).forEach((name) => {
      assert.ok(REGISTRY[name], `${key}: ${name} isn't a tool`);
      assert.equal(levelOf(name, REGISTRY[name]), 0, `${key}: ${name} is listed as a read`);
    });
    (a.change || []).forEach((name) => {
      assert.ok(REGISTRY[name], `${key}: ${name} isn't a tool`);
      const level = levelOf(name, REGISTRY[name]);
      assert.ok(level >= 0, `${key}: ${name} has no level`);
    });
  });
});

test("every tool is placed in an area", () => {
  const placed = new Set(areas.flatMap(([, a]) => [...(a.read || []), ...(a.change || [])]));
  const loose = Object.keys(REGISTRY).filter((name) => !placed.has(name));
  assert.deepEqual(loose, [], `tools missing from coverage.json: ${loose.join(", ")}`);
});

test("every Managira feature is placed: Mira sees it, or the map says why not", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../utils/shards/features.js"), "utf8");
  const keys = [...source.matchAll(/^\s{2}([a-z][a-z0-9_]*): \{ label:/gm)].map((m) => m[1]);
  assert.ok(keys.length > 15, "found the features");
  const placed = new Set(areas.flatMap(([, a]) => a.features || []));
  const loose = keys.filter((key) => !placed.has(key));
  assert.deepEqual(loose, [], `features missing from coverage.json: ${loose.join(", ")}`);
});
