const test = require("node:test");
const assert = require("node:assert/strict");
const {
  statusesFor,
  validCoordinate,
  locateAddress,
  isPrivateStop,
  rankOptions,
  createRequest,
  declineRequest,
  RequestError,
} = require("../utils/transportationRequests");
const publicImageUrl = require("../utils/publicImageUrl");

const stop = (id, routeId, lat, name = `Stop ${id}`) => ({
  stop_id: id, route_id: routeId, route_name: `Route ${routeId}`, stop_name: name, latitude: lat, longitude: 0.001,
});

test("new and old requests never overlap, and every status has a home", () => {
  assert.deepEqual(statusesFor("new"), ["pending"]);
  assert.deepEqual(statusesFor("old"), ["approved", "declined", "cancelled"]);
  assert.deepEqual(statusesFor("anything"), ["pending"]);
});

test("closest stops come first, with at most two from one route", () => {
  const ranked = rankOptions(
    [stop(1, 1, 0.03), stop(2, 1, 0.01), stop(3, 1, 0.02), stop(4, 2, 0.05)],
    0,
    0.001
  );
  assert.deepEqual(ranked.map((row) => row.stopId), [2, 3, 4]);
  assert.ok(ranked[0].distanceKm < ranked[1].distanceKm);
});

test("a family's home stop is never offered to anyone else", () => {
  assert.equal(isPrivateStop({ stop_name: "Ama Mensah's Stop" }), true);
  assert.equal(isPrivateStop({ stop_name: "Market Square" }), false);
  const ranked = rankOptions([stop(1, 1, 0.001, "Ama Mensah's Stop"), stop(2, 1, 0.05, "Market Square")], 0, 0.001);
  assert.deepEqual(ranked.map((row) => row.stopId), [2]);
});

test("coordinates: missing, out of range and 0,0 are refused", () => {
  assert.deepEqual(validCoordinate("5.6", "-0.2"), { lat: 5.6, lng: -0.2 });
  for (const [lat, lng] of [[null, null], ["", ""], [91, 0], [0, 181], [0, 0], ["x", 1]]) {
    assert.equal(validCoordinate(lat, lng), null);
  }
});

test("the same address is looked up once, however many people ask at once", async () => {
  let lookups = 0;
  const lookup = async () => { lookups += 1; return { lat: 1, lng: 2 }; };
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => locateAddress("Same St", "P", "C", lookup)));
  await locateAddress("same st", "p", "c", lookup);
  assert.equal(lookups, 1);
  results.forEach((place) => assert.deepEqual(place, { lat: 1, lng: 2 }));
});

function fakeDb(handlers) {
  return { query: async (sql, params) => handlers(sql, params) };
}

test("a student who already has a bus can't be requested again", async () => {
  const db = fakeDb(() => ({ rows: [{ student_id: 5, has_access: true }] }));
  await assert.rejects(
    createRequest(db, 63, { type: "staff", userId: 1 }, { studentId: 5, address: "1 Main St" }),
    (error) => error instanceof RequestError && error.status === 409
  );
});

test("a second request while one is waiting is refused, not duplicated", async () => {
  const db = fakeDb((sql) => (/INSERT INTO transport_student_requests/.test(sql)
    ? { rows: [] }
    : { rows: [{ student_id: 5, has_access: false }] }));
  await assert.rejects(
    createRequest(db, 63, { type: "guardian", guardianId: 9 }, { studentId: 5, address: "1 Main St" }),
    /already waiting/
  );
});

test("a request needs an address or a place on the map", async () => {
  await assert.rejects(createRequest(fakeDb(() => ({ rows: [] })), 63, { type: "staff" }, { studentId: 5, address: "  " }), /address/);
});

test("another school's stop can't be picked", async () => {
  const db = fakeDb((sql) => (/FROM transport_stops/.test(sql) ? { rows: [] } : { rows: [{ student_id: 5, has_access: false }] }));
  await assert.rejects(createRequest(db, 63, { type: "staff" }, { studentId: 5, address: "1 Main St", stopId: 999 }), /no longer available/);
});

test("a request already answered by someone else can't be answered again", async () => {
  await assert.rejects(declineRequest(fakeDb(() => ({ rowCount: 0 })), 63, 1, { userId: 2 }, ""), /already been answered/);
});

test("an image keeps the same address between page loads, so it isn't downloaded and repainted", () => {
  const options = { bucket: "b", region: "r", secret: "s" };
  const realNow = Date.now;
  const at = (seconds) => {
    Date.now = () => seconds * 1000;
    return new URL(publicImageUrl("images/logos/1/a.png", options), "http://x");
  };
  try {
    const start = 1800 * 1000000; // the start of a 30-minute window
    assert.equal(at(start).href, at(start + 1799).href);
    assert.notEqual(at(start).href, at(start + 1800).href);
    for (const now of [start, start + 1799]) {
      const left = Number(at(now).searchParams.get("expires")) - now;
      assert.ok(left > 1800 && left <= 3600, "valid for at least 30 minutes, within the hour the server accepts");
    }
  } finally {
    Date.now = realNow;
  }
});
