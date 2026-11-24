const test = require("node:test");
const assert = require("node:assert/strict");
const { privateByDefault } = require("../utils/privateByDefault");

function run({ method = "GET", session, preset } = {}) {
  const headers = {};
  if (preset) headers["cache-control"] = preset;
  const res = {
    headersSent: false,
    getHeader: (name) => headers[String(name).toLowerCase()],
    setHeader: (name, value) => { headers[String(name).toLowerCase()] = value; },
    writeHead() { this.headersSent = true; return this; },
  };
  privateByDefault({ method, session }, res, () => {});
  res.writeHead(200);
  return headers["cache-control"];
}

test("a signed-in person's answer with no caching rule is private and re-checked", () => {
  assert.equal(run({ session: { userId: 1 } }), "private, no-cache");
  assert.equal(run({ session: { studentId: 3 } }), "private, no-cache");
  assert.equal(run({ session: { guardianId: 4 } }), "private, no-cache");
});

test("a route's own caching rule is kept", () => {
  assert.equal(run({ session: { userId: 1 }, preset: "private, max-age=86400" }), "private, max-age=86400");
});

test("visitors and writes are left alone", () => {
  assert.equal(run({ session: {} }), undefined);
  assert.equal(run({ session: { userId: 1 }, method: "POST" }), undefined);
});
