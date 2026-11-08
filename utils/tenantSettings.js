"use strict";

// A school's sign-in rules, set by a manager in Settings, Tenant configuration. Read on every
// signed-in request, so each server keeps a copy for a minute (and drops it when a manager saves).
const { BoundedMap } = require("./boundedMap");

const DEFAULTS = Object.freeze({
  session_hours: 24,
  keep_signed_in_allowed: true,
  keep_signed_in_days: 30,
  login_code_required: true,
  remember_device_allowed: true,
  remember_device_days: 3,
});
// The choices the page offers; nothing else is saved.
const CHOICES = Object.freeze({
  session_hours: [8, 12, 24, 72, 168],
  keep_signed_in_days: [7, 14, 30, 60, 90],
  remember_device_days: [1, 3, 7, 14, 30],
});
const CACHE_MS = 60 * 1000;
const TABLE_MISSING = "42P01";
const cache = new BoundedMap(20000);
const reading = new Map(); // one read per school at a time, however many requests ask

function shape(row) {
  const out = { ...DEFAULTS };
  if (!row) return out;
  for (const key of Object.keys(DEFAULTS)) if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  return out;
}

async function settingsFor(db, organizationId) {
  const id = Number(organizationId);
  if (!Number.isInteger(id) || id <= 0) return { ...DEFAULTS };
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  if (reading.has(id)) return reading.get(id);
  const read = (async () => {
    let value = { ...DEFAULTS };
    try {
      const { rows } = await db.query("SELECT * FROM tenant_settings WHERE organization_id = $1", [id]);
      value = shape(rows[0]);
    } catch (error) {
      if (error.code !== TABLE_MISSING) throw error;
    }
    cache.set(id, { at: Date.now(), value });
    return value;
  })().finally(() => reading.delete(id));
  reading.set(id, read);
  return read;
}

class TenantSettingsError extends Error {}

function readChoices(body, current) {
  const next = { ...current };
  const bool = (value) => value === true || value === "true" || value === "on";
  for (const key of ["keep_signed_in_allowed", "login_code_required", "remember_device_allowed"]) {
    if (body[key] !== undefined) next[key] = bool(body[key]);
  }
  for (const key of Object.keys(CHOICES)) {
    if (body[key] === undefined) continue;
    const number = Number(body[key]);
    if (!CHOICES[key].includes(number)) throw new TenantSettingsError("Choose one of the options shown.");
    next[key] = number;
  }
  return next;
}

async function saveSettings(db, organizationId, body, actorName) {
  const current = await settingsFor(db, organizationId);
  const next = readChoices(body || {}, current);
  await db.query(
    `INSERT INTO tenant_settings (organization_id, session_hours, keep_signed_in_allowed, keep_signed_in_days, login_code_required, remember_device_allowed, remember_device_days, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (organization_id) DO UPDATE SET
       session_hours = EXCLUDED.session_hours, keep_signed_in_allowed = EXCLUDED.keep_signed_in_allowed,
       keep_signed_in_days = EXCLUDED.keep_signed_in_days, login_code_required = EXCLUDED.login_code_required,
       remember_device_allowed = EXCLUDED.remember_device_allowed, remember_device_days = EXCLUDED.remember_device_days,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [organizationId, next.session_hours, next.keep_signed_in_allowed, next.keep_signed_in_days, next.login_code_required, next.remember_device_allowed, next.remember_device_days, actorName]
  );
  cache.delete(Number(organizationId));
  return { before: current, after: next };
}

// How long this sign-in may last, from when it started: the school's session time, or its
// Keep me logged in time when the person ticked it (and the school allows it).
function sessionLimitMs(settings, keepSignedIn) {
  if (keepSignedIn && settings.keep_signed_in_allowed) return settings.keep_signed_in_days * 24 * 60 * 60 * 1000;
  return settings.session_hours * 60 * 60 * 1000;
}

module.exports = { DEFAULTS, CHOICES, settingsFor, saveSettings, sessionLimitMs, TenantSettingsError };
