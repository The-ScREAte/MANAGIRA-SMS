// A response that changed the session waits for its save (utils/sessionSave.js): express-session
// sends headers before its save is done, so the next request could read the session from before.
const test = require("node:test");
const assert = require("node:assert/strict");
const { saveBeforeResponse } = require("../utils/sessionSave");

function fakeRequest(session) {
  const events = [];
  const res = { headersSent: false, end(...args) { events.push(["sent", ...args]); return true; } };
  const req = { session };
  if (session) session.save = (cb) => { events.push(["save start"]); setTimeout(() => { events.push(["saved"]); cb(); }, 5); };
  return { req, res, events };
}

test("a response that changed the session goes out once it's saved", async () => {
  const { req, res, events } = fakeRequest({ userId: 7, flash: {} });
  saveBeforeResponse(req, res, () => {});
  req.session.mfa = { key: "user:7", at: 1 };
  res.end("Found. Redirecting to /next");
  assert.deepEqual(events, [["save start"]], "nothing is sent while the save is on its way");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, [["save start"], ["saved"], ["sent", "Found. Redirecting to /next"]]);
});

test("an unchanged session isn't saved again, and a visitor without one gets none", () => {
  const same = fakeRequest({ userId: 7 });
  saveBeforeResponse(same.req, same.res, () => {});
  same.res.end("page");
  assert.deepEqual(same.events, [["sent", "page"]]);
  let called = false;
  saveBeforeResponse({ session: undefined }, {}, () => { called = true; });
  assert.equal(called, true);
});

test("a session that was destroyed (signing out), or a response already streaming, goes at once", () => {
  const gone = fakeRequest({ userId: 7 });
  saveBeforeResponse(gone.req, gone.res, () => {});
  gone.req.session = undefined;
  gone.res.end();
  assert.deepEqual(gone.events, [["sent"]]);
  const streaming = fakeRequest({ userId: 7 });
  saveBeforeResponse(streaming.req, streaming.res, () => {});
  streaming.req.session.x = 1;
  streaming.res.headersSent = true;
  streaming.res.end("last");
  assert.deepEqual(streaming.events, [["sent", "last"]]);
});
