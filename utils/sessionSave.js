"use strict";
// A response that changed the session goes out once the session is saved. express-session sends
// a response's status and headers before its save is finished (only the last byte waits), so the
// browser can already ask for the next page (a redirect's address is in those headers), and that
// request could read, and even save back, the session from before: a flash message lost, a code
// just confirmed asked for again. So when a request changed the session, its response waits for
// the save. An unchanged session isn't saved again (no extra writes, and no session made for a
// visitor who has none). Goes right after the session middleware.
function saveBeforeResponse(req, res, next) {
  if (!req.session) return next();
  let before;
  try { before = JSON.stringify(req.session); } catch (_error) { return next(); }
  const end = res.end;
  let waiting = false;
  res.end = function endAfterSave(...args) {
    if (waiting) return end.apply(res, args);
    const session = req.session;
    let changed = false;
    try { changed = Boolean(session) && typeof session.save === "function" && JSON.stringify(session) !== before; } catch (_error) { changed = false; }
    if (!changed || res.headersSent) return end.apply(res, args);
    waiting = true;
    session.save((error) => {
      if (error) console.error("[session] saving before the response:", error.message);
      end.apply(res, args);
    });
    return true;
  };
  next();
}

module.exports = { saveBeforeResponse };
