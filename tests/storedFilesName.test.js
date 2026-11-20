const test = require("node:test");
const assert = require("node:assert");
const { safeName } = require("../utils/storedFiles");

test("a new upload's name is safe and never the original name alone", () => {
  const a = safeName("Screenshot 2025 at 1.53.06\u202fAM.PNG", "photo");
  const b = safeName("Screenshot 2025 at 1.53.06\u202fAM.PNG", "photo");
  assert.match(a, /^\d{13}-[0-9a-f]{8}-[A-Za-z0-9-]+\.png$/);
  assert.notStrictEqual(a, b);
});

test("folders, odd characters and a missing name can't change a key's folder", () => {
  assert.ok(!safeName("../../etc/passwd").includes("/"));
  assert.ok(!safeName("a b/c\\d.jpg").includes(" "));
  assert.match(safeName("", "student"), /-student$/);
  assert.ok(safeName("x".repeat(300) + ".jpg").length < 100);
});
