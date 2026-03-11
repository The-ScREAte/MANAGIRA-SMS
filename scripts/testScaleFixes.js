"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

async function testNoBlockingFileReads() {
  const targets = [
    path.join(__dirname, "../controllers/accountController.js"),
    path.join(__dirname, "../controllers/transcriptController.js"),
    path.join(__dirname, "../controllers/commonController.js"),
  ];

  const forbiddenPatterns = [/readFileSync\(/, /unlinkSync\(/];

  for (const file of targets) {
    const content = await fs.promises.readFile(file, "utf8");

    for (const pattern of forbiddenPatterns) {
      assert(
        !pattern.test(content),
        `Found blocking operation ${pattern} in ${path.basename(file)}`
      );
    }
  }
}

async function testCacheManagerBasics() {
  process.env.REDIS_URL = "";
  const cacheManager = require("../utils/cacheManager");

  let fetchCount = 0;
  const first = await cacheManager.getOrFetch(
    "admin",
    "test:key",
    async () => {
      fetchCount += 1;
      return { value: 42 };
    },
    { ttl: 30 }
  );

  const second = await cacheManager.getOrFetch(
    "admin",
    "test:key",
    async () => {
      fetchCount += 1;
      return { value: 99 };
    },
    { ttl: 30 }
  );

  assert.deepEqual(first, { value: 42 });
  assert.deepEqual(second, { value: 42 });
  assert.equal(fetchCount, 1, "Cache should prevent second fetch");

  cacheManager.invalidate("admin", "test:key");

  const third = await cacheManager.getOrFetch(
    "admin",
    "test:key",
    async () => {
      fetchCount += 1;
      return { value: 123 };
    },
    { ttl: 30 }
  );

  assert.deepEqual(third, { value: 123 });
  assert.equal(fetchCount, 2, "Invalidation should force refetch");
}

async function testLatencyMonitor() {
  const { createRequestLatencyMonitor } = require("../middleware/requestLatencyMonitor");

  const logs = [];
  const logger = {
    warn: (msg) => logs.push(msg),
  };

  const monitor = createRequestLatencyMonitor({ thresholdMs: 5, logger });

  const req = {
    method: "GET",
    originalUrl: "/test/slow",
    url: "/test/slow",
  };

  const res = new EventEmitter();
  res.statusCode = 200;

  await new Promise((resolve) => {
    monitor(req, res, () => {
      setTimeout(() => {
        res.emit("finish");
        resolve();
      }, 8);
    });
  });

  assert(logs.length >= 1, "Slow request should be logged");
  assert(
    logs[0].includes("[REQ][SLOW]"),
    "Slow request log should include [REQ][SLOW] marker"
  );
}

async function run() {
  console.log("Running scale-fix verification tests...\n");

  await testNoBlockingFileReads();
  console.log("PASS: No blocking readFileSync/unlinkSync in targeted controllers.");

  await testCacheManagerBasics();
  console.log("PASS: Cache manager fetch/invalidate behavior works (local mode). ");

  await testLatencyMonitor();
  console.log("PASS: Request latency monitor logs slow requests.");

  console.log("\nAll scale-fix verification tests passed.");
}

run().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
