"use strict";

const assert = require("assert");
const { performance } = require("perf_hooks");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSubdomainCache({ ttlMs, negativeTtlMs, maxEntries }) {
  const store = new Map();

  function get(key) {
    const item = store.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return item;
  }

  function set(key, value, ttl) {
    if (store.size >= maxEntries) {
      const firstKey = store.keys().next().value;
      if (firstKey) store.delete(firstKey);
    }

    store.set(key, {
      ...value,
      expiresAt: Date.now() + ttl,
    });
  }

  return {
    get,
    set,
    clear: () => store.clear(),
    size: () => store.size,
    ttlMs,
    negativeTtlMs,
  };
}

function createResolver({ cache, baseDomain, fakeDb }) {
  let dbQueries = 0;

  async function resolve(host) {
    const started = performance.now();
    const normalizedHost = String(host || "").toLowerCase();

    if (!normalizedHost.endsWith(baseDomain)) {
      return { type: "skip", cacheHit: false, elapsedMs: performance.now() - started };
    }

    if (normalizedHost === baseDomain || normalizedHost === `www.${baseDomain}`) {
      return { type: "root", cacheHit: false, elapsedMs: performance.now() - started };
    }

    const parts = normalizedHost.split(".");
    let subdomain = null;
    let hubSubdomain = null;

    if (parts.length === 3 && parts[0] !== "www") {
      subdomain = parts[0];
    } else if (parts.length === 4) {
      subdomain = parts[0];
      hubSubdomain = parts[1];
    }

    if (!subdomain) {
      return { type: "skip", cacheHit: false, elapsedMs: performance.now() - started };
    }

    const cacheKey = normalizedHost;
    const cached = cache.get(cacheKey);

    if (cached) {
      if (!cached.found) {
        return { type: "not-found", cacheHit: true, elapsedMs: performance.now() - started };
      }

      return {
        type: "org",
        cacheHit: true,
        org: cached.org,
        elapsedMs: performance.now() - started,
      };
    }

    dbQueries += 1;
    const org = await fakeDb.lookup({ subdomain, hubSubdomain });

    if (org) {
      cache.set(cacheKey, { found: true, org }, cache.ttlMs);
      return {
        type: "org",
        cacheHit: false,
        org,
        elapsedMs: performance.now() - started,
      };
    }

    cache.set(cacheKey, { found: false }, cache.negativeTtlMs);
    return { type: "not-found", cacheHit: false, elapsedMs: performance.now() - started };
  }

  return {
    resolve,
    getDbQueryCount: () => dbQueries,
  };
}

async function run() {
  const cache = createSubdomainCache({
    ttlMs: 1000,
    negativeTtlMs: 300,
    maxEntries: 1000,
  });

  const organizations = new Map([
    ["alpha|", { organization_id: 1, nickname: "alpha", organization_name: "Alpha School" }],
    ["beta|", { organization_id: 2, nickname: "beta", organization_name: "Beta School" }],
    ["alpha|hubx", { organization_id: 3, nickname: "alpha", organization_name: "Alpha Hub School", hub_nickname: "hubx" }],
  ]);

  const fakeDb = {
    async lookup({ subdomain, hubSubdomain }) {
      await sleep(35); // Simulate DB latency
      return organizations.get(`${subdomain}|${hubSubdomain || ""}`) || null;
    },
  };

  const resolver = createResolver({
    cache,
    baseDomain: "managira.com",
    fakeDb,
  });

  console.log("Running subdomain cache tests...\n");

  // Test 1: Same subdomain should hit DB once, then cache.
  const a1 = await resolver.resolve("alpha.managira.com");
  const a2 = await resolver.resolve("alpha.managira.com");
  const a3 = await resolver.resolve("alpha.managira.com");

  assert.equal(a1.type, "org");
  assert.equal(a2.type, "org");
  assert.equal(a3.type, "org");
  assert.equal(a1.cacheHit, false);
  assert.equal(a2.cacheHit, true);
  assert.equal(a3.cacheHit, true);
  assert.equal(resolver.getDbQueryCount(), 1, "Expected only one DB query for same subdomain before TTL");

  // Test 2: Different subdomains should resolve separately.
  const b1 = await resolver.resolve("beta.managira.com");
  const a4 = await resolver.resolve("alpha.managira.com");
  const b2 = await resolver.resolve("beta.managira.com");

  assert.equal(b1.type, "org");
  assert.equal(b2.type, "org");
  assert.equal(a4.org.organization_name, "Alpha School");
  assert.equal(b2.org.organization_name, "Beta School");
  assert.equal(resolver.getDbQueryCount(), 2, "Expected one DB query per unique subdomain");

  // Test 3: Negative cache should prevent repeated DB hits for invalid host.
  const n1 = await resolver.resolve("unknown.managira.com");
  const n2 = await resolver.resolve("unknown.managira.com");

  assert.equal(n1.type, "not-found");
  assert.equal(n2.type, "not-found");
  assert.equal(n1.cacheHit, false);
  assert.equal(n2.cacheHit, true);
  assert.equal(resolver.getDbQueryCount(), 3, "Expected unknown host to query DB only once within negative TTL");

  // Test 4: Cache expires and re-queries DB.
  await sleep(1100);
  const a5 = await resolver.resolve("alpha.managira.com");
  assert.equal(a5.type, "org");
  assert.equal(a5.cacheHit, false);
  assert.equal(resolver.getDbQueryCount(), 4, "Expected DB query after TTL expiry");

  // Test 5: Hub subdomain should be independent from single-level subdomain.
  const h1 = await resolver.resolve("alpha.hubx.managira.com");
  const h2 = await resolver.resolve("alpha.hubx.managira.com");

  assert.equal(h1.type, "org");
  assert.equal(h1.cacheHit, false);
  assert.equal(h2.cacheHit, true);
  assert.equal(h2.org.organization_name, "Alpha Hub School");
  assert.equal(resolver.getDbQueryCount(), 5, "Expected one DB query for hub subdomain key");

  // Speed check: cached requests should be very fast in-process.
  await resolver.resolve("alpha.managira.com");
  await resolver.resolve("beta.managira.com");

  const samples = [];
  for (let i = 0; i < 60; i += 1) {
    const host = i % 2 === 0 ? "alpha.managira.com" : "beta.managira.com";
    const result = await resolver.resolve(host);
    assert.equal(result.cacheHit, true, "Speed sample should come from cache only");
    samples.push(result.elapsedMs);
  }

  const avgMs = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  const maxMs = Math.max(...samples);

  console.log("PASS: Same subdomain uses cache after first request.");
  console.log("PASS: Different subdomains are isolated and switch correctly.");
  console.log("PASS: Unknown subdomain uses short negative cache.");
  console.log("PASS: TTL expiry re-checks database correctly.");
  console.log("PASS: Hub and non-hub subdomains cache independently.");
  console.log(`PASS: Cached speed avg=${avgMs.toFixed(3)}ms, max=${maxMs.toFixed(3)}ms (in-process test).`);
  console.log(`PASS: Total DB lookups performed in test = ${resolver.getDbQueryCount()}`);
  console.log(`PASS: Cache entries in memory = ${cache.size()}`);
}

run().catch((error) => {
  console.error("FAIL:", error.message);
  process.exit(1);
});
