const test = require("node:test");
const assert = require("node:assert/strict");

// No REDIS_URL in the test environment, so this exercises the in-memory
// fallback window - same code path verified manually against the real
// Redis-absent dev environment during development.
const { rateLimiter } = require("../middleware/rateLimiter");

// Date.now() alone isn't a safe uniqueness key here - these tests run in
// well under a millisecond each, so back-to-back tests can get the exact
// same timestamp and collide on the in-memory rate-limit window, letting
// one test's counted requests bleed into the next. A monotonic counter
// guarantees distinct IDs regardless of execution speed.
let uniqueCounter = 0;
function uniqueId(label) {
  uniqueCounter += 1;
  return `${label}-${Date.now()}-${uniqueCounter}`;
}

// The middleware calls next() when allowed, but on rejection it ends the
// response via res.status().json() WITHOUT calling next() (correct
// behavior - mirrors real Express middleware). So the test harness must
// resolve on whichever happens first, not only on next().
function runMiddleware(middleware, tenant) {
  return new Promise((resolve) => {
    const req = { tenant };
    let statusCode = 200;
    let nextCalled = false;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        resolve({ status: statusCode, body: data, nextCalled });
        return this;
      },
    };
    middleware(req, res, () => {
      nextCalled = true;
      resolve({ status: 200, body: null, nextCalled: true });
    });
  });
}

test("rateLimiter: allows requests under the per-user limit", async () => {
  const middleware = rateLimiter({ perUserPerMinute: 5, perTenantPerMinute: 100 });
  const tenant = { organizationId: 63, userId: uniqueId("ratelimit-test"), viewerType: "staff" };

  let allowedCount = 0;
  for (let i = 0; i < 5; i++) {
    const result = await runMiddleware(middleware, tenant);
    if (result.nextCalled) allowedCount++;
  }
  assert.equal(allowedCount, 5);
});

test("rateLimiter: blocks the request once the per-user limit is exceeded", async () => {
  const middleware = rateLimiter({ perUserPerMinute: 3, perTenantPerMinute: 100 });
  const tenant = { organizationId: 63, userId: uniqueId("ratelimit-test"), viewerType: "staff" };

  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(await runMiddleware(middleware, tenant));
  }
  assert.deepEqual(results.map((r) => r.nextCalled), [true, true, true, false]);
  assert.equal(results[3].status, 429);
});

test("rateLimiter: different users each get their own budget", async () => {
  const middleware = rateLimiter({ perUserPerMinute: 2, perTenantPerMinute: 100 });

  for (const userId of [uniqueId("userA"), uniqueId("userB")]) {
    const tenant = { organizationId: 63, userId, viewerType: "staff" };
    let allowedCount = 0;
    for (let i = 0; i < 2; i++) {
      const result = await runMiddleware(middleware, tenant);
      if (result.nextCalled) allowedCount++;
    }
    assert.equal(allowedCount, 2, `user ${userId} should not be rate-limited within their own budget`);
  }
});

test("rateLimiter: a shared tenant budget blocks a second user once the tenant cap is hit", async () => {
  const middleware = rateLimiter({ perUserPerMinute: 100, perTenantPerMinute: 3 });
  uniqueCounter += 1;
  const sharedOrgId = 777000000 + uniqueCounter;
  const tenantA = { organizationId: sharedOrgId, userId: uniqueId("tenantcap-userA"), viewerType: "staff" };
  const tenantB = { organizationId: sharedOrgId, userId: uniqueId("tenantcap-userB"), viewerType: "staff" };

  const results = [];
  results.push(await runMiddleware(middleware, tenantA));
  results.push(await runMiddleware(middleware, tenantA));
  results.push(await runMiddleware(middleware, tenantB)); // 3rd request across the same tenant
  results.push(await runMiddleware(middleware, tenantB)); // 4th - should be blocked

  assert.deepEqual(results.map((r) => r.nextCalled), [true, true, true, false]);
});

test("rateLimiter: skips enforcement when req.tenant is missing (upstream auth should have rejected already)", async () => {
  const middleware = rateLimiter({ perUserPerMinute: 0, perTenantPerMinute: 0 });
  const result = await runMiddleware(middleware, undefined);
  assert.equal(result.nextCalled, true);
});
