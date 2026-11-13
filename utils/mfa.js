"use strict";
// Authenticator-app codes (TOTP, RFC 6238: SHA-1, 30-second steps, 6 digits) for the people
// who open a school's data migration or its restricted data, and for Managira's super admins
// on the Migration queue (feature data_migration). Asked for with the account's password. The
// app's code changes every 30 seconds; one either side is accepted for a phone's clock, so a code
// works for 90 seconds at most, and once. A right code (with the password) then holds for 30
// minutes in that browser (`fresh`), after which it's asked for again. Set up once by scanning a QR code; ten recovery codes are shown
// once and kept only as SHA-256 hashes. A code works once (`last_step`), and after 5 wrong tries
// an account waits 10 minutes. The secret is stored locked (`lockSecret`). This is a step-up for
// those pages only: signing in to Managira is unchanged.
const crypto = require("crypto");
const QRCode = require("qrcode");
const { BoundedMap } = require("./boundedMap");
const { lockSecret, openSecret } = require("./calendarSync");

const STEP_SECONDS = 30;
const FRESH_MS = 30 * 60 * 1000;
const WRONG_LIMIT = 5;
const WAIT_MS = 10 * 60 * 1000;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(text) {
  const clean = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", unbase32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);
// The step a code belongs to (now, or one either side for a phone's clock), never one at or
// before the last used, or null.
function matchStep(secret, code, lastStep = null, now = Date.now()) {
  const digits = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const current = stepAt(now);
  for (const step of [current, current - 1, current + 1]) {
    if (lastStep !== null && lastStep !== undefined && step <= Number(lastStep)) continue;
    if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(digits))) return step;
  }
  return null;
}

// Whose codes these are: a school signed in as itself, or a person (staff or super admin).
function accountOf(req) {
  const s = (req && req.session) || {};
  if (String(s.accountType || "").toLowerCase() === "organization" && s.organizationId) return { kind: "organization", id: Number(s.organizationId), organizationId: Number(s.organizationId) };
  const id = Number(s.userId || (s.user && s.user.user_id));
  return id ? { kind: "user", id, organizationId: Number(s.organizationId) || null } : null;
}
const keyOf = (account) => `${account.kind}:${account.id}`;
const labelOf = (req) => {
  const s = (req && req.session) || {};
  return String(s.userEmail || (s.user && s.user.email) || [s.firstName, s.lastName].filter(Boolean).join(" ") || "account").slice(0, 80);
};

async function rowOf(db, account) {
  const { rows } = await db.query("SELECT * FROM account_mfa WHERE account_kind = $1 AND account_id = $2", [account.kind, account.id]);
  return rows[0] || null;
}
const isSetUp = async (db, account) => Boolean(account && (await rowOf(db, account))?.confirmed_at);

// A secret to scan, kept (unconfirmed) until the first right code, so a reload shows the same one.
async function startSetup(db, account, label) {
  let row = await rowOf(db, account);
  if (row && row.confirmed_at) return { error: "Your authenticator is already set up." };
  if (!row) {
    await db.query(
      "INSERT INTO account_mfa (account_kind, account_id, organization_id, secret) VALUES ($1, $2, $3, $4) ON CONFLICT (account_kind, account_id) DO NOTHING",
      [account.kind, account.id, account.organizationId || null, lockSecret(base32(crypto.randomBytes(20)))]
    );
    row = await rowOf(db, account);
  }
  const secret = openSecret(row.secret);
  const url = `otpauth://totp/${encodeURIComponent(`Managira:${label}`)}?secret=${secret}&issuer=Managira&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 200, errorCorrectionLevel: "M" });
  return { secret: secret.replace(/(.{4})/g, "$1 ").trim(), url, qr };
}

const hashRecovery = (code) => crypto.createHash("sha256").update(String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
const tries = new BoundedMap(5000); // account -> { n, at }
function waiting(account) {
  const t = tries.get(keyOf(account));
  return Boolean(t && t.n >= WRONG_LIMIT && Date.now() - t.at < WAIT_MS);
}
function wrong(account) {
  const key = keyOf(account);
  const t = tries.get(key);
  tries.set(key, { n: (t && Date.now() - t.at < WAIT_MS ? t.n : 0) + 1, at: Date.now() });
}
const TOO_MANY = "Too many wrong codes. Wait 10 minutes, then try again.";

// The first right code turns it on and makes the recovery codes (returned once).
async function confirmSetup(db, account, code) {
  if (waiting(account)) return { error: TOO_MANY };
  const row = await rowOf(db, account);
  if (!row || row.confirmed_at) return { error: "Start the set-up again." };
  const step = matchStep(openSecret(row.secret), code);
  if (step === null) { wrong(account); return { error: "That code isn't right. Check that your phone's time is set automatically, and type the newest code." }; }
  const recovery = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex").replace(/^(.{5})/, "$1-"));
  await db.query("UPDATE account_mfa SET confirmed_at = NOW(), last_step = $3, recovery = $4::jsonb, updated_at = NOW() WHERE account_kind = $1 AND account_id = $2",
    [account.kind, account.id, step, JSON.stringify(recovery.map(hashRecovery))]);
  tries.delete(keyOf(account));
  return { ok: true, recovery };
}

// A code from the app, or one of the recovery codes (used up).
async function verify(db, account, code) {
  if (waiting(account)) return { error: TOO_MANY };
  const row = await rowOf(db, account);
  if (!row || !row.confirmed_at) return { error: "Set up your authenticator first.", setup: true };
  const text = String(code || "").trim();
  const step = matchStep(openSecret(row.secret), text, row.last_step);
  if (step !== null) {
    const { rowCount } = await db.query(
      "UPDATE account_mfa SET last_step = $3, updated_at = NOW() WHERE account_kind = $1 AND account_id = $2 AND (last_step IS NULL OR last_step < $3)",
      [account.kind, account.id, step]
    );
    if (rowCount) { tries.delete(keyOf(account)); return { ok: true }; }
  } else if (/^[a-z0-9]{5}-?[a-z0-9]{5}$/i.test(text)) {
    const { rows } = await db.query(
      "UPDATE account_mfa SET recovery = recovery - $3::text, updated_at = NOW() WHERE account_kind = $1 AND account_id = $2 AND recovery ? $3::text RETURNING jsonb_array_length(recovery) AS left",
      [account.kind, account.id, hashRecovery(text)]
    );
    if (rows.length) { tries.delete(keyOf(account)); return { ok: true, recoveryLeft: Number(rows[0].left) }; }
  }
  wrong(account);
  return { error: "That code isn't right." };
}

// The code holds for 30 minutes in this session, for this account only.
// Whether the authenticator step is asked at all: the "migration_codes" feature (off until it's
// released), or MIGRATION_CODES=on / off on the server. Off, the gates let managers straight through.
function neededFor(organizationId = null) {
  if (process.env.MIGRATION_CODES === "on") return true;
  if (process.env.MIGRATION_CODES === "off") return false;
  return require("./shards/features").isOn("migration_codes", { organizationId: Number(organizationId) || null });
}
const needed = (req) => neededFor(req && req.session ? req.session.organizationId : null);
// Through the gate: no code is asked, or one was given in the last 30 minutes.
const passed = (req) => !needed(req) || fresh(req);

function fresh(req) {
  const account = accountOf(req);
  const mark = req && req.session && req.session.mfa;
  return Boolean(account && mark && mark.key === keyOf(account) && Date.now() - Number(mark.at || 0) < FRESH_MS);
}
function markFresh(req) {
  const account = accountOf(req);
  if (account) req.session.mfa = { key: keyOf(account), at: Date.now() };
}

// The school's admins who have set up codes (for Super Admin, which can reset one).
async function forSchool(db, organizationId) {
  const { rows } = await db.query(
    `SELECT m.account_kind, m.account_id, m.confirmed_at, jsonb_array_length(m.recovery) AS recovery_left,
            COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email, o.organization_name) AS name
       FROM account_mfa m
       LEFT JOIN users u ON m.account_kind = 'user' AND u.user_id = m.account_id
       LEFT JOIN organizations o ON m.account_kind = 'organization' AND o.organization_id = m.account_id
      WHERE m.organization_id = $1 AND m.confirmed_at IS NOT NULL
      ORDER BY name`,
    [organizationId]
  );
  return rows;
}
async function reset(db, account) {
  const { rowCount } = await db.query("DELETE FROM account_mfa WHERE account_kind = $1 AND account_id = $2", [account.kind, account.id]);
  tries.delete(keyOf(account));
  return rowCount > 0;
}

module.exports = { needed, neededFor, passed, accountOf, keyOf, labelOf, isSetUp, startSetup, confirmSetup, verify, fresh, markFresh, forSchool, reset, matchStep, codeAt, stepAt, base32, FRESH_MS, STEP_SECONDS };
