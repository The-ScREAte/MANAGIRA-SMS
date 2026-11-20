const test = require("node:test");
const assert = require("node:assert");
const { prefixesFor } = require("../utils/schoolFiles");

test("a school's folders end in a slash, so school 12 never matches school 123", () => {
  const prefixes = prefixesFor(12);
  assert.ok(prefixes.length > 15);
  for (const prefix of prefixes) assert.ok(prefix.endsWith("/"), prefix);
  assert.ok(prefixes.includes("images/logos/12/"));
  assert.ok(!prefixes.some((p) => "images/logos/123/".startsWith(p)));
});

test("nothing is listed for a missing or odd school id", () => {
  for (const bad of [0, -3, "abc", null, undefined, "1/../2"]) assert.deepStrictEqual(prefixesFor(bad), []);
});
