"use strict";

// The one signing secret for sessions and anything derived from them. Never a known value:
// without SESSION_SECRET (or the given override) a random key is made once per process, so
// nothing signed with it can be forged or replayed after a restart. Production logs loudly.
const crypto = require("crypto");

let generated = null;
function sessionSecret(override) {
  const set = String(override || process.env.SESSION_SECRET || "").trim();
  if (set) return set;
  if (!generated) {
    generated = crypto.randomBytes(48).toString("hex");
    console.warn(`[Security] SESSION_SECRET is not set. Using a random key${process.env.NODE_ENV === "production" ? " (set it in the environment: signed values do not survive a restart)" : ""}.`);
  }
  return generated;
}

module.exports = { sessionSecret };
