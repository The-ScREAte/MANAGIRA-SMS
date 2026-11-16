"use strict";

// The rule for every new password (staff, school accounts, parents, students, hubs, Managira
// admins): at least 8 characters, as NIST SP 800-63B asks, and at most 72 bytes, the most bcrypt
// reads (anything after would be silently ignored). Forms that also ask for a mix of characters
// keep that on top. Existing passwords are never re-checked: this applies when one is set.
const MIN_LENGTH = 8;
const MAX_BYTES = 72;

// What's wrong with a new password, in words for the person, or null when it's fine.
function passwordProblem(password) {
  const text = String(password || "");
  if ([...text].length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters for the password.`;
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) return `Use at most ${MAX_BYTES} characters for the password.`;
  return null;
}

// The sign-in forms used to trim a password and HTML-escape it before checking it (the
// express-validator `escape()` mapping), so a password with &, ', ", /, <, >, `, \ or a space at
// either end never matched what was saved. Sign-in now checks the password as typed, and also
// this old form, so a password ever saved that way still opens.
const LEGACY_ENTITIES = { "&": "&amp;", '"': "&quot;", "'": "&#x27;", "<": "&lt;", ">": "&gt;", "/": "&#x2F;", "\\": "&#x5C;", "`": "&#96;" };
const legacyForm = (password) => String(password || "").trim().replace(/[&"'<>/\\`]/g, (c) => LEGACY_ENTITIES[c]);

async function passwordMatches(password, hash) {
  if (!hash) return false;
  const hashing = require("./passwordHashing");
  const typed = String(password || "");
  if (await hashing.compare(typed, hash).catch(() => false)) return true;
  const legacy = legacyForm(typed);
  return legacy !== typed && hashing.compare(legacy, hash).catch(() => false);
}

// Passwords that appear in known data breaches are refused when a password is set (NIST SP 800-63B).
// Have I Been Pwned's range search is asked with only the first 5 characters of the password's
// SHA-1 hash (k-anonymity): neither the password nor its full hash leaves Managira. If the service
// can't be reached in 3 seconds the password is accepted (never a reason someone can't sign up).
// PASSWORD_BREACH_CHECK=off on the server turns the check off.
const BREACH_TIMEOUT_MS = 3000;
async function breachCount(password) {
  const sha1 = require("crypto").createHash("sha1").update(String(password || "")).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BREACH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "Managira-password-check" },
      signal: controller.signal,
    });
    if (!res.ok) return 0;
    const text = await res.text();
    for (const line of text.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix === suffix) return Number(count) || 0;
    }
    return 0;
  } catch (_error) {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

// passwordProblem plus the breach check: use it wherever a new password is set.
async function passwordProblemAsync(password) {
  const basic = passwordProblem(password);
  if (basic) return basic;
  if (process.env.PASSWORD_BREACH_CHECK === "off") return null;
  return (await breachCount(password)) > 0
    ? "This password has appeared in a data breach on another site, so it isn't safe to use. Choose a different one."
    : null;
}

module.exports = { MIN_LENGTH, MAX_BYTES, passwordProblem, passwordProblemAsync, breachCount, passwordMatches, legacyForm };
