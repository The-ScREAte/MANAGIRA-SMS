const test = require("node:test");
const assert = require("node:assert/strict");

// A lookup of "is this column there" is asked once it has been answered yes, and never kept while it is no.
test("schemaHas keeps a yes, and asks again after a no", async () => {
  const { schemaHas } = require("../utils/schemaHas");
  let calls = 0;
  let there = 0;
  const db = { query: async () => { calls += 1; return { rows: [{ tables: 0, columns: there, triggers: 0, nullable: 0 }] }; } };
  const spec = { columns: [["poolsafety_table", "poolsafety_column"]] };
  assert.equal(await schemaHas(db, spec), false);
  assert.equal(await schemaHas(db, spec), false);
  assert.equal(calls, 2, "a no is asked again (a migration run later is noticed)");
  there = 1;
  assert.equal(await schemaHas(db, spec), true);
  assert.equal(await schemaHas(db, spec), true);
  assert.equal(calls, 3, "a yes is kept");
});

// A request that holds a database connection must never wait for the pool (a class handing in a test
// together used every connection and waited for each other): re-checks run in the background.
test("a column re-check is not waited for", async () => {
  const path = require.resolve("../utils/assessmentSimple");
  delete require.cache[path];
  const dbPath = require.resolve("../config/db");
  const realDb = require(dbPath);
  const realQuery = realDb.query;
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  let asked = 0;
  realDb.query = () => { asked += 1; return slow.then(() => ({ rows: [{ n: 0 }] })); };
  try {
    const simple = require("../utils/assessmentSimple"); // first check starts here and is slow
    const first = simple.whenChecked(); // the very first check is waited for
    release();
    assert.equal(await first, false);
    assert.equal(asked, 1);
    // A minute later, still "no": the re-check starts but the caller is not held for it.
    realDb.query = () => new Promise(() => {}); // never answers
    const realNow = Date.now;
    Date.now = () => realNow() + 61000;
    try {
      const answer = await Promise.race([simple.whenChecked(), new Promise((resolve) => setTimeout(() => resolve("waited"), 300))]);
      assert.equal(answer, false, "returned the old answer without waiting for the new check");
    } finally {
      Date.now = realNow;
    }
  } finally {
    realDb.query = realQuery;
    delete require.cache[path];
  }
});
