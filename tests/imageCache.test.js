const test = require("node:test");
const assert = require("node:assert/strict");
const imageCache = require("../utils/imageCache");

test("a picture seen once is answered from the server's own copy", async () => {
  const key = `images/logos/test-${Date.now()}.png|256`;
  assert.equal(await imageCache.get(key), null);
  assert.equal(await imageCache.set(key, "image/png", Buffer.from("png-bytes")), true);
  const hit = await imageCache.get(key);
  assert.equal(hit.type, "image/png");
  assert.equal(hit.body.toString(), "png-bytes");
});

test("only small pictures are kept, and only pictures", async () => {
  assert.equal(await imageCache.set("big", "image/png", Buffer.alloc(imageCache.MAX_BYTES + 1)), false);
  assert.equal(await imageCache.set("text", "text/html", Buffer.from("<script>")), false);
  assert.equal(await imageCache.set("empty", "image/png", Buffer.alloc(0)), false);
});

test("the copy on disk survives a restart (memory emptied)", async () => {
  const key = `images/logos/disk-${Date.now()}.webp|128`;
  await imageCache.set(key, "image/webp", Buffer.from("webp-bytes"));
  // A new process has an empty memory: read through a fresh module instance.
  delete require.cache[require.resolve("../utils/imageCache")];
  const fresh = require("../utils/imageCache");
  const hit = await fresh.get(key);
  assert.equal(hit && hit.body.toString(), "webp-bytes");
});
