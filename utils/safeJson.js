"use strict";

// JSON for page templates. Inside a template, JSON.stringify is this one (server.js sets
// app.locals.JSON), so data written into a <script> block or a single-quoted attribute can't
// end it: a class called "</script><script>…" or "'><img onerror=…>" stays data. The output
// is still plain JSON and plain JavaScript, and parses back to the same value.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const ESCAPES = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "'": "\\u0027",
  [LINE_SEPARATOR]: "\\u2028",
  [PARAGRAPH_SEPARATOR]: "\\u2029",
};
const UNSAFE = new RegExp(`[<>&'${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, "g");

function scriptSafeStringify(value, replacer, space) {
  const json = JSON.stringify(value, replacer, space);
  return typeof json === "string" ? json.replace(UNSAFE, (ch) => ESCAPES[ch]) : json;
}

const TEMPLATE_JSON = Object.freeze({ stringify: scriptSafeStringify, parse: (...args) => JSON.parse(...args) });

module.exports = { scriptSafeStringify, TEMPLATE_JSON };
