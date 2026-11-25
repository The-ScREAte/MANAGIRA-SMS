"use strict";

// In production a database or system error text never reaches a browser: a JSON answer whose
// `error` or `message` is a raw Postgres / network message (table, column and constraint names,
// "invalid input syntax for type integer: ...") says what the database looks like, so it is
// replaced by a plain sentence and the original goes to the log.
const RAW_ERROR = /invalid input syntax for|syntax error at or near|(column|relation|table|function|operator|type|schema|index|constraint) "[^"]+"[^.]*?(does not exist|already exists|violates)|violates (foreign key|unique|not-null|check) constraint|duplicate key value|null value in column|current transaction is aborted|permission denied for|out of range for type|value too long for type|canceling statement due to|terminating connection|password authentication failed|connect ECONNREFUSED|getaddrinfo ENOTFOUND|read ECONNRESET|write EPIPE|\bEPIPE\b|ECONNRESET|Connection terminated|not queryable|socket hang up|Cannot read propert|is not a function|is not defined|SQLSTATE/i;
// MySQL-style codes are upper case only: with the i flag "driver_user_id" matched, and a short live bus answer was hidden.
const DB_CODE = /\bER_[A-Z_]+\b/;
const PLAIN = "Something went wrong. Please try again.";

const looksRaw = (value) => typeof value === "string" && (RAW_ERROR.test(value) || DB_CODE.test(value));

function scrubBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { body, hit: null };
  let copy = null;
  let hit = null;
  for (const key of ["error", "message", "detail", "details"]) {
    if (looksRaw(body[key])) {
      copy = copy || { ...body };
      hit = hit || body[key];
      copy[key] = PLAIN;
    }
  }
  return { body: copy || body, hit };
}

// A short text (a flash message, a plain answer) that is raw error text becomes the plain sentence.
function scrubText(value, where = "") {
  if (!looksRaw(value)) return { text: value, hit: null };
  return { text: PLAIN, hit: `${where}${String(value).slice(0, 160)}` };
}

// req.flash(type, message): a raw database / system error is never put on a page.
function flashScrub(req, res, next) {
  if (process.env.NODE_ENV !== "production" || typeof req.flash !== "function") return next();
  const original = req.flash.bind(req);
  req.flash = function scrubbedFlash(type, message) {
    if (arguments.length < 2 || message === undefined) return original.apply(null, arguments);
    const clean = (m) => {
      const { text, hit } = scrubText(m);
      if (hit) console.warn(`[Error text hidden] ${req.method} ${String(req.path).slice(0, 100)}: ${hit}`);
      return text;
    };
    return original(type, Array.isArray(message) ? message.map(clean) : clean(message));
  };
  next();
}

function errorScrub(req, res, next) {
  if (process.env.NODE_ENV !== "production") return next();
  // A short plain-text answer (res.send("...")) is checked too; whole pages are never touched.
  const send = res.send.bind(res);
  res.send = (payload) => {
    if (typeof payload === "string" && payload.length < 400 && !/^\s*</.test(payload)) {
      const { text, hit } = scrubText(payload);
      if (hit) { console.warn(`[Error text hidden] ${req.method} ${String(req.path).slice(0, 100)}: ${hit}`); return send(text); }
    }
    return send(payload);
  };
  const json = res.json.bind(res);
  res.json = (payload) => {
    const { body, hit } = scrubBody(payload);
    if (hit) console.warn(`[Error text hidden] ${req.method} ${String(req.path).slice(0, 100)}: ${String(hit).slice(0, 160)}`);
    return json(body);
  };
  next();
}

module.exports = errorScrub;
module.exports.scrubBody = scrubBody;
module.exports.scrubText = scrubText;
module.exports.flashScrub = flashScrub;
