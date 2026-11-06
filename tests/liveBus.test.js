const test = require("node:test");
const assert = require("node:assert/strict");
const liveBus = require("../utils/liveBus");
const { createShortCache, forgetSchool } = require("../utils/shortCache");
const { withSessionCache, markSmallRequests } = require("../utils/cachedSessionStore");

let nextOrg = 1000;
function fakeDb(activeTrips = []) {
  const calls = { reads: 0, writes: 0, trips: 0 };
  return {
    calls,
    query: async (sql) => {
      if (/INSERT INTO transport_live_locations/.test(sql)) { calls.writes += 1; return { rows: [] }; }
      if (/LEFT JOIN LATERAL/.test(sql)) { calls.reads += 1; return { rows: activeTrips }; }
      calls.trips += 1;
      return { rows: activeTrips.slice(0, 1) };
    },
  };
}
const trip = (id, busId, routeId) => ({ trip_id: id, bus_id: busId, route_id: routeId, status: "active", started_at: new Date(), latitude: null, longitude: null, recorded_at: null });

test("a viewer sees the newest position, without waiting for the database", async () => {
  const org = nextOrg++;
  const db = fakeDb([trip(1, 7, 9)]);
  await liveBus.recordFix(db, org, 5, trip(1, 7, 9), { latitude: 5.1, longitude: -0.2, speedKmh: 30, headingDeg: 90 });
  await liveBus.recordFix(db, org, 5, trip(1, 7, 9), { latitude: 5.2, longitude: -0.3, speedKmh: 31, headingDeg: 91 });
  const seen = await liveBus.liveForStudent(db, org, 7, 9);
  assert.equal(seen.latitude, 5.2);
  assert.equal(seen.heading_deg, 91);
  await liveBus.tripEnded(db, org, 1);
});

test("a driver reporting every 5 seconds writes to the database at most once per 15 seconds", async () => {
  const org = nextOrg++;
  const db = fakeDb();
  for (let i = 0; i < 10; i += 1) {
    await liveBus.recordFix(db, org, 5, trip(2, 7, 9), { latitude: 5 + i / 1000, longitude: 0.5, speedKmh: 20, headingDeg: 0 });
  }
  assert.equal(db.calls.writes, 1);
  await liveBus.tripEnded(db, org, 2);
});

test("ending a trip saves its last position and takes the bus off every map at once", async () => {
  const org = nextOrg++;
  const active = [trip(3, 7, 9)];
  const db = fakeDb(active);
  await liveBus.recordFix(db, org, 5, trip(3, 7, 9), { latitude: 6, longitude: 1, speedKmh: 0, headingDeg: 0 });
  assert.ok(await liveBus.liveForStudent(db, org, 7, 9));
  await liveBus.recordFix(db, org, 5, trip(3, 7, 9), { latitude: 6.1, longitude: 1, speedKmh: 0, headingDeg: 0 });
  active.length = 0;
  const writesBefore = db.calls.writes;
  await liveBus.tripEnded(db, org, 3);
  assert.equal(db.calls.writes, writesBefore + 1);
  assert.equal(await liveBus.liveForStudent(db, org, 7, 9), null);
});

test("a thousand viewers of one school share one database read", async () => {
  const org = nextOrg++;
  const db = fakeDb([trip(4, 7, 9)]);
  await Promise.all(Array.from({ length: 1000 }, () => liveBus.liveForStudent(db, org, 7, 9)));
  await liveBus.liveByRoute(db, org);
  assert.equal(db.calls.reads, 1);
  await liveBus.tripEnded(db, org, 4);
});

test("a student follows their own bus first, then a bus on their route, never another route's", async () => {
  const org = nextOrg++;
  const db = fakeDb([trip(5, 1, 100), trip(6, 2, 200)]);
  assert.equal((await liveBus.liveForStudent(db, org, 2, 100)).trip_id, 6);
  assert.equal((await liveBus.liveForStudent(db, org, null, 100)).trip_id, 5);
  assert.equal(await liveBus.liveForStudent(db, org, 3, 300), null);
});

test("a driver's trip is checked once, and a trip that isn't theirs is refused", async () => {
  const org = nextOrg++;
  const db = fakeDb([trip(7, 1, 1)]);
  await liveBus.tripForDriver(db, org, 7, 5);
  await liveBus.tripForDriver(db, org, 7, 5);
  assert.equal(db.calls.trips, 1);
  const none = fakeDb([]);
  assert.equal(await liveBus.tripForDriver(none, org, 8, 5), null);
  await liveBus.tripEnded(db, org, 7);
});

test("the short cache shares one lookup, drops failures, and forgets when a school changes", async () => {
  const cache = createShortCache({ ttlMs: 60000 });
  let loads = 0;
  const load = async () => { loads += 1; return loads; };
  const answers = await Promise.all([cache.get(1, "a", load), cache.get(1, "a", load), cache.get(1, "a", load)]);
  assert.deepEqual(answers, [1, 1, 1]);
  forgetSchool(1);
  assert.equal(await cache.get(1, "a", load), 2);
  assert.equal(await cache.get(2, "a", load), 3, "schools never share answers");
  await assert.rejects(cache.get(3, "x", async () => { throw new Error("down"); }));
  assert.equal(await cache.get(3, "x", async () => "back"), "back", "a failure isn't kept");
});

test("small repeat requests share a session copy; full pages always read the database", async () => {
  let reads = 0;
  class Base {
    constructor() { this.rows = { a: { user: 1 } }; }
    get(sid, cb) { reads += 1; cb(null, this.rows[sid] ? JSON.parse(JSON.stringify(this.rows[sid])) : null); }
    set(sid, sess, cb) { this.rows[sid] = sess; cb && cb(null); }
    destroy(sid, cb) { delete this.rows[sid]; cb && cb(null); }
  }
  const Store = withSessionCache(Base);
  const store = new Store();
  const read = (sid) => new Promise((resolve) => store.get(sid, (_e, s) => resolve(s)));
  const small = (sid) => new Promise((resolve) => {
    markSmallRequests({ method: "GET", path: "/transportation/live/student/1" }, {}, () => resolve(read(sid)));
  });
  await read("a");
  await read("a");
  assert.equal(reads, 2, "full pages read the database every time");
  const first = await small("a");
  first.user = 99;
  assert.equal((await small("a")).user, 1, "changing one request's copy doesn't touch the next");
  assert.equal(reads, 2, "small requests share the copy");
  store.set("a", { user: 2 });
  assert.equal((await small("a")).user, 2, "a save shows at once");
  store.destroy("a");
  assert.equal(await small("a"), null, "signed out means signed out");
});
